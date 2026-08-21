import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import * as Linking from "expo-linking";
import { AppState } from "react-native";

import { env } from "@/config/env";

import {
  buildConnectUrl,
  buildRequestUrl,
  decryptResponseData,
  DeeplinkResponseError,
  type DeeplinkMethod,
  type DeeplinkWalletProvider,
  generateDappKeypair,
  parseConnectResponse,
  throwIfErrorResponse,
} from "./deeplink-protocol";
import {
  clearDeeplinkSession,
  type StoredDeeplinkSession,
} from "./deeplink-session-storage";
import { WalletRejectedError } from "./rejection";
import { assertOwnVersionedSignature, type Signer } from "./signer";
import { WalletSessionError } from "./wallet-session-error";

// External-wallet signing on iOS, where MWA cannot exist: every operation is
// a full app switch — we open a phantom.app/solflare.com universal link, the
// wallet shows its approval UI, and redirects back to our /ul/wallet/<action>
// return link with the (encrypted) response in query params. Protocol
// encoding/encryption lives in deeplink-protocol.ts; this module owns the
// app-switch round trip and the Signer implementation.

export const DEEPLINK_WALLET_LABELS: Record<DeeplinkWalletProvider, string> = {
  phantom: "Phantom",
  solflare: "Solflare",
};

const WALLET_PROBE_SCHEMES: Record<DeeplinkWalletProvider, string> = {
  phantom: "phantom://",
  solflare: "solflare://",
};

// Shown in the wallet's connect approval dialog and stored in its session
// token for validation.
const APP_URL = "https://askloyal.com";

const SIGNING_DECLINED_MESSAGE =
  "The request was declined in your wallet app. Try again and approve each prompt.";

const CANCELLED_MESSAGE =
  "The wallet request was cancelled. Try again and approve the prompt in your wallet app.";

// How long after the app returns to the foreground we still wait for the
// wallet's redirect to deliver a URL event before treating the switch-back as
// a cancellation. The redirect's URL event lands right around activation, so
// real approvals never wait this long.
const RETURN_WITHOUT_RESPONSE_GRACE_MS = 4_000;

/**
 * Deeplink wallets installed on this device, probed via their custom schemes.
 * iOS answers canOpenURL only for schemes declared in
 * LSApplicationQueriesSchemes (app.config.ts).
 */
export async function getInstalledDeeplinkWallets(): Promise<
  DeeplinkWalletProvider[]
> {
  const providers = Object.keys(
    WALLET_PROBE_SCHEMES,
  ) as DeeplinkWalletProvider[];
  const installed = await Promise.all(
    providers.map(async (provider) => {
      const canOpen = await Linking.canOpenURL(
        WALLET_PROBE_SCHEMES[provider],
      ).catch(() => false);
      return canOpen ? provider : null;
    }),
  );
  return installed.filter((p): p is DeeplinkWalletProvider => p !== null);
}

// Return path the wallet redirects to. Production uses our universal link
// (AASA + Associated Domains ship with ASK-2199 and must be in the binary);
// dev builds use the dev-client custom scheme (loyal-dev://ul/wallet/<action>)
// so the flow is testable before associated domains are configured.
function buildRedirectLink(action: DeeplinkMethod): string {
  return __DEV__
    ? Linking.createURL(`ul/wallet/${action}`)
    : `https://askloyal.com/ul/wallet/${action}`;
}

function deeplinkCluster(): "mainnet-beta" | "devnet" {
  // No localnet in the deeplink protocol; devnet is the closest for local
  // development (same rule as MWA_CHAIN).
  return env.solanaEnv === "mainnet" ? "mainnet-beta" : "devnet";
}

type PendingDeeplinkRequest = {
  cancel: () => void;
};

// One in-flight request per action. The process dies with the pending map, so
// a request that outlives the app (iOS killed us while the wallet was open)
// simply has no waiter when the cold-start URL arrives — the user retries.
const pendingRequests = new Map<string, PendingDeeplinkRequest>();

