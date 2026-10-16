import React, { useSyncExternalStore } from "react";
import { PublicKey } from "@solana/web3.js";
import type { WalletAccount } from "@wallet-standard/base";

export const owner = "11111111111111111111111111111111";
export const other = "So11111111111111111111111111111111111111112";
const scenario = new URLSearchParams(location.search).get("scenario");
const listeners = new Set<() => void>();
const changes = new Set<
  (event: { accounts: readonly WalletAccount[] }) => void
>();
let nextAddress = owner;
let finishConnect: (() => void) | undefined;
let accounts: readonly WalletAccount[] = [];
let signatures = 0;
let disconnects = 0;
function account(address: string): WalletAccount {
  return {
    address,
    publicKey: new PublicKey(address).toBytes(),
    chains: ["solana:mainnet"],
    features: ["solana:signTransaction", "solana:signMessage"],
  };
}
export function changeAccount(address: string | null) {
  accounts = address ? [account(address)] : [];
  changes.forEach((listener) => listener({ accounts }));
}
const wallet = {
  version: "1.0.0" as const,
  name: "Privy",
  icon: "data:image/svg+xml;base64,PHN2Zy8+" as const,
  chains: ["solana:mainnet" as const],
  isPrivyWallet: true,
  get accounts() {
    return accounts;
  },
  features: {
    "standard:events": {
      version: "1.0.0",
      on: (
        _event: string,
        listener: (event: { accounts: readonly WalletAccount[] }) => void
      ) => {
        changes.add(listener);
        return () => changes.delete(listener);
      },
    },
    "standard:connect": {
      version: "1.0.0",
      connect: async () => {
        if (scenario === "rejected")
          throw new Error("User rejected the request");
        if (scenario === "delayed")
          await new Promise<void>((resolve) => {
            finishConnect = resolve;
          });
        changeAccount(nextAddress);
        return { accounts };
      },
    },
    "standard:disconnect": {
      version: "1.0.0",
      disconnect: async () => {
        disconnects++;
        if (scenario === "preconnected_async_disconnect")
          await new Promise((resolve) => setTimeout(resolve, 100));
        changeAccount(null);
      },
    },
    "solana:signTransaction": {
      version: "1.0.0",
      supportedTransactionVersions: ["legacy", 0],
      signTransaction: async () => {
        throw new Error("Network transactions forbidden in fixture");
      },
    },
    "solana:signMessage": {
      version: "1.0.0",
      signMessage: async (
        ...inputs: { account: WalletAccount; message: Uint8Array }[]
      ) =>
        inputs.map((input) => {
          if (input.account !== accounts[0])
            throw new Error("Stale account used to sign");
          signatures++;
          return {
            signedMessage: input.message,
            signature: new Uint8Array(64),
          };
        }),
    },
  },
};
let wallets = scenario === "registration_delayed" ? [] : [wallet];
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function churn() {
  wallets = [wallet];
  listeners.forEach((listener) => listener());
}
export function finish() {
  churn();
  finishConnect?.();
}
export function chooseWrong() {
  nextAddress = other;
}
export const signatureCount = () => signatures;
export const disconnectCount = () => disconnects;
export const PrivyProvider = ({ children }: { children: React.ReactNode }) => (
  <>{children}</>
);
export const toSolanaWalletConnectors = () => [];
export const useStandardWallets = () => ({
  ready: true,
  wallets: useSyncExternalStore(subscribe, () => wallets),
});
export const useWallets = () => ({
  ready: true,
  wallets: [{ address: owner, standardWallet: wallet }],
});
