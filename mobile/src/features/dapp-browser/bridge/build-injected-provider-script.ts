import {
  BRIDGE_MESSAGE_SOURCE,
  BRIDGE_REQUEST_TYPES,
  BRIDGE_RESPONSE_RESOLVER,
} from "./messages";

export function buildInjectedProviderScript() {
  return `(() => {
  const source = ${JSON.stringify(BRIDGE_MESSAGE_SOURCE)};
  const requestTypes = ${JSON.stringify(BRIDGE_REQUEST_TYPES)};
  const resolverKey = ${JSON.stringify(BRIDGE_RESPONSE_RESOLVER)};
  const pending = new Map();
  let nextId = 0;

  function postMessage(type, payload) {
    return new Promise((resolve, reject) => {
      const id = \`loyal-mobile-wallet-\${++nextId}\`;
      pending.set(id, { resolve, reject });
      window.ReactNativeWebView.postMessage(JSON.stringify({ source, id, type, payload }));
    });
  }

  function handleResponse(message) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) {
      entry.resolve(message.result);
      return;
    }
    entry.reject(new Error(message.error || "Request handling not ready."));
  }

  globalThis[resolverKey] = handleResponse;

  function request(method, payload) {
    if (requestTypes.indexOf(method) === -1) {
      return Promise.reject(new Error("Unsupported bridge request."));
    }
    return postMessage(method, payload);
  }

  window.loyal = {
    request(input) {
      return request(input.method, input.params);
    },
    connect() {
      return request("connect");
    },
    disconnect() {
      return request("disconnect");
    },
    signMessage(payload) {
      return request("signMessage", payload);
    },
    signTransaction(payload) {
      return request("signTransaction", payload);
    },
    signAndSendTransaction(payload) {
      return request("signAndSendTransaction", payload);
    },
  };

  function registerWallet(wallet) {
    const callback = ({ register }) => register(wallet);
    try {
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: callback }));
    } catch {}
    try {
      window.addEventListener("wallet-standard:app-ready", ({ detail: api }) => callback(api));
    } catch {}
  }

  registerWallet({
    version: "1.0.0",
    name: "Loyal",
    icon: "",
    chains: ["solana:mainnet", "solana:devnet"],
    features: [
      "standard:connect",
      "standard:disconnect",
      "standard:events",
      "solana:signMessage",
      "solana:signTransaction",
      "solana:signAndSendTransaction",
    ],
    accounts: [],
  });
})();`;
}
