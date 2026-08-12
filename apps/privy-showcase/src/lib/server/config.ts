import "server-only";
import { PrivyClient } from "@privy-io/node";
import { Keypair } from "@solana/web3.js";
import { decodePolicySignerSecret } from "./policy-key";

export function getPrivyClient(): PrivyClient {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret)
    throw new Error("Privy server credentials are not configured.");
  return new PrivyClient({ appId, appSecret });
}

export function getPolicySigner(): Keypair {
  return decodePolicySignerSecret(process.env.PRIVY_SHOWCASE_POLICY_SIGNER_PK);
}
