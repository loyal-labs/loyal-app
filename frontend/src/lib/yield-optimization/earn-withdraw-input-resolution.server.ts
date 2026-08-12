import "server-only";

import type { LoyalCluster } from "@loyal-labs/actions";
import type { SmartAccountEarnUsdcWithdrawInput } from "@loyal-labs/smart-account-vaults";
import { type Connection, PublicKey } from "@solana/web3.js";

import { reconcileEarnVaultPosition } from "@/lib/yield-optimization/earn-position-reconciliation.server";
import type { EarnUsdcReserveTarget } from "@/lib/yield-optimization/earn-reserve-target.server";
import {
  type EarnRpcHolding,
  fetchEarnRpcHoldingsSnapshot,
} from "@/lib/yield-optimization/earn-rpc-holdings.client";
import { serializeRoutePolicyState } from "@/lib/yield-optimization/earn-state-serializers.server";
import type { parseEarnWithdrawPrepareRequestBody } from "@/lib/yield-optimization/earn-withdraw-prepare-contracts.shared";
import {
  findActiveYieldRoutePolicyPair,
  findReconciledActiveYieldPositionForVault,
  type RoutePolicyRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

// Source selection + SDK-input assembly for a mobile Earn withdrawal,
// extracted VERBATIM from `mobile/earn/withdraw/prepare` so the route (server
// build) and `mobile/earn/withdraw/prepare-context` (on-device build) resolve
// the exact same input. Everything here is the decision "WHAT to withdraw";
// the caller decides where the instruction build ("HOW") runs.
const EARN_DEPOSIT_VAULT_INDEX = 1;

// Resolution failures the routes surface as specific HTTP responses rather
// than a generic 500. Every rejection that describes the CALLER's state — no
// policy, no position, no source, a source that no longer covers the amount —
// belongs here: answering 500 for those made a stale client balance page the
// team as a server fault, and the device reported it as `request_failed` with
// `httpStatus: 500` (ASK-1903). Only genuine server faults fall through.
export class EarnWithdrawResolveError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "EarnWithdrawResolveError";
    this.status = status;
    this.code = code;
  }
}

type EarnWithdrawSourceId = ReturnType<
  typeof parseEarnWithdrawPrepareRequestBody
>["sourceId"];

type SelectedEarnWithdrawSource =
  | {
      amountRaw: bigint;
      id: string;
      liquidityMint: string;
      market: string;
      reserve: string;
      sourceId: string;
      tokenProgramId: string;
      type: "reserve";
    }
  | {
      amountRaw: bigint;
      id: string;
      mint: string;
      tokenAccount: string;
      sourceId: string;
      tokenProgramId: string;
      type: "idle";
    };

function selectRequestedEarnWithdrawSource(
  sources: SelectedEarnWithdrawSource[],
  sourceId: EarnWithdrawSourceId
): SelectedEarnWithdrawSource {
  const matches = sources.filter((source) => source.sourceId === sourceId);
  if (matches.length !== 1) {
    throw new EarnWithdrawResolveError(
      409,
      "earn_withdraw_source_changed",
      "The selected Earn source changed. Refresh and choose it again."
    );
  }
  const selected = matches.at(0);
  if (!selected) {
    throw new EarnWithdrawResolveError(
      409,
      "earn_withdraw_source_changed",
      "The selected Earn source changed. Refresh and choose it again."
    );
  }
  return selected;
}

// Build withdrawal sources from the live on-chain holdings snapshot. The DB
// read-model cannot follow a cross-market rebalance. Drop entries missing the
// identifiers a withdrawal needs to match or build.
function buildSnapshotWithdrawSources(
  holdings: EarnRpcHolding[]
): SelectedEarnWithdrawSource[] {
  const sources: SelectedEarnWithdrawSource[] = [];
  for (const holding of holdings) {
    let amountRaw: bigint;
    try {
      amountRaw = BigInt(holding.amountRaw);
    } catch {
      continue;
    }
    if (amountRaw <= BigInt(0)) {
      continue;
    }
    if (holding.kind === "idle") {
      const tokenAccount = holding.provenance.tokenAccount;
      if (!tokenAccount) {
        continue;
      }
      sources.push({
        amountRaw,
        id: tokenAccount,
        mint: holding.liquidityMint,
        sourceId: holding.sourceId,
        tokenAccount,
        tokenProgramId: holding.tokenProgramId,
        type: "idle",
      });
      continue;
    }
    if (!(holding.reserve && holding.market)) {
      continue;
    }
    sources.push({
      amountRaw,
      id: holding.reserve,
      liquidityMint: holding.liquidityMint,
      market: holding.market,
      reserve: holding.reserve,
      sourceId: holding.sourceId,
      tokenProgramId: holding.tokenProgramId,
      type: "reserve",
    });
  }
  return sources;
}

