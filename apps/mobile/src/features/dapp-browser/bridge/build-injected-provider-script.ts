import {
  BRIDGE_MESSAGE_SOURCE,
  BRIDGE_REQUEST_TYPES,
  BRIDGE_RESPONSE_RESOLVER,
} from "./messages";

const LOYAL_WALLET_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 28" fill="none"><path d="M5.25 24.5 0 12.25h15.75V0l7 12.25L24.5 0 35 28 5.25 24.5Z" fill="#F9363C"/><path d="M19.37 15.14c2.89.15 5.13 2.31 5 4.82l-10.49-.55c.13-2.51 2.58-4.42 5.49-4.27Z" fill="#fff"/><circle cx="19.25" cy="17.41" r="2.36" fill="#000"/></svg>`;
const LOYAL_WALLET_ICON = `data:image/svg+xml,${encodeURIComponent(LOYAL_WALLET_ICON_SVG)}`;

export function buildInjectedProviderScript() {
  return `(() => {
  const source = ${JSON.stringify(BRIDGE_MESSAGE_SOURCE)};
  const requestTypes = ${JSON.stringify(BRIDGE_REQUEST_TYPES)};
  const resolverKey = ${JSON.stringify(BRIDGE_RESPONSE_RESOLVER)};
  const walletIcon = ${JSON.stringify(LOYAL_WALLET_ICON)};
  const pending = new Map();
  const listeners = new Map();
  const walletChains = ["solana:mainnet", "solana:devnet"];
  let accounts = [];
  let nextId = 0;

  function toBase64(bytes) {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  function fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function base58ToBytes(value) {
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const bytes = [];
    for (const char of value) {
      let carry = alphabet.indexOf(char);
      if (carry === -1) {
        throw new Error("Invalid base58 public key.");
      }

      for (let index = 0; index < bytes.length; index += 1) {
        const next = bytes[index] * 58 + carry;
        bytes[index] = next & 255;
        carry = next >> 8;
      }

      while (carry > 0) {
        bytes.push(carry & 255);
        carry >>= 8;
      }
    }

    let leadingZeroes = 0;
    for (const char of value) {
      if (char !== "1") {
        break;
      }
      leadingZeroes += 1;
    }

    const result = new Uint8Array(leadingZeroes + bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
      result[leadingZeroes + index] = bytes[bytes.length - 1 - index];
    }
    return result;
  }

  function postMessage(type, payload) {
    if (requestTypes.indexOf(type) === -1) {
      return Promise.reject(new Error("Unsupported bridge request."));
    }

    return new Promise((resolve, reject) => {
      const id = \`loyal-mobile-wallet-\${++nextId}\`;
      pending.set(id, { resolve, reject });
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ source, id, type, payload }),
      );
    });
  }

  function handleResponse(message) {
    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }

    pending.delete(message.id);
    if (message.ok) {
      entry.resolve(message.result);
      return;
    }

    entry.reject(new Error(message.error || "Request handling not ready."));
  }

  function getListeners(event) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    return listeners.get(event);
  }

  function emit(event, properties) {
    const eventListeners = listeners.get(event);
    if (!eventListeners) {
      return;
    }

    eventListeners.forEach((listener) => {
      try {
        listener(properties);
      } catch {}
    });
  }

  function buildAccount(publicKey) {
    return {
      address: publicKey,
      publicKey: base58ToBytes(publicKey),
      chains: walletChains.slice(),
      features: ["solana:signTransaction", "solana:signMessage"],
      label: "Loyal",
      icon: walletIcon,
    };
  }

  globalThis[resolverKey] = handleResponse;

  const wallet = {
    version: "1.0.0",
    name: "Loyal",
    icon: walletIcon,
    chains: walletChains.slice(),
    get accounts() {
      return accounts.slice();
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async (input) => {
          if (accounts.length > 0) {
            return { accounts: wallet.accounts };
          }

          if (input && input.silent) {
            return { accounts: [] };
          }

          const result = await postMessage("connect");
          if (!result || typeof result.publicKey !== "string") {
            throw new Error("Connect request failed.");
          }

          accounts = [buildAccount(result.publicKey)];
          emit("change", { accounts: wallet.accounts });
          return { accounts: wallet.accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          await postMessage("disconnect");
          accounts = [];
          emit("change", { accounts: wallet.accounts });
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event, listener) => {
          const eventListeners = getListeners(event);
          eventListeners.add(listener);
          return () => {
            eventListeners.delete(listener);
          };
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs) => {
          const results = [];
          for (const input of inputs) {
            const result = await postMessage("signTransaction", {
              transaction: toBase64(input.transaction),
            });
            if (!result || typeof result.signedTransaction !== "string") {
              throw new Error("Transaction signing failed.");
            }
            results.push({
              signedTransaction: fromBase64(result.signedTransaction),
            });
          }
          return results;
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs) => {
          const results = [];
          for (const input of inputs) {
            const result = await postMessage("signMessage", {
              message: toBase64(input.message),
            });
            if (!result || typeof result.signature !== "string") {
              throw new Error("Message signing failed.");
            }
            results.push({
              signedMessage: input.message,
              signature: fromBase64(result.signature),
            });
          }
          return results;
        },
      },
    },
  };

  window.loyal = {
    wallet,
    request(input) {
      return postMessage(input.method, input.params);
    },
    connect() {
      return wallet.features["standard:connect"].connect();
    },
    disconnect() {
      return wallet.features["standard:disconnect"].disconnect();
    },
    signMessage(payload) {
      return postMessage("signMessage", payload);
    },
    signTransaction(payload) {
      return postMessage("signTransaction", payload);
    },
    signAndSendTransaction(payload) {
      return postMessage("signAndSendTransaction", payload);
    },
  };

  function registerWallet(currentWallet) {
    const callback = ({ register }) => register(currentWallet);

    try {
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", {
          detail: callback,
        }),
      );
    } catch {}

    try {
      window.addEventListener("wallet-standard:app-ready", ({ detail: api }) =>
        callback(api),
      );
    } catch {}

    try {
      window.navigator.wallets = window.navigator.wallets || [];
      window.navigator.wallets.push(callback);
    } catch {}
  }

  registerWallet(wallet);
})();`;
}
