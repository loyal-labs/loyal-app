import { getConnection } from "@/lib/solana/rpc/connection";
import type { Signer } from "@/lib/wallet/signer";

import {
  confirmEarnAutodepositClose,
  confirmEarnAutodepositSetup,
  prepareEarnAutodepositClose,
  prepareEarnAutodepositSetup,
  toggleEarnAutodeposit,
  updateEarnAutodepositFloor,
} from "./earn-api";
import { signEarnAuth } from "./earn-auth";
import { signAndSendPreparedOperation } from "./send-prepared";
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
// sweeps wallet USDC above `thresholdUsd` into Earn. Multi-stage — the backend
// returns the next stage's prepared op each round; the device signs + confirms
// it, then re-prepares, until the recurring delegation is created. The nonce is
// fixed for the whole flow; the generated policy seed is threaded across stages.
export async function executeEarnAutodepositSetup(args: {
  signer: Signer;
  thresholdUsd: number;
}): Promise<void> {
  const walletBalanceFloorRaw = thresholdUsdToRaw(args.thresholdUsd);
  const nonce = BigInt(Date.now()).toString();
  const connection = getConnection();
  const send = (operation: Parameters<typeof hydratePreparedOperation>[0]) =>
    signAndSendPreparedOperation({
      connection,
      signer: args.signer,
      operation: hydratePreparedOperation(operation),
    });

  let policySeed: string | undefined;
  for (let stage = 0; stage < MAX_SETUP_STAGES; stage++) {
    const prepareAuth = await signEarnAuth(
      args.signer,
      "earn-autodeposit-setup-prepare",
    );
    const { preparedSetup } = await prepareEarnAutodepositSetup({
      auth: prepareAuth,
      amountRaw: DEFAULT_AMOUNT_PER_PERIOD_RAW,
      nonce,
      policySeed,
      walletBalanceFloorRaw,
    });

    const sent = await send(preparedSetup.prepared);
    const confirmAuth = await signEarnAuth(
      args.signer,
      "earn-autodeposit-setup-confirm",
    );
    await confirmEarnAutodepositSetup({
      auth: confirmAuth,
      preparedSetup,
      setupSignature: sent.signature,
      confirmedSlot: sent.confirmedSlot,
      walletBalanceFloorRaw,
    });

    // Thread the (generated) policy seed into the next stage so every stage
    // targets the same policy/delegation.
    const seed = preparedSetup.persistence.policySeed ?? preparedSetup.policy.seed;
    if (seed) {
      policySeed = seed;
    }
    if (preparedSetup.stage === "create_recurring_delegation") {
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

  const confirmAuth = await signEarnAuth(
    args.signer,
    "earn-autodeposit-close-confirm",
  );
  await confirmEarnAutodepositClose({
    auth: confirmAuth,
    preparedClose,
    closeSignature: sent.signature,
    confirmedSlot: sent.confirmedSlot,
  });
}
