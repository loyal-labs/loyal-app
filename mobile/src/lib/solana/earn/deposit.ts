import { PublicKey } from "@solana/web3.js";

import { env } from "@/config/env";
import { track } from "@/lib/analytics/analytics";
import { EARN_EVENTS } from "@/lib/analytics/earn-events";
import { getConnection } from "@/lib/solana/rpc/connection";
import type { Signer } from "@/lib/wallet/signer";

import {
  confirmEarnDeposit,
  confirmEarnDepositSponsored,
  prepareEarnDeposit,
} from "./earn-api";
import { signEarnAuth, withEarnAuth } from "./earn-auth";
import {
  signAndSendPreparedOperations,
  signPreparedOperationsForSponsor,
} from "./send-prepared";
import { hydratePreparedOperation } from "./wire";

const USDC_DECIMALS = 6;

function usdToUsdcRaw(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("Deposit amount must be greater than 0.");
  }
  return BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS)).toString();
}

export type EarnDepositResult = {
  depositSignature: string;
};

// Real on-chain Earn deposit: the backend prepares the transaction(s) for the
// caller's smart account (same position as web), then the device wallet signs
// them all in one batch prompt and sends each stage in order. A first-ever
// deposit also creates the yield-routing policy (policySetup) and Kamino
// obligation (policyFinalize) as separate signed transactions; a top-up is
// just the deposit. The deposited USDC routes into
// Kamino Safe via the Earn vault. Recording into the web read-model is done via
// the confirm call (best-effort — the on-chain deposit is the source of truth
// and the backend reconciler backfills if confirm fails).
export async function executeEarnDeposit(args: {
  signer: Signer;
  amountUsd: number;
}): Promise<EarnDepositResult> {
  const amountRaw = usdToUsdcRaw(args.amountUsd);
  const prepareAuth = await signEarnAuth(args.signer, "earn-deposit-prepare");
  const prepared = await prepareEarnDeposit({
    auth: prepareAuth,
    amountRaw,
    sponsored: env.earnSponsoredDeposits,
  });

  const connection = getConnection();
  const preparedDeposit = prepared.preparedDeposit;

  // Which sponsor the backend derived from EARN_POLICY_SPONSOR_PK (null =
  // sponsor not configured → self-paid fallback). Kept as a plain log: the
  // fee payer of every sponsored tx, essential when debugging sponsor issues.
  console.log(
    "[earn-deposit] sponsorFeePayer:",
    prepared.sponsorFeePayer ?? null,
  );

  // Sponsored flow (flagged): sign every stage with the sponsor as fee payer
  // but send nothing — the sponsored confirm endpoint sponsor-signs, sends,
  // confirms, and records in one call. Falls back to the self-paid flow when
  // the backend returns no sponsor (flag off server-side, older deploy, or
  // sponsor key unconfigured).
  if (env.earnSponsoredDeposits && prepared.sponsorFeePayer) {
    // Same stage order as the self-paid flow; first-deposit policy stages are
    // absent for top-ups, so map signed transactions back with a cursor.
    const signed = await signPreparedOperationsForSponsor({
      connection,
      signer: args.signer,
      feePayer: new PublicKey(prepared.sponsorFeePayer),
      operations: [
        preparedDeposit.policySetupPrepared,
        preparedDeposit.policyFinalizePrepared,
        preparedDeposit.prepared,
      ]
        .filter((stage) => stage != null)
        .map(hydratePreparedOperation),
    });
    let cursor = 0;
    const policyTransaction = preparedDeposit.policySetupPrepared
      ? signed[cursor++]
      : undefined;
    const setupPolicyTransaction = preparedDeposit.policyFinalizePrepared
      ? signed[cursor++]
      : undefined;
    const depositTransaction = signed[cursor];
    const confirmations = await withEarnAuth(
      args.signer,
      prepareAuth,
      "earn-deposit-confirm",
      (auth) =>
        confirmEarnDepositSponsored({
          auth,
          preparedDeposit,
          depositTransaction,
          policyTransaction,
          setupPolicyTransaction,
        }),
    );
    track(EARN_EVENTS.earnDeposit, { amount_usd: args.amountUsd });
    return { depositSignature: confirmations.deposit.signature };
  }

  // All stages are prepared upfront with no build-time interdependency, so
  // they're signed in ONE wallet prompt (Seed Vault batches them) and then
  // sent strictly in order — the policy stages must land before the deposit.
  // First-deposit policy stages are absent for top-ups.
  const stages = [
    preparedDeposit.policySetupPrepared,
    preparedDeposit.policyFinalizePrepared,
    preparedDeposit.prepared,
  ];
  const sent = await signAndSendPreparedOperations({
    connection,
    signer: args.signer,
    operations: stages
      .filter((stage) => stage != null)
      .map(hydratePreparedOperation),
  });
  let cursor = 0;
  const policy = preparedDeposit.policySetupPrepared
    ? sent[cursor++]
    : undefined;
  const setupPolicy = preparedDeposit.policyFinalizePrepared
    ? sent[cursor++]
    : undefined;
  const deposit = sent[cursor];

  // Record into the web read-model, reusing the flow's prepare auth (no
  // second wallet prompt). Best-effort: never undo a confirmed on-chain
  // deposit because the DB write failed — the reconciler backfills.
  try {
    await withEarnAuth(args.signer, prepareAuth, "earn-deposit-confirm", (auth) =>
      confirmEarnDeposit({
        auth,
        preparedDeposit,
        depositSignature: deposit.signature,
        confirmedSlot: deposit.confirmedSlot,
        policySignature: policy?.signature,
        policyConfirmedSlot: policy?.confirmedSlot,
        setupPolicySignature: setupPolicy?.signature,
        setupPolicyConfirmedSlot: setupPolicy?.confirmedSlot,
      }),
    );
  } catch (error) {
    console.warn(
      "[earn-deposit] confirm failed; reconciler will backfill",
      error,
    );
  }

  // Tracked here (not in the sheets) so every deposit entry point counts once.
  track(EARN_EVENTS.earnDeposit, { amount_usd: args.amountUsd });

  return { depositSignature: deposit.signature };
}
