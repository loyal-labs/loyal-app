import { getSolanaEnv } from "./connection";
import type { SolanaEnv } from "./types";

const clusterParam = (env: SolanaEnv): string => {
  switch (env) {
    case "testnet":
      return "?cluster=testnet";
    case "devnet":
      return "?cluster=devnet";
    default:
      return "";
  }
};

export const getExplorerTxUrl = (signature: string): string => {
  return `https://orbmarkets.io/tx/${signature}`;
};

export const getSolscanAccountUrl = (address: string): string => {
  const suffix = clusterParam(getSolanaEnv());
  return `https://solscan.io/account/${address}${suffix}`;
};
