import bs58 from "bs58";
import { Buffer } from "buffer";

import type { Signer } from "@/lib/wallet/signer";

import type { EarnAuthFields } from "./earn-api";

export type EarnAuthPurpose =
  | "earn-deposit-prepare"
  | "earn-deposit-confirm"
  | "earn-withdraw-prepare"
  | "earn-withdraw-confirm"
  | "earn-autodeposit-setup-prepare"
  | "earn-autodeposit-setup-confirm"
  | "earn-autodeposit-floor-confirm"
  | "earn-autodeposit-toggle-confirm"
  | "earn-autodeposit-close-prepare"
  | "earn-autodeposit-close-confirm"
  | "earn-autodeposit-sweep-execute";

// Must stay byte-for-byte in sync with the backend `buildMobileWalletAuthMessage`
// (`frontend/src/features/identity/server/mobile-wallet-auth.ts`). The server
// rebuilds this exact string from the request fields and verifies the signature.
function buildEarnAuthMessage(args: {
  purpose: EarnAuthPurpose;
  walletAddress: string;
  issuedAt: string;
}): string {
  return [
    "Loyal Mobile Earn",
    `purpose: ${args.purpose}`,
    `wallet: ${args.walletAddress}`,
    `issuedAt: ${args.issuedAt}`,
  ].join("\n");
}

// Signs a purpose-scoped, time-stamped message with the wallet so the backend
// can authenticate the request without a session (Turnstile-free).
export async function signEarnAuth(
  signer: Signer,
  purpose: EarnAuthPurpose,
): Promise<EarnAuthFields> {
  const walletAddress = signer.publicKey.toBase58();
  const issuedAt = new Date().toISOString();
  const message = buildEarnAuthMessage({ purpose, walletAddress, issuedAt });
  const signature = await signer.signMessage(Buffer.from(message, "utf8"));
  return { walletAddress, signature: bs58.encode(signature), issuedAt };
}
