import { normalizeLoyalCluster } from "@loyal-labs/actions";
import {
  createSmartAccountVaultsClient,
  type SmartAccountEarnUsdcWithdrawInput,
} from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import { getConnection } from "@/lib/solana/rpc/connection";
import type { Signer } from "@/lib/wallet/signer";

import { executeEarnAutodepositClose } from "./autodeposit";
import {
  confirmEarnWithdraw,
  fetchEarnWithdrawPrepareContext,
  prepareEarnWithdraw,
  type EarnAuthFields,
  type EarnWithdrawMode,
  type EarnWithdrawPrepareContext,
  type EarnWithdrawSource,
  type WirePreparedEarnWithdraw,
} from "./earn-api";
import { signEarnAuth, withEarnAuth } from "./earn-auth";
import { signAndSendPreparedOperations } from "./send-prepared";
import {
  hydratePreparedOperation,
  serializePreparedEarnUsdcWithdraw,
  type HydratedPreparedOperation,
} from "./wire";

const USDC_DECIMALS = 6;
// A wallet normally has one live Autodeposit, but historic duplicate setups
// left some with several; each re-prepare surfaces the next one. The cap
// guards against a close that never sticks in the read-model.
const MAX_WITHDRAW_AUTODEPOSIT_CLOSES = 4;

function usdToUsdcRaw(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("Withdrawal amount must be greater than 0.");
  }
  return BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS)).toString();
}

export type EarnWithdrawResult = {
  withdrawalSignatures: string[];
};

// Rebuild the SDK withdraw input from the `prepare-context` wire form. The
// context's `autodepositClose` is handled by the close-first loop in
// `executeEarnWithdraw` and deliberately NOT passed to the SDK — mobile
// closes the Autodeposit as its own flow (with its own confirms) and
// re-resolves, instead of merging the close into the withdraw transaction.
function hydrateEarnWithdrawInput(
  context: EarnWithdrawPrepareContext,
  walletAddress: PublicKey,
): SmartAccountEarnUsdcWithdrawInput {
  const wire = context.withdrawInput;
  const base = {
    amountRaw: BigInt(wire.amountRaw),
    closePoliciesOnFullWithdrawal: wire.closePoliciesOnFullWithdrawal,
    cluster: normalizeLoyalCluster(context.cluster),
    feePayer: walletAddress,
    policySigner: new PublicKey(wire.policySigner),
    settingsPda: new PublicKey(context.settingsPda),
    walletAddress,
    ...(wire.source
      ? {
          source:
            wire.source.type === "idle"
              ? {
                  amountRaw: BigInt(wire.source.amountRaw),
                  id: wire.source.id,
                  mint: new PublicKey(wire.source.mint),
                  tokenAccount: new PublicKey(wire.source.tokenAccount),
                  type: "idle" as const,
                }
              : {
                  amountRaw: BigInt(wire.source.amountRaw),
                  id: wire.source.id,
                  liquidityMint: new PublicKey(wire.source.liquidityMint),
                  market: new PublicKey(wire.source.market),
                  reserve: new PublicKey(wire.source.reserve),
                  type: "reserve" as const,
                },
        }
      : {}),
    ...(wire.target
      ? {
          target: {
            liquidityMint: new PublicKey(wire.target.liquidityMint),
            market: new PublicKey(wire.target.market),
            reserve: new PublicKey(wire.target.reserve),
            supplyApyBps: wire.target.supplyApyBps
              ? BigInt(wire.target.supplyApyBps)
              : null,
          },
        }
      : {}),
    ...(wire.fullWithdrawalTargets
      ? {
          fullWithdrawalTargets: wire.fullWithdrawalTargets.map((target) => ({
            ...(target.amountRaw
              ? { amountRaw: BigInt(target.amountRaw) }
              : {}),
            liquidityMint: new PublicKey(target.liquidityMint),
            market: new PublicKey(target.market),
            reserve: new PublicKey(target.reserve),
            ...(target.reserveCollateralMint
              ? {
                  reserveCollateralMint: new PublicKey(
                    target.reserveCollateralMint,
                  ),
                }
              : {}),
            ...(target.reserveLiquiditySupply
              ? {
                  reserveLiquiditySupply: new PublicKey(
                    target.reserveLiquiditySupply,
                  ),
                }
              : {}),
            supplyApyBps: target.supplyApyBps
              ? BigInt(target.supplyApyBps)
              : null,
            ...(target.vaultCollateralAta
              ? { vaultCollateralAta: new PublicKey(target.vaultCollateralAta) }
              : {}),
          })),
        }
      : {}),
    yieldRoutingPolicy: {
      account: new PublicKey(wire.yieldRoutingPolicy.account),
      seed: BigInt(wire.yieldRoutingPolicy.seed),
      ...(wire.yieldRoutingPolicy.setupPolicy
        ? {
            setupPolicy: {
              account: new PublicKey(wire.yieldRoutingPolicy.setupPolicy.account),
              seed: BigInt(wire.yieldRoutingPolicy.setupPolicy.seed),
            },
          }
        : {}),
    },
  };
  return wire.mode === "full"
    ? { ...base, mode: "full" }
    : { ...base, mode: "partial" };
}

