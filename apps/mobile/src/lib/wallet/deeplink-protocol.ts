import bs58 from "bs58";
import { Buffer } from "buffer";

// Phantom's deeplink provider protocol (docs.phantom.com → Phantom Deeplinks),
// which Solflare implements verbatim (docs.solflare.com → Deep Links): every
// method is a universal link under <wallet>/ul/v1/<method>, request payloads
// and responses are nacl.box-encrypted with an x25519 shared secret, and all
// binary values travel base58-encoded. This module is the pure protocol half —
// no React Native imports — so the encryption/session contract stays testable
// under Jest; the app-switch orchestration lives in deeplink-signer.ts.

export type DeeplinkWalletProvider = "phantom" | "solflare";

export const DEEPLINK_BASE_URLS: Record<DeeplinkWalletProvider, string> = {
  phantom: "https://phantom.app/ul/v1",
  solflare: "https://solflare.com/ul/v1",
};

// The connect response carries the wallet's x25519 public key under a
// provider-branded param name; everything else is shared.
const RESPONSE_KEY_PARAM: Record<DeeplinkWalletProvider, string> = {
  phantom: "phantom_encryption_public_key",
  solflare: "solflare_encryption_public_key",
};

export type DeeplinkMethod =
  | "connect"
  | "disconnect"
  | "signMessage"
  | "signTransaction"
  | "signAllTransactions";

/** Everything needed to encrypt/decrypt and authorize follow-up requests. */
export type DeeplinkConnectResult = {
  /** Base58 Solana public key the user approved. */
  walletPublicKey: string;
  /** Opaque session token the wallet requires on every subsequent method. */
  session: string;
  /** Base58 nacl.box shared secret derived from the wallet's x25519 key. */
  sharedSecret: string;
};

/** The wallet answered with an error instead of a payload. */
export class DeeplinkResponseError extends Error {
  constructor(
    readonly errorCode: string,
    errorMessage: string,
  ) {
    super(errorMessage || `Wallet returned error ${errorCode}`);
    this.name = "DeeplinkResponseError";
  }

  /** 4001: the user tapped reject in the wallet — a choice, not a failure. */
  get isUserDecline(): boolean {
    return this.errorCode === "4001";
  }

  /**
   * 4100: the wallet no longer honors our session token (user disconnected
   * the app inside the wallet). The stored session must be discarded.
   */
  get isUnauthorized(): boolean {
    return this.errorCode === "4100";
  }
}

type TweetNaclBox = {
  keyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
  before(theirPublicKey: Uint8Array, mySecretKey: Uint8Array): Uint8Array;
  after(
    message: Uint8Array,
    nonce: Uint8Array,
    sharedKey: Uint8Array,
  ): Uint8Array;
  open: {
    after(
      box: Uint8Array,
      nonce: Uint8Array,
      sharedKey: Uint8Array,
    ): Uint8Array | null;
  };
};

type TweetNacl = {
  box: TweetNaclBox;
  randomBytes(length: number): Uint8Array;
};

// Lazy-loaded so tweetnacl's Buffer access never runs at module top-level
// (same pattern as signer.ts).
async function getNacl(): Promise<TweetNacl> {
  const mod = (await import("tweetnacl")) as unknown as {
    box?: TweetNaclBox;
    randomBytes?: (length: number) => Uint8Array;
    default?: TweetNacl;
  };
  if (typeof mod.box?.before === "function" && mod.randomBytes) {
    return { box: mod.box, randomBytes: mod.randomBytes };
  }
  if (typeof mod.default?.box?.before === "function") return mod.default;
  throw new Error("tweetnacl box is unavailable");
}

/** New x25519 keypair for a connect handshake, both halves base58-encoded. */
export async function generateDappKeypair(): Promise<{
  publicKey: string;
  secretKey: string;
}> {
  const nacl = await getNacl();
  const pair = nacl.box.keyPair();
  return {
    publicKey: bs58.encode(pair.publicKey),
    secretKey: bs58.encode(pair.secretKey),
  };
}

