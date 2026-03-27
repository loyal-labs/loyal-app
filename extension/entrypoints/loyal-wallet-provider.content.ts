import type { Wallet, WalletAccount, WalletIcon } from "@wallet-standard/base";
import type {
  StandardConnectFeature,
  StandardConnectInput,
  StandardConnectOutput,
  StandardDisconnectFeature,
  StandardEventsChangeProperties,
  StandardEventsFeature,
  StandardEventsListeners,
  StandardEventsNames,
  StandardEventsOnMethod,
} from "@wallet-standard/features";
import type {
  SolanaSignMessageFeature,
  SolanaSignMessageInput,
  SolanaSignMessageOutput,
  SolanaSignTransactionFeature,
  SolanaSignTransactionInput,
  SolanaSignTransactionOutput,
} from "@solana/wallet-standard-features";
import { registerWallet } from "@wallet-standard/wallet";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Base58 alphabet used by Bitcoin / Solana
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [0];
  for (const char of str) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`Invalid base58 character: ${char}`);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = bytes[i] * 58 + value;
      if (bytes[i] > 255) {
        bytes[i + 1] = (bytes[i + 1] || 0) + (bytes[i] >> 8);
        bytes[i] &= 0xff;
      }
    }
  }
  // Count leading 1s for leading zero bytes
  let leadingZeros = 0;
  for (const char of str) {
    if (char === "1") leadingZeros++;
    else break;
  }
  const result = new Uint8Array(leadingZeros + bytes.length);
  // bytes are stored little-endian, reverse them
  for (let i = 0; i < bytes.length; i++) {
    result[leadingZeros + i] = bytes[bytes.length - 1 - i];
  }
  return result;
}