// Shared back half: sign every step in one wallet prompt (Seed Vault batches
// them), send strictly in order, then record each landed step best-effort —
// the on-chain withdrawal is the source of truth and the backend reconciler
// backfills any recording this misses.
async function signSendAndConfirmWithdraw(args: {
  signer: Signer;
  prepareAuth: EarnAuthFields;
  // Step operations in send order (a single-step withdrawal passes one).
  operations: HydratedPreparedOperation[];
  // Whether `operations` came from `withdrawSteps` (confirms then carry the
  // step index) or the single top-level prepared op.
  hasSteps: boolean;
  // Echoed to `withdraw/confirm` verbatim — the server-prepared wire object
  // or the device-prepared serialization (identical shapes).
  wirePreparedWithdraw: WirePreparedEarnWithdraw;
}): Promise<EarnWithdrawResult> {
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
        args.prepareAuth,
        "earn-withdraw-confirm",
        (auth) =>
          confirmEarnWithdraw({
            auth,
            preparedWithdraw: args.wirePreparedWithdraw,
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

  const sent = await signAndSendPreparedOperations({
    connection,
    signer: args.signer,
    operations: args.operations,
  });

  const withdrawalSignatures: string[] = [];
  for (let i = 0; i < sent.length; i++) {
    withdrawalSignatures.push(sent[i].signature);
    await confirmStep(
      sent[i].signature,
      sent[i].confirmedSlot,
      args.hasSteps ? i : undefined,
    );
  }

  return { withdrawalSignatures };
}

// Real on-chain Earn withdrawal from the caller's smart account (same position
// as web). The withdraw transactions are built ON-DEVICE with the
// smart-account-vaults SDK (mirroring the deposit and autodeposit flows): the
// backend `prepare-context` call keeps source selection and reconcile, and the
// RPC-heavy instruction build runs on the device's own RPC/IP allowance. A
// full exit may span multiple Kamino reserves (one signed step each).
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
  const fetchContext = () =>
    withEarnAuth(args.signer, prepareAuth, "earn-withdraw-prepare", (auth) =>
      fetchEarnWithdrawPrepareContext({
        auth,
        amountRaw,
        mode: args.mode,
        source: args.source ?? null,
      }),
    );

  let context = await fetchContext();

  // A full exit of a position with an active Autodeposit also tears down the
  // recurring delegation (mirrors web): close it via the Autodeposit close
  // flow first, then re-resolve the withdrawal against the post-close state.
  for (let round = 0; context?.withdrawInput.autodepositClose; round++) {
    if (round >= MAX_WITHDRAW_AUTODEPOSIT_CLOSES) {
      throw new Error(
        "Couldn't remove the Autodeposit tied to this position. Delete the Autodeposit and try again.",
      );
    }
    const close = context.withdrawInput.autodepositClose;
    await executeEarnAutodepositClose({
      signer: args.signer,
      policy: close.policy,
      recurringDelegation: close.recurringDelegation,
      source: "withdraw",
    });
    context = await fetchContext();
  }

  if (context) {
    const client = createSmartAccountVaultsClient({
      connection: getConnection(),
      programId: new PublicKey(context.programId),
    });
    const preparedWithdraw = await client.prepareEarnUsdcWithdraw(
      hydrateEarnWithdrawInput(context, args.signer.publicKey),
    );
    const hasSteps = preparedWithdraw.withdrawSteps.length > 0;
    return signSendAndConfirmWithdraw({
      signer: args.signer,
      prepareAuth,
      operations: hasSteps
        ? preparedWithdraw.withdrawSteps.map((step) => step.prepared)
        : [preparedWithdraw.prepared],
      hasSteps,
      wirePreparedWithdraw: serializePreparedEarnUsdcWithdraw(preparedWithdraw),
    });
  }

  // Backend predates `prepare-context` — legacy server-side prepare.
  const prepare = () =>
    withEarnAuth(args.signer, prepareAuth, "earn-withdraw-prepare", (auth) =>
      prepareEarnWithdraw({
        auth,
        amountRaw,
        mode: args.mode,
        source: args.source ?? null,
      }),
    );
  let preparedWithdraw = (await prepare()).preparedWithdraw;

  for (let round = 0; preparedWithdraw.autodepositClosePrepared; round++) {
    if (round >= MAX_WITHDRAW_AUTODEPOSIT_CLOSES) {
      throw new Error(
        "Couldn't remove the Autodeposit tied to this position. Delete the Autodeposit and try again.",
      );
    }
    const close = preparedWithdraw.autodepositClosePrepared;
    await executeEarnAutodepositClose({
      signer: args.signer,
      policy: close.policy.account,
      recurringDelegation: close.subscription.recurringDelegation,
      source: "withdraw",
    });
    preparedWithdraw = (await prepare()).preparedWithdraw;
  }

  const steps =
    preparedWithdraw.withdrawSteps && preparedWithdraw.withdrawSteps.length > 0
      ? preparedWithdraw.withdrawSteps
      : null;
  return signSendAndConfirmWithdraw({
    signer: args.signer,
    prepareAuth,
    operations: (steps ?? [{ prepared: preparedWithdraw.prepared }]).map(
      (step) => hydratePreparedOperation(step.prepared),
    ),
    hasSteps: steps !== null,
    wirePreparedWithdraw: preparedWithdraw,
  });
}
