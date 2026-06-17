import { getConnection } from "@/lib/solana/rpc/connection";
import type { Signer } from "@/lib/wallet/signer";

import { confirmEarnDeposit, prepareEarnDeposit } from "./earn-api";
import { signEarnAuth } from "./earn-auth";
import {
  signAndSendPreparedOperation,
  type SentTransaction,
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
// caller's smart account (same position as web), then the device wallet signs +
// sends each stage. A first-ever deposit also creates the yield-routing policy
// (policySetup) and Kamino obligation (policyFinalize) as separate signed
// transactions; a top-up is just the deposit. The deposited USDC routes into
// Kamino Safe via the Earn vault. Recording into the web read-model is done via
// the confirm call (best-effort — the on-chain deposit is the source of truth
// and the backend reconciler backfills if confirm fails).
export async function executeEarnDeposit(args: {
  signer: Signer;
  amountUsd: number;
}): Promise<EarnDepositResult> {
  const amountRaw = usdToUsdcRaw(args.amountUsd);
  const prepareAuth = await signEarnAuth(args.signer, "earn-deposit-prepare");
  const prepared = await prepareEarnDeposit({ auth: prepareAuth, amountRaw });

  const connection = getConnection();
  const preparedDeposit = prepared.preparedDeposit;
  const send = (operation: Parameters<typeof hydratePreparedOperation>[0]) =>
    signAndSendPreparedOperation({
      connection,
      signer: args.signer,
      operation: hydratePreparedOperation(operation),
    });

  // First-deposit policy stages (absent for top-ups).
  let policy: SentTransaction | undefined;
  if (preparedDeposit.policySetupPrepared) {
    policy = await send(preparedDeposit.policySetupPrepared);
  }
  let setupPolicy: SentTransaction | undefined;
  if (preparedDeposit.policyFinalizePrepared) {
    setupPolicy = await send(preparedDeposit.policyFinalizePrepared);
  }
  const deposit = await send(preparedDeposit.prepared);

  // Record into the web read-model. Best-effort: never undo a confirmed
  // on-chain deposit because the DB write failed — the reconciler backfills.
  try {
    const confirmAuth = await signEarnAuth(args.signer, "earn-deposit-confirm");
    await confirmEarnDeposit({
      auth: confirmAuth,
      preparedDeposit,
      depositSignature: deposit.signature,
      confirmedSlot: deposit.confirmedSlot,
      policySignature: policy?.signature,
      policyConfirmedSlot: policy?.confirmedSlot,
      setupPolicySignature: setupPolicy?.signature,
      setupPolicyConfirmedSlot: setupPolicy?.confirmedSlot,
    });
  } catch (error) {
    console.warn(
      "[earn-deposit] confirm failed; reconciler will backfill",
      error,
    );
  }

  return { depositSignature: deposit.signature };
}