function getFavicon(): string | undefined {
  const link =
    document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ??
    document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]');
  if (link?.href) return link.href;
  // Fallback to /favicon.ico
  try {
    return new URL("/favicon.ico", window.location.origin).href;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Bridge messaging
// ---------------------------------------------------------------------------

let messageCounter = 0;

interface BridgeResponse {
  target: "loyal-wallet-provider";
  id: string;
  payload: Record<string, unknown>;
}

function sendBridgeMessage<T extends Record<string, unknown>>(
  payload: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `loyal-${Date.now()}-${messageCounter++}`;

    const handler = (event: MessageEvent<BridgeResponse>) => {
      if (
        event.source !== window ||
        event.data?.target !== "loyal-wallet-provider" ||
        event.data?.id !== id
      ) {
        return;
      }
      window.removeEventListener("message", handler);
      const response = event.data.payload;
      if (response.error) {
        reject(new Error(response.error as string));
      } else {
        resolve(response as T);
      }
    };

    window.addEventListener("message", handler);
    window.postMessage({ target: "loyal-wallet-bridge", id, payload }, "*");
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WALLET_NAME = "Loyal";

const WALLET_ICON: WalletIcon =
  "data:image/png;base64,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";

const SOLANA_CHAINS = ["solana:mainnet", "solana:devnet"] as const;

// ---------------------------------------------------------------------------
// Wallet Standard implementation
// ---------------------------------------------------------------------------

type LoyalFeatures = StandardConnectFeature &
  StandardDisconnectFeature &
  StandardEventsFeature &
  SolanaSignTransactionFeature &
  SolanaSignMessageFeature;

class LoyalWalletImpl implements Wallet {
  readonly version = "1.0.0" as const;
  readonly name = WALLET_NAME;
  readonly icon = WALLET_ICON;
  readonly chains = [...SOLANA_CHAINS];

  #accounts: WalletAccount[] = [];
  #listeners: { [E in StandardEventsNames]?: Set<StandardEventsListeners[E]> } =
    {};

  get accounts(): readonly WalletAccount[] {
    return [...this.#accounts];
  }

  get features(): LoyalFeatures {
    return {
      "standard:connect": {
        version: "1.0.0",
        connect: this.#connect,
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: this.#disconnect,
      },
      "standard:events": {
        version: "1.0.0",
        on: this.#on,
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: this.#signTransaction,
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: this.#signMessage,
      },
    };
  }

  // --- standard:connect ---
  #connect = async (
    input?: StandardConnectInput
  ): Promise<StandardConnectOutput> => {
    // If already connected and silent, return existing accounts
    if (input?.silent && this.#accounts.length > 0) {
      return { accounts: this.accounts };
    }

    const response = await sendBridgeMessage<{
      type: string;
      approved: boolean;
      publicKey?: string;
    }>({
      type: "DAPP_CONNECT_REQUEST",
      origin: window.location.origin,
      favicon: getFavicon(),
    });

    if (!response.approved || !response.publicKey) {
      throw new Error("User rejected the connection request.");
    }

    const publicKeyBytes = base58Decode(response.publicKey);

    const account: WalletAccount = {
      address: response.publicKey,
      publicKey: publicKeyBytes,
      chains: [...SOLANA_CHAINS],
      features: ["solana:signTransaction", "solana:signMessage"],
      label: undefined,
      icon: undefined,
    };

    this.#accounts = [account];
    this.#emit("change", { accounts: this.accounts });
    return { accounts: this.accounts };
  };

  // --- standard:disconnect ---
  #disconnect = async (): Promise<void> => {
    // Fire-and-forget to background via bridge
    window.postMessage(
      {
        target: "loyal-wallet-bridge",
        id: `loyal-disconnect-${Date.now()}`,
        payload: {
          type: "DAPP_DISCONNECT",
          origin: window.location.origin,
        },
      },
      "*"
    );

    this.#accounts = [];
    this.#emit("change", { accounts: this.accounts });
  };

  // --- standard:events ---
  #on: StandardEventsOnMethod = <E extends StandardEventsNames>(
    event: E,
    listener: StandardEventsListeners[E]
  ): (() => void) => {
    const listeners = (this.#listeners[event] ??= new Set<
      StandardEventsListeners[E]
    >());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  #emit<E extends StandardEventsNames>(
    event: E,
    ...args: Parameters<StandardEventsListeners[E]>
  ) {
    const listeners = this.#listeners[event];
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        (listener as (...a: unknown[]) => void)(...args);
      } catch (err) {
        console.error(`Loyal wallet: error in ${event} listener`, err);
      }
    }
  }

  // --- solana:signTransaction ---
  #signTransaction = async (
    ...inputs: readonly SolanaSignTransactionInput[]
  ): Promise<readonly SolanaSignTransactionOutput[]> => {
    const results: SolanaSignTransactionOutput[] = [];

    for (const input of inputs) {
      const response = await sendBridgeMessage<{
        type: string;
        approved: boolean;
        signedTransaction?: string;
        error?: string;
      }>({
        type: "DAPP_SIGN_TRANSACTION_REQUEST",
        origin: window.location.origin,
        favicon: getFavicon(),
        transaction: uint8ArrayToBase64(input.transaction as Uint8Array),
      });

      if (!response.approved || !response.signedTransaction) {
        throw new Error(response.error ?? "Transaction signing was rejected.");
      }

      results.push({
        signedTransaction: base64ToUint8Array(response.signedTransaction),
      });
    }

    return results;
  };

  // --- solana:signMessage ---
  #signMessage = async (
    ...inputs: readonly SolanaSignMessageInput[]
  ): Promise<readonly SolanaSignMessageOutput[]> => {
    const results: SolanaSignMessageOutput[] = [];

    for (const input of inputs) {
      const response = await sendBridgeMessage<{
        type: string;
        approved: boolean;
        signature?: string;
        error?: string;
      }>({
        type: "DAPP_SIGN_MESSAGE_REQUEST",
        origin: window.location.origin,
        favicon: getFavicon(),
        message: uint8ArrayToBase64(input.message as Uint8Array),
      });

      if (!response.approved || !response.signature) {
        throw new Error(response.error ?? "Message signing was rejected.");
      }

      results.push({
        signedMessage: input.message as Uint8Array,
        signature: base64ToUint8Array(response.signature),
      });
    }

    return results;
  };
}

// ---------------------------------------------------------------------------
// Content script definition (MAIN world)
// ---------------------------------------------------------------------------

export default defineContentScript({
  matches: ["<all_urls>"],
  world: "MAIN",
  runAt: "document_start",

  main() {
    try {
      registerWallet(new LoyalWalletImpl());
    } catch (err) {
      console.error("Loyal wallet: failed to register", err);
    }
  },
});