export type ResolvedEarnUsdcWithdraw = {
  // Complete SDK input, ready for `client.prepareEarnUsdcWithdraw(input)`.
  input: SmartAccountEarnUsdcWithdrawInput;
  policy: RoutePolicyRecord;
  effectiveAmountRaw: bigint;
};

export async function resolveEarnUsdcWithdrawInput(args: {
  connection: Connection;
  cluster: LoyalCluster;
  programId: PublicKey;
  policySigner: PublicKey;
  walletAddress: string;
  settingsPda: string;
  earnVaultPda: PublicKey;
  requestedAmountRaw: bigint | "max";
  sourceId: EarnWithdrawSourceId;
  // Route-specific log prefix so on-call greps keep working per endpoint.
  logTag: string;
}): Promise<ResolvedEarnUsdcWithdraw> {
  const {
    connection,
    cluster,
    walletAddress,
    settingsPda,
    earnVaultPda,
    requestedAmountRaw,
    logTag,
  } = args;
  const settingsPdaKey = new PublicKey(settingsPda);
  // Reconcile the DB position against the live on-chain Kamino obligation
  // before deriving the withdrawal target — otherwise a stale snapshot points
  // the withdraw at a reserve/market whose vanilla obligation doesn't exist
  // (KLEND_OBLIGATION_NOT_FOUND). Mirrors the web `withdrawals/prepare` route.
  await reconcileEarnVaultPosition({
    authority: walletAddress,
    cluster,
    connection,
    force: true,
    settings: settingsPda,
    vaultPubkey: earnVaultPda.toBase58(),
  });
  const [policyResult, position] = await Promise.all([
    findActiveYieldRoutePolicyPair({
      authority: walletAddress,
      cluster,
      settings: settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      vaultPubkey: earnVaultPda.toBase58(),
    }),
    findReconciledActiveYieldPositionForVault({
      cluster,
      settings: settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      walletAddress,
    }),
  ]);
  if (!policyResult?.routePolicy) {
    console.warn(`[${logTag}] missing active Earn policy`, {
      cluster,
      settings: settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      walletAddress,
    });
    throw new EarnWithdrawResolveError(
      409,
      "missing_earn_policy",
      "Set up the Earn policy before withdrawing."
    );
  }
  const policy = policyResult.routePolicy;

  if (!position) {
    console.warn(`[${logTag}] missing active Earn position`, {
      cluster,
      settings: settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      walletAddress,
    });
    throw new EarnWithdrawResolveError(
      409,
      "missing_earn_position",
      "No active Earn position was found for this withdrawal."
    );
  }

  const snapshot = await fetchEarnRpcHoldingsSnapshot({
    cluster,
    connection,
    policy: serializeRoutePolicyState(
      policyResult.routePolicy,
      policyResult.setupPolicy ?? null
    ),
    programId: args.programId,
    settingsPda: settingsPdaKey,
  });
  const snapshotSources = buildSnapshotWithdrawSources(snapshot.holdings);
  if (snapshotSources.length === 0) {
    throw new EarnWithdrawResolveError(
      409,
      "missing_earn_withdraw_source",
      "No active Earn withdrawal source was found."
    );
  }

  const selectedSource = selectRequestedEarnWithdrawSource(
    snapshotSources,
    args.sourceId
  );
  const effectiveAmountRaw =
    requestedAmountRaw === "max"
      ? selectedSource.amountRaw
      : requestedAmountRaw;
  if (effectiveAmountRaw > selectedSource.amountRaw) {
    throw new EarnWithdrawResolveError(
      409,
      "earn_withdraw_amount_exceeds_source",
      "Withdrawal exceeds the selected Earn source amount."
    );
  }
  const withdrawTarget: EarnUsdcReserveTarget | undefined =
    selectedSource.type === "reserve"
      ? {
          liquidityMint: new PublicKey(selectedSource.liquidityMint),
          liquidityTokenProgram: new PublicKey(selectedSource.tokenProgramId),
          market: new PublicKey(selectedSource.market),
          reserve: new PublicKey(selectedSource.reserve),
          supplyApyBps: null,
        }
      : undefined;

  const yieldRoutingPolicy = {
    account: new PublicKey(policy.policyAccount),
    seed: policy.policySeed,
    ...(policyResult?.setupPolicy
      ? {
          setupPolicy: {
            account: new PublicKey(policyResult.setupPolicy.policyAccount),
            seed: policyResult.setupPolicy.policySeed,
          },
        }
      : {}),
  };
  const withdrawInput = {
    amountRaw: effectiveAmountRaw,
    cluster,
    feePayer: new PublicKey(walletAddress),
    policySigner: args.policySigner,
    settingsPda: settingsPdaKey,
    target: withdrawTarget,
    // Full withdrawal and policy close are intentionally separate phases.
    closePoliciesOnFullWithdrawal: false,
    source:
      selectedSource.type === "idle"
        ? {
            amountRaw: selectedSource.amountRaw,
            id: selectedSource.id,
            mint: new PublicKey(selectedSource.mint),
            tokenAccount: new PublicKey(selectedSource.tokenAccount),
            tokenProgramId: new PublicKey(selectedSource.tokenProgramId),
            type: "idle" as const,
          }
        : {
            amountRaw: selectedSource.amountRaw,
            id: selectedSource.id,
            liquidityMint: new PublicKey(selectedSource.liquidityMint),
            market: new PublicKey(selectedSource.market),
            reserve: new PublicKey(selectedSource.reserve),
            type: "reserve" as const,
          },
    walletAddress: new PublicKey(walletAddress),
    yieldRoutingPolicy,
  };

  const input: SmartAccountEarnUsdcWithdrawInput = {
    ...withdrawInput,
    mode: "partial",
  };

  return { input, policy, effectiveAmountRaw };
}

