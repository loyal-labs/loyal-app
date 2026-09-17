/** Test-only adapter replays fixed signatures. No key material or signing operation. */
(() => {
  const fixture = window.__staticWalletFixture;
  const state = window.__recoveryVerifier = { address: fixture.address, signCalls: 0 };
  state.publicKey = new Uint8Array(fixture.publicKey);
  const sign = async wire => {
    const encoded = btoa(String.fromCharCode(...wire));
    const match = fixture.transactions.find(transaction => transaction.unsignedBase64 === encoded);
    if (!match) throw new Error("No pre-signed fixture matches the reviewed message");
    return Uint8Array.from(atob(match.signedBase64), character => character.charCodeAt(0));
  };
  let account = { address: state.address, publicKey: state.publicKey, chains: ["solana:mainnet"], features: ["solana:signTransaction"] };
  const listeners = new Set();
  const wallet = { version: "1.0.0", name: "Unfunded recovery verifier", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=", chains: ["solana:mainnet"], accounts: [], features: {
    "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; listeners.forEach(f => f({ accounts: wallet.accounts })); return { accounts: wallet.accounts }; } },
    "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; listeners.forEach(f => f({ accounts: [] })); } },
    "standard:events": { version: "1.0.0", on: (_event, f) => { listeners.add(f); return () => listeners.delete(f); } },
    "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: [0], signTransaction: async (...inputs) => {
      state.signCalls++;
      if (state.refuse) throw new Error("Controlled signature refusal");
      if (state.hold) await new Promise(resolve => { state.releaseSigning = resolve; });
      return Promise.all(inputs.map(async input => ({ signedTransaction: new Uint8Array(await sign(input.transaction)) })));
    } },
  } };
  state.switchAccount = (address, publicKey) => {
    account = { ...account, address, publicKey: new Uint8Array(publicKey) };
    wallet.accounts = [account];
    state.activeAddress = address;
    listeners.forEach(f => f({ accounts: wallet.accounts }));
  };
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: api => api.register(wallet) }));
  window.addEventListener("wallet-standard:app-ready", event => event.detail.register(wallet));
})();
