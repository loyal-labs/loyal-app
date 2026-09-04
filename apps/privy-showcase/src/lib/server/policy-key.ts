import "server-only";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export function decodePolicySignerSecret(encoded: string | undefined): Keypair {
  if (!encoded)
    throw new Error("PRIVY_SHOWCASE_POLICY_SIGNER_PK is not configured.");
  const secret = bs58.decode(encoded);
  if (secret.length !== 64)
    throw new Error(
      "Policy signer secret must be a base58-encoded 64-byte Solana keypair."
    );
  return Keypair.fromSecretKey(secret);
}