// Wire form of the resolved SDK input, served by `withdraw/prepare-context`
// so the device can hydrate it and run `prepareEarnUsdcWithdraw` locally.
// Keep in sync with the mobile hydrator (`mobile/src/lib/solana/earn/wire.ts`).
export function serializeEarnUsdcWithdrawInput(
  input: SmartAccountEarnUsdcWithdrawInput
) {
  return {
    amountRaw: input.amountRaw.toString(),
    mode: input.mode,
    closePoliciesOnFullWithdrawal: input.closePoliciesOnFullWithdrawal ?? false,
    policySigner: input.policySigner.toBase58(),
    source: input.source
      ? input.source.type === "idle"
        ? {
            amountRaw: input.source.amountRaw.toString(),
            id: input.source.id,
            mint: input.source.mint.toBase58(),
            tokenAccount: input.source.tokenAccount.toBase58(),
            tokenProgramId: input.source.tokenProgramId.toBase58(),
            type: "idle" as const,
          }
        : {
            amountRaw: input.source.amountRaw.toString(),
            id: input.source.id,
            liquidityMint: input.source.liquidityMint.toBase58(),
            market: input.source.market.toBase58(),
            reserve: input.source.reserve.toBase58(),
            type: "reserve" as const,
          }
      : null,
    target: input.target
      ? {
          liquidityMint: input.target.liquidityMint.toBase58(),
          market: input.target.market.toBase58(),
          reserve: input.target.reserve.toBase58(),
          supplyApyBps: input.target.supplyApyBps?.toString() ?? null,
        }
      : null,
    fullWithdrawalTargets:
      input.fullWithdrawalTargets?.map((target) => ({
        amountRaw: target.amountRaw?.toString() ?? null,
        liquidityMint: target.liquidityMint.toBase58(),
        market: target.market.toBase58(),
        reserve: target.reserve.toBase58(),
        reserveCollateralMint: target.reserveCollateralMint?.toBase58() ?? null,
        reserveLiquiditySupply:
          target.reserveLiquiditySupply?.toBase58() ?? null,
        supplyApyBps: target.supplyApyBps?.toString() ?? null,
        vaultCollateralAta: target.vaultCollateralAta?.toBase58() ?? null,
      })) ?? null,
    yieldRoutingPolicy: {
      account: input.yieldRoutingPolicy!.account.toBase58(),
      seed: input.yieldRoutingPolicy!.seed.toString(),
      setupPolicy: input.yieldRoutingPolicy!.setupPolicy
        ? {
            account: input.yieldRoutingPolicy!.setupPolicy.account.toBase58(),
            seed: input.yieldRoutingPolicy!.setupPolicy.seed.toString(),
          }
        : null,
    },
    autodepositClose:
      input.mode === "full" && input.autodepositClose
        ? {
            policy: input.autodepositClose.policy.toBase58(),
            recurringDelegation:
              input.autodepositClose.recurringDelegation.toBase58(),
          }
        : null,
  };
}
