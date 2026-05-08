"use client";

export function getVaultIcon(accountIndex: number | null | undefined): string {
  if (accountIndex === null || accountIndex === undefined) {
    return "/hero-new/Wallet-Cover.png";
  }

  return "/agents/Stashx.svg";
}
