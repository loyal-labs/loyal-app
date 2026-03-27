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
  payload: Record<string, unknown>,
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
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHJ4PSIyNCIgZmlsbD0iYmxhY2siLz48L3N2Zz4=";

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
    input?: StandardConnectInput,
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
      features: [
        "solana:signTransaction",
        "solana:signMessage",
      ],
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
      "*",
    );

    this.#accounts = [];
    this.#emit("change", { accounts: this.accounts });
  };

  // --- standard:events ---
  #on: StandardEventsOnMethod = <E extends StandardEventsNames>(
    event: E,
    listener: StandardEventsListeners[E],
  ): (() => void) => {
    const listeners = (this.#listeners[event] ??=
      new Set<StandardEventsListeners[E]>());
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
