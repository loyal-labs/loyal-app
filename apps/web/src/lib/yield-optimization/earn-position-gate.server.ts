import { pda } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey } from "@solana/web3.js";

import { getServerEnv } from "@/lib/core/config/server";

import { findActiveYieldRoutePolicyPair } from "./yield-deposit-repository.server";

// An Autodeposit sweep can only route into an ACTIVE Earn position — the
// route policy is created by a user-signed deposit, and the sweep worker
// (delegate) can't initialize one. Any Autodeposit write path (setup prepare,
// execute-now) must hold this gate: without it the target strands every sweep
// as a perpetual worker failure ("no active Earn route policy") that the app
// renders as "Executing…" forever. Callers fail OPEN on thrown lookup errors —
// the client pre-gates setup and the worker's refusal remains the last line.
const EARN_VAULT_INDEX = 1;

export const EARN_POSITION_REQUIRED_ERROR = {
  code: "earn_position_required",
  message:
    "Autodeposit needs an active Earn account to deposit into. Make a deposit first.",
} as const;

export async function hasActiveEarnRoutePolicyPair(input: {
  cluster: string;
  settingsPda: string;
  walletAddress: string;
}): Promise<boolean> {
  const [earnVaultPda] = pda.getSmartAccountPda({
    accountIndex: EARN_VAULT_INDEX,
    programId: new PublicKey(getServerEnv().loyalSmartAccounts.programId),
    settingsPda: new PublicKey(input.settingsPda),
  });
  const policyPair = await findActiveYieldRoutePolicyPair({
    authority: input.walletAddress,
    cluster: input.cluster,
    settings: input.settingsPda,
    vaultIndex: EARN_VAULT_INDEX,
    vaultPubkey: earnVaultPda.toBase58(),
  });
  return Boolean(policyPair?.routePolicy);
}