/**
 * Open a wallet universal link and wait for the redirect back to
 * /ul/wallet/<action>. Resolves with the redirect's query params. Rejects
 * with WalletRejectedError when the user returns to the app without a
 * response (switch-back is the only cancel signal this protocol has).
 */
function performDeeplinkRequest(
  action: DeeplinkMethod,
  url: string,
): Promise<Record<string, unknown>> {
  // A stale pending request (the user came back without responding, then
  // retried) must not swallow the new request's response.
  pendingRequests.get(action)?.cancel();

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      urlSub.remove();
      appStateSub.remove();
      if (pendingRequests.get(action) === entry) {
        pendingRequests.delete(action);
      }
      outcome();
    };

    const entry: PendingDeeplinkRequest = {
      cancel: () =>
        finish(() => reject(new WalletRejectedError(CANCELLED_MESSAGE))),
    };
    pendingRequests.set(action, entry);

    const urlSub = Linking.addEventListener("url", ({ url: incoming }) => {
      // Accept both the universal link (https://askloyal.com/ul/wallet/…)
      // and the custom-scheme dev fallback (loyal[-dev]://ul/wallet/…).
      const match = /ul\/wallet\/([A-Za-z]+)/.exec(incoming);
      if (!match || match[1] !== action) return;
      const { queryParams } = Linking.parse(incoming);
      finish(() => resolve((queryParams ?? {}) as Record<string, unknown>));
    });

    // The user can switch back without answering the wallet's prompt; no URL
    // means no answer, so once the app is active and the grace window passes
    // without a redirect, treat it as a cancellation instead of spinning
    // forever.
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      graceTimer = setTimeout(
        () => entry.cancel(),
        RETURN_WITHOUT_RESPONSE_GRACE_MS,
      );
    });

    Linking.openURL(url).catch((error) => finish(() => reject(error)));
  });
}

function isUserCancellation(error: unknown): boolean {
  return (
    error instanceof WalletRejectedError ||
    (error instanceof DeeplinkResponseError && error.isUserDecline)
  );
}

/**
 * Run the connect handshake with the chosen wallet app. Returns the session
 * to persist, or null when the user declined in the wallet or switched back
 * without answering. A fresh x25519 keypair per attempt, per the spec; the
 * secret key is dropped once the shared secret exists.
 */
export async function connectDeeplinkWallet(
  provider: DeeplinkWalletProvider,
): Promise<StoredDeeplinkSession | null> {
  const keypair = await generateDappKeypair();
  const url = buildConnectUrl({
    provider,
    dappPublicKey: keypair.publicKey,
    redirectLink: buildRedirectLink("connect"),
    appUrl: APP_URL,
    cluster: deeplinkCluster(),
  });
  try {
    const params = await performDeeplinkRequest("connect", url);
    const result = await parseConnectResponse({
      provider,
      params,
      dappSecretKey: keypair.secretKey,
    });
    return {
      provider,
      publicKey: result.walletPublicKey,
      session: result.session,
      sharedSecret: result.sharedSecret,
      dappPublicKey: keypair.publicKey,
    };
  } catch (error) {
    if (isUserCancellation(error)) return null;
    // Wallet-reported connect errors keep their own identity: the wallet WAS
    // reachable, so none of the wallet-session failure messages fit, and the
    // wallet's errorMessage is already user-readable copy.
    throw error;
  }
}

/** Best-effort disconnect used by wallet reset. Opens the wallet app. */
export async function disconnectDeeplinkWallet(
  session: StoredDeeplinkSession,
): Promise<void> {
  const url = await buildRequestUrl({
    provider: session.provider,
    method: "disconnect",
    dappPublicKey: session.dappPublicKey,
    sharedSecret: session.sharedSecret,
    redirectLink: buildRedirectLink("disconnect"),
    payload: { session: session.session },
  });
  const params = await performDeeplinkRequest("disconnect", url);
  throwIfErrorResponse(params);
}

function serializeForSigning(tx: Transaction | VersionedTransaction): string {
  const bytes =
    tx instanceof VersionedTransaction
      ? tx.serialize()
      : tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return bs58.encode(bytes);
}

