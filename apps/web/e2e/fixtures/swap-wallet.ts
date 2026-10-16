import { useSyncExternalStore } from "react";
import { PublicKey } from "@solana/web3.js";

export const fixtureOwner = new PublicKey("11111111111111111111111111111111");
const connection = {
  getLatestBlockhash: async () => ({
    blockhash: fixtureOwner.toBase58(),
    lastValidBlockHeight: 10,
  }),
  confirmTransaction: async () => ({ value: { err: null } }),
};
const scenario =
  typeof location === "undefined"
    ? null
    : new URLSearchParams(location.search).get("scenario");
let finishConnection: (() => void) | undefined;
export const completeFixtureConnection = () => {
  adapter.connected = true;
  wallet = {
    ...wallet,
    connected: true,
    publicKey: adapter.publicKey,
    wallets: [{ adapter, readyState: "Installed" }],
  };
  listeners.forEach((listener) => listener());
  finishConnection?.();
};
const adapter = {
  name: "Phantom",
  connected: !["connect_rejected", "connect_delayed"].includes(scenario ?? ""),
  publicKey:
    scenario === "signer_mismatch"
      ? new PublicKey("So11111111111111111111111111111111111111112")
      : fixtureOwner,
  emit: (_event: string, publicKey: PublicKey) => {
    wallet = { ...wallet, connected: true, publicKey };
    listeners.forEach((listener) => listener());
  },
  connect: async () => {
    if (scenario === "connect_delayed")
      await new Promise<void>((resolve) => {
        finishConnection = resolve;
      });
    if (scenario === "connect_rejected")
      throw new Error("Fixture adapter rejected connection");
    if (scenario === "stale_signer") completeFixtureConnection();
  },
};
let wallet = {
  publicKey: (scenario === "stale_signer" ? null : adapter.publicKey) as PublicKey | null,
  connected:
    scenario === "stale_signer" ||
    scenario === "context_delayed" ||
    scenario === "registration_delayed" ||
    scenario === "missing_wallet"
      ? false
      : adapter.connected,
  connecting: false,
  connect: adapter.connect,
  select: (name: string | null) => {
    if (scenario !== "stale_signer") return;
    if (!name) adapter.connected = false;
    wallet = {
      ...wallet,
      connected: false,
      publicKey: null,
      wallet: name ? { adapter } : null,
    };
    listeners.forEach((listener) => listener());
  },
  wallets:
    scenario === "registration_delayed" || scenario === "missing_wallet"
      ? []
      : [{ adapter, readyState: "Installed" }],
  sendTransaction: async () => "fixture-signature-never-broadcast",
  wallet: { adapter } as { adapter: typeof adapter } | null,
};
export const useConnection = () => ({ connection });
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useWallet = () => useSyncExternalStore(subscribe, () => wallet);