// React Native's built-in URLSearchParams throws "not implemented" from
// toString(), so query strings are assembled by hand.
function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}

export function buildConnectUrl(args: {
  provider: DeeplinkWalletProvider;
  dappPublicKey: string;
  redirectLink: string;
  appUrl: string;
  cluster: "mainnet-beta" | "devnet" | "testnet";
}): string {
  const query = toQueryString({
    app_url: args.appUrl,
    dapp_encryption_public_key: args.dappPublicKey,
    redirect_link: args.redirectLink,
    cluster: args.cluster,
  });
  return `${DEEPLINK_BASE_URLS[args.provider]}/connect?${query}`;
}

/**
 * Encrypt `payload` and build the universal link for any post-connect method.
 * A fresh random nonce per request, as the spec requires.
 */
export async function buildRequestUrl(args: {
  provider: DeeplinkWalletProvider;
  method: Exclude<DeeplinkMethod, "connect">;
  dappPublicKey: string;
  sharedSecret: string;
  redirectLink: string;
  payload: Record<string, unknown>;
}): Promise<string> {
  const nacl = await getNacl();
  const nonce = nacl.randomBytes(24);
  const encrypted = nacl.box.after(
    new Uint8Array(Buffer.from(JSON.stringify(args.payload), "utf8")),
    nonce,
    bs58.decode(args.sharedSecret),
  );
  const query = toQueryString({
    dapp_encryption_public_key: args.dappPublicKey,
    nonce: bs58.encode(nonce),
    redirect_link: args.redirectLink,
    payload: bs58.encode(encrypted),
  });
  return `${DEEPLINK_BASE_URLS[args.provider]}/${args.method}?${query}`;
}

function param(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  if (typeof value === "string" && value.length > 0) return value;
  // expo-linking's queryParams can hold arrays for repeated keys.
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

/** Throw the wallet's error response, if the redirect carries one. */
export function throwIfErrorResponse(params: Record<string, unknown>): void {
  const errorCode = param(params, "errorCode");
  if (errorCode === undefined) return;
  throw new DeeplinkResponseError(errorCode, param(params, "errorMessage") ?? "");
}

/** Decrypt the `data` param of an approve response and parse it as JSON. */
export async function decryptResponseData(
  params: Record<string, unknown>,
  sharedSecret: string,
): Promise<Record<string, unknown>> {
  throwIfErrorResponse(params);
  const data = param(params, "data");
  const nonce = param(params, "nonce");
  if (!data || !nonce) {
    throw new Error("The wallet response is missing the encrypted payload.");
  }
  const nacl = await getNacl();
  const opened = nacl.box.open.after(
    bs58.decode(data),
    bs58.decode(nonce),
    bs58.decode(sharedSecret),
  );
  if (!opened) {
    throw new Error(
      "The wallet response could not be decrypted with the session key.",
    );
  }
  const parsed: unknown = JSON.parse(Buffer.from(opened).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("The wallet response payload is not an object.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Handle a connect redirect: derive the shared secret from the wallet's
 * x25519 public key + our secret key, then decrypt the session grant.
 */
export async function parseConnectResponse(args: {
  provider: DeeplinkWalletProvider;
  params: Record<string, unknown>;
  dappSecretKey: string;
}): Promise<DeeplinkConnectResult> {
  throwIfErrorResponse(args.params);
  const walletEncryptionKey = param(
    args.params,
    RESPONSE_KEY_PARAM[args.provider],
  );
  if (!walletEncryptionKey) {
    throw new Error("The wallet response is missing its encryption key.");
  }
  const nacl = await getNacl();
  const sharedSecret = bs58.encode(
    nacl.box.before(
      bs58.decode(walletEncryptionKey),
      bs58.decode(args.dappSecretKey),
    ),
  );
  const data = await decryptResponseData(args.params, sharedSecret);
  if (typeof data.public_key !== "string" || typeof data.session !== "string") {
    throw new Error("The wallet connect response is missing the account.");
  }
  return {
    walletPublicKey: data.public_key,
    session: data.session,
    sharedSecret,
  };
}
