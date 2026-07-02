import { getConnection } from "@/lib/solana/rpc/connection";
import type { Signer } from "@/lib/wallet/signer";

import {
  confirmEarnAutodepositClose,
  confirmEarnAutodepositSetup,
  prepareEarnAutodepositClose,
  prepareEarnAutodepositSetup,
  requestEarnAutodepositSweepExecute,
  toggleEarnAutodeposit,
  updateEarnAutodepositFloor,
} from "./earn-api";
import { signEarnAuth, withEarnAuth } from "./earn-auth";
import {
  signAndSendPreparedOperation,
  signAndSendPreparedOperations,
} from "./send-prepared";
import { hydratePreparedOperation } from "./wire";

const USDC_DECIMALS = 6;
// Per-period recurring-delegation cap, matching the web default
// (DEFAULT_EARN_AUTODEPOSIT_AMOUNT_LABEL = "10,000" USDC). The cap bounds how
// much the sweep delegate can pull per month; the threshold (floor) is what the
// user actually sets.
const DEFAULT_AMOUNT_PER_PERIOD_RAW = (
  BigInt(10_000) *
  BigInt(10) ** BigInt(USDC_DECIMALS)
).toString();
// At most three setup stages (init authority -> create policy -> create
// recurring delegation); guard against a stage that never advances.
const MAX_SETUP_STAGES = 4;

function thresholdUsdToRaw(thresholdUsd: number): string {
  if (!Number.isFinite(thresholdUsd) || thresholdUsd < 0) {
    throw new Error("Autodeposit threshold must be zero or greater.");
  }
  return BigInt(Math.round(thresholdUsd * 10 ** USDC_DECIMALS)).toString();
}

// Create an Autodeposit: stands up the on-chain recurring-delegation policy that
// sweeps wallet USDC above `thresholdUsd` into Earn. Multi-stage — with
// `includeBatch` the backend returns create_policy AND the prepared-ahead
// create_recurring_delegation together, so the device signs both in ONE wallet
// prompt and sends them in order (the one-time subscription-authority init, when
// needed, is its own round). One prepare auth covers the whole flow; confirms
// reuse it. The nonce is fixed for the whole flow; the generated policy seed is
// threaded across rounds.
export async function executeEarnAutodepositSetup(args: {
  signer: Signer;
  thresholdUsd: number;
}): Promise<void> {
  const walletBalanceFloorRaw = thresholdUsdToRaw(args.thresholdUsd);
  const nonce = BigInt(Date.now()).toString();
  const connection = getConnection();

  const flowAuth = await signEarnAuth(
    args.signer,
    "earn-autodeposit-setup-prepare",
  );

  let policySeed: string | undefined;
  for (let round = 0; round < MAX_SETUP_STAGES; round++) {
    const { preparedSetup, nextPreparedSetup } = await withEarnAuth(
      args.signer,
      flowAuth,
      "earn-autodeposit-setup-prepare",
      (auth) =>
        prepareEarnAutodepositSetup({
          auth,
          amountRaw: DEFAULT_AMOUNT_PER_PERIOD_RAW,
          includeBatch: true,
          nonce,
          policySeed,
          walletBalanceFloorRaw,
        }),
    );
    const stages = [
      preparedSetup,
      ...(nextPreparedSetup ? [nextPreparedSetup] : []),
    ];

    const sent = await signAndSendPreparedOperations({
      connection,
      signer: args.signer,
      operations: stages.map((stage) =>
        hydratePreparedOperation(stage.prepared),
      ),
    });

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      await withEarnAuth(
        args.signer,
        flowAuth,
        "earn-autodeposit-setup-confirm",
        (auth) =>
          confirmEarnAutodepositSetup({
            auth,
            preparedSetup: stage,
            setupSignature: sent[i].signature,
            confirmedSlot: sent[i].confirmedSlot,
            walletBalanceFloorRaw,
          }),
      );

      // Thread the (generated) policy seed into the next round so every stage
      // targets the same policy/delegation.
      const seed = stage.persistence.policySeed ?? stage.policy.seed;
      if (seed) {
        policySeed = seed;
      }
    }
    if (stages[stages.length - 1].stage === "create_recurring_delegation") {
      return;
    }
  }

  throw new Error("Autodeposit setup did not complete after all stages.");
}

// Change the threshold on an existing Autodeposit. DB-only on the backend (no
// on-chain change), but still wallet-signature authenticated.
export async function updateEarnAutodepositThreshold(args: {
  signer: Signer;
  thresholdUsd: number;
  policyAccount: string;
  recurringDelegation: string;
  vaultIndex: number;
}): Promise<void> {
  const auth = await signEarnAuth(
    args.signer,
    "earn-autodeposit-floor-confirm",
  );
  await updateEarnAutodepositFloor({
    auth,
    policyAccount: args.policyAccount,
    recurringDelegation: args.recurringDelegation,
    vaultIndex: args.vaultIndex,
    walletBalanceFloorRaw: thresholdUsdToRaw(args.thresholdUsd),
  });
}

// Enable/disable an existing Autodeposit (the delegation stays in place; the
// sweep worker honors `active`). DB-only on the backend.
export async function setEarnAutodepositActive(args: {
  signer: Signer;
  active: boolean;
  policyAccount: string;
  recurringDelegation: string;
  vaultIndex: number;
}): Promise<void> {
  const auth = await signEarnAuth(
    args.signer,
    "earn-autodeposit-toggle-confirm",
  );
  await toggleEarnAutodeposit({
    auth,
    active: args.active,
    policyAccount: args.policyAccount,
    recurringDelegation: args.recurringDelegation,
    vaultIndex: args.vaultIndex,
  });
}

// Delete an Autodeposit: tears down the on-chain recurring delegation (one
// signed tx) and records the closed target.
export async function executeEarnAutodepositClose(args: {
  signer: Signer;
  policy: string;
  recurringDelegation: string;
}): Promise<void> {
  const prepareAuth = await signEarnAuth(
    args.signer,
    "earn-autodeposit-close-prepare",
  );
  const { preparedClose } = await prepareEarnAutodepositClose({
    auth: prepareAuth,
    policy: args.policy,
    recurringDelegation: args.recurringDelegation,
  });

  const connection = getConnection();
  const sent = await signAndSendPreparedOperation({
    connection,
    signer: args.signer,
    operation: hydratePreparedOperation(preparedClose.prepared),
  });

  // Reuses the flow's prepare auth — no extra wallet prompt.
  await withEarnAuth(
    args.signer,
    prepareAuth,
    "earn-autodeposit-close-confirm",
    (auth) =>
      confirmEarnAutodepositClose({
        auth,
        preparedClose,
        closeSignature: sent.signature,
        confirmedSlot: sent.confirmedSlot,
      }),
  );
}

// Trigger the pending scheduled Autodeposit sweep to run now instead of waiting
// out its ~1h window. DB-only on the backend (it advances `eligibleAfter` so the
// sweep worker picks it up); no on-chain signing beyond the auth signature.
export async function executeEarnAutodepositScheduledSweep(args: {
  signer: Signer;
}): Promise<void> {
  const auth = await signEarnAuth(
    args.signer,
    "earn-autodeposit-sweep-execute",
  );
  await requestEarnAutodepositSweepExecute({ auth });
}
