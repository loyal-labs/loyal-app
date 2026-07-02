import { getConnection } from "@/lib/solana/rpc/connection";
import type { Signer } from "@/lib/wallet/signer";

import {
  confirmEarnWithdraw,
  prepareEarnWithdraw,
  type EarnWithdrawMode,
  type EarnWithdrawSource,
} from "./earn-api";
import { signEarnAuth, withEarnAuth } from "./earn-auth";
import { signAndSendPreparedOperations } from "./send-prepared";
import { hydratePreparedOperation } from "./wire";

const USDC_DECIMALS = 6;

function usdToUsdcRaw(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("Withdrawal amount must be greater than 0.");
  }
  return BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS)).toString();
}

export type EarnWithdrawResult = {
  withdrawalSignatures: string[];
};

// Real on-chain Earn withdrawal: the backend prepares the transaction(s) for the
// caller's smart account (same position as web); the device wallet signs + sends
// each step in order, confirming each into the web read-model. A full exit may
// span multiple Kamino reserves (one signed step each). Recording per step is
// best-effort — the on-chain withdrawal is the source of truth and the backend
// reconciler backfills if a confirm call fails.
//
// `mode` "full" tells the backend to use the exact on-chain source amount (the
// passed `amountUsd` is only authoritative for "partial").
export async function executeEarnWithdraw(args: {
  signer: Signer;
  amountUsd: number;
  mode: EarnWithdrawMode;
  // The chosen source. Omitted/null lets the backend auto-select when there's
  // exactly one source; required (from the picker) when the position spans
  // multiple sources.
  source?: EarnWithdrawSource | null;
}): Promise<EarnWithdrawResult> {
  const amountRaw = usdToUsdcRaw(args.amountUsd);
  const prepareAuth = await signEarnAuth(args.signer, "earn-withdraw-prepare");
  const prepared = await prepareEarnWithdraw({
    auth: prepareAuth,
    amountRaw,
    mode: args.mode,
    source: args.source ?? null,
  });
  const preparedWithdraw = prepared.preparedWithdraw;

  // A full exit of a position with an active Autodeposit also tears down the
  // recurring delegation (autodepositClosePrepared). That path is signed via
  // the Autodeposit close flow (wired separately); until then, refuse rather
  // than sign a withdrawal whose policy teardown we can't complete.
  if (preparedWithdraw.autodepositClosePrepared) {
    throw new Error(
      "Withdrawing a position with active Autodeposit isn't supported on mobile yet.",
    );
  }

  const connection = getConnection();

  // Confirms reuse the flow's prepare auth — no extra wallet prompt.
  const confirmStep = async (
    withdrawalSignature: string,
    confirmedSlot: string,
    stepIndex?: number,
  ) => {
    try {
      await withEarnAuth(
        args.signer,
        prepareAuth,
        "earn-withdraw-confirm",
        (auth) =>
          confirmEarnWithdraw({
            auth,
            preparedWithdraw,
            stepIndex,
            withdrawalSignature,
            confirmedSlot,
          }),
      );
    } catch (error) {
      console.warn(
        "[earn-withdraw] confirm failed; reconciler will backfill",
        error,
      );
    }
  };

  const steps =
    preparedWithdraw.withdrawSteps && preparedWithdraw.withdrawSteps.length > 0
      ? preparedWithdraw.withdrawSteps
      : null;

  // Sign every step in one wallet prompt (Seed Vault batches them) and send
  // strictly in order; the landed steps are then recorded best-effort (the
  // reconciler backfills any recording this misses).
  const operations = (steps ?? [{ prepared: preparedWithdraw.prepared }]).map(
    (step) => hydratePreparedOperation(step.prepared),
  );
  const sent = await signAndSendPreparedOperations({
    connection,
    signer: args.signer,
    operations,
  });

  const withdrawalSignatures: string[] = [];
  for (let i = 0; i < sent.length; i++) {
    withdrawalSignatures.push(sent[i].signature);
    await confirmStep(
      sent[i].signature,
      sent[i].confirmedSlot,
      steps ? i : undefined,
    );
  }

  return { withdrawalSignatures };
}
