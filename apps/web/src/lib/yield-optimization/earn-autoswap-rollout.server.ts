import "server-only";

import { PublicKey } from "@solana/web3.js";

const AUTOSWAP_WALLETS_ENV = "EARN_AUTOSWAP_ENABLED_WALLETS";

type AutoswapRolloutEnvironment = Readonly<{
  EARN_AUTOSWAP_ENABLED_WALLETS?: string;
}>;

export function isEarnAutoswapEnrollmentEnabled(
  walletAddress: string,
  env: AutoswapRolloutEnvironment = {
    EARN_AUTOSWAP_ENABLED_WALLETS:
      process.env.EARN_AUTOSWAP_ENABLED_WALLETS,
  }
): boolean {
  const raw = env[AUTOSWAP_WALLETS_ENV]?.trim();
  if (!raw) {
    return false;
  }
  if (raw === "*") {
    return true;
  }
  const entries = raw.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => entry.length === 0)) {
    throw new Error(`${AUTOSWAP_WALLETS_ENV} contains an empty wallet entry.`);
  }
  const unique = new Set(entries);
  if (unique.size !== entries.length) {
    throw new Error(`${AUTOSWAP_WALLETS_ENV} contains a duplicate wallet.`);
  }
  for (const entry of entries) {
    let canonical: string;
    try {
      canonical = new PublicKey(entry).toBase58();
    } catch {
      throw new Error(`${AUTOSWAP_WALLETS_ENV} contains an invalid wallet.`);
    }
    if (canonical !== entry) {
      throw new Error(
        `${AUTOSWAP_WALLETS_ENV} contains a non-canonical wallet.`
      );
    }
  }
  return unique.has(walletAddress);
}