/**
 * Signer backed by an external wallet app over Phantom-style deeplinks
 * (Phantom, Solflare). Keys never reach this app; each sign call opens the
 * wallet app, which shows its own approval UI and redirects back with the
 * encrypted result. If the wallet revoked our session the stored record is
 * cleared so the next launch lands in reconnect onboarding, and a reconnect
 * instruction is thrown instead of the raw error (same recovery as MwaSigner).
 */
export class DeeplinkSigner implements Signer {
  readonly kind = "deeplink" as const;
  readonly publicKey: PublicKey;

  constructor(readonly session: StoredDeeplinkSession) {
    this.publicKey = new PublicKey(session.publicKey);
  }

  get provider(): DeeplinkWalletProvider {
    return this.session.provider;
  }

  async signMessage(bytes: Uint8Array): Promise<Uint8Array> {
    const data = await this.request("signMessage", {
      message: bs58.encode(bytes),
      display: "utf8",
    });
    if (typeof data.signature !== "string") {
      throw new Error("Wallet returned no message signature.");
    }
    return bs58.decode(data.signature);
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    const data = await this.request("signTransaction", {
      transaction: serializeForSigning(tx),
    });
    if (typeof data.transaction !== "string") {
      throw new Error("Wallet returned no signed transaction.");
    }
    await this.adoptSignedTransaction(tx, data.transaction, 0);
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    if (txs.length === 0) return txs;
    const data = await this.request("signAllTransactions", {
      transactions: txs.map(serializeForSigning),
    });
    const signed = data.transactions;
    if (!Array.isArray(signed) || signed.length !== txs.length) {
      throw new Error(
        "Wallet returned a mismatched number of signed transactions.",
      );
    }
    for (let index = 0; index < txs.length; index++) {
      const encoded: unknown = signed[index];
      if (typeof encoded !== "string") {
        throw new Error(
          `Wallet returned no signed transaction at position ${index + 1}.`,
        );
      }
      await this.adoptSignedTransaction(txs[index], encoded, index);
    }
    return txs;
  }

  // Same rule as MwaSigner: the wallet-returned bytes are the signed truth —
  // the wallet may return a modified transaction (Lighthouse guards, priority
  // fees), so adopt its message AND signatures onto the caller's object, then
  // verify our signature locally.
  private async adoptSignedTransaction(
    tx: Transaction | VersionedTransaction,
    encoded: string,
    index: number,
  ): Promise<void> {
    const bytes = bs58.decode(encoded);
    if (tx instanceof VersionedTransaction) {
      const src = VersionedTransaction.deserialize(bytes);
      tx.message = src.message;
      tx.signatures = src.signatures;
      await assertOwnVersionedSignature(tx, this.publicKey, index);
    } else {
      tx.signatures = Transaction.from(bytes).signatures;
    }
  }

  private async request(
    method: "signMessage" | "signTransaction" | "signAllTransactions",
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = await buildRequestUrl({
      provider: this.session.provider,
      method,
      dappPublicKey: this.session.dappPublicKey,
      sharedSecret: this.session.sharedSecret,
      redirectLink: buildRedirectLink(method),
      payload: { ...payload, session: this.session.session },
    });
    try {
      const params = await performDeeplinkRequest(method, url);
      return await decryptResponseData(params, this.session.sharedSecret);
    } catch (error) {
      if (error instanceof DeeplinkResponseError) {
        if (error.isUserDecline) {
          throw new WalletRejectedError(SIGNING_DECLINED_MESSAGE);
        }
        if (error.isUnauthorized) {
          // The user disconnected this app inside the wallet — the same dead
          // authorization as MWA's ERROR_AUTHORIZATION_FAILED. Clearing the
          // stored session is the half that matters: without it the app keeps
          // presenting a connected wallet whose every signature is refused.
          await clearDeeplinkSession();
          throw new WalletSessionError(
            "authorization_expired",
            error.errorCode,
            error,
          );
        }
        throw new WalletSessionError("signing_failed", error.errorCode, error);
      }
      throw error;
    }
  }
}
