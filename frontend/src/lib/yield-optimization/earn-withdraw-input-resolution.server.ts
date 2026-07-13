import "server-only";

import type { LoyalCluster } from "@loyal-labs/actions";
import type { SmartAccountEarnUsdcWithdrawInput } from "@loyal-labs/smart-account-vaults";
import { Connection, PublicKey } from "@solana/web3.js";

import { reconcileEarnVaultPosition } from "@/lib/yield-optimization/earn-position-reconciliation.server";
import {
  earnReserveTargetFromActivePosition,
  type EarnUsdcReserveTarget,
} from "@/lib/yield-optimization/earn-reserve-target.server";
import {
  fetchEarnRpcHoldingsSnapshot,
  type EarnRpcHolding,
} from "@/lib/yield-optimization/earn-rpc-holdings.client";
import { serializeRoutePolicyState } from "@/lib/yield-optimization/earn-state-serializers.server";
import type { parseEarnWithdrawPrepareRequestBody } from "@/lib/yield-optimization/earn-withdraw-prepare-contracts.shared";
import {
  findActiveYieldRoutePolicyPair,
  findReconciledActiveYieldPositionForVault,
  type RoutePolicyRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

// Source selection + SDK-input assembly for a mobile Earn USDC withdrawal,
// extracted VERBATIM from `mobile/earn/withdraw/prepare` so the route (server
// build) and `mobile/earn/withdraw/prepare-context` (on-device build) resolve
// the exact same input. Everything here is the decision "WHAT to withdraw";
// the caller decides where the instruction build ("HOW") runs.
const EARN_DEPOSIT_VAULT_INDEX = 1;

// Resolution failures the routes surface as specific HTTP responses rather
// than a generic 500 (`missing_earn_policy` / `missing_earn_position`).
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

type EarnWithdrawSourceRequest = ReturnType<
  typeof parseEarnWithdrawPrepareRequestBody
>["source"];

type SelectedEarnWithdrawSource =
  | {
      amountRaw: bigint;
      id: string;
      liquidityMint: string;
      market: string;
      reserve: string;
      type: "reserve";
    }
  | {
      amountRaw: bigint;
      id: string;
      mint: string;
      tokenAccount: string;
      type: "idle";
    };

function publicKeyFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[]
): PublicKey | null {
  if (!metadata) {
    return null;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
    try {
      return new PublicKey(value);
    } catch {
      continue;
    }
  }

  return null;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sourceMatchesDirectIdentifier(
  source: SelectedEarnWithdrawSource,
  request: NonNullable<EarnWithdrawSourceRequest>
): boolean {
  if (source.type !== request.type) {
    return false;
  }

  const identifiers = [
    request.id,
    request.reserve,
    request.tokenAccount,
  ].filter(isNonEmptyString);

  if (identifiers.includes(source.id)) {
    return true;
  }

  return source.type === "reserve" && identifiers.includes(source.reserve);
}

function sourceMatchesStableMint(
  source: SelectedEarnWithdrawSource,
  request: NonNullable<EarnWithdrawSourceRequest>
): boolean {
  if (source.type !== request.type) {
    return false;
  }

  const identifiers = [request.id, request.liquidityMint, request.mint].filter(
    isNonEmptyString
  );

  return source.type === "reserve"
    ? identifiers.includes(source.liquidityMint)
    : identifiers.includes(source.mint);
}

function selectRequestedEarnWithdrawSource(
  sources: SelectedEarnWithdrawSource[],
  request: EarnWithdrawSourceRequest
): SelectedEarnWithdrawSource | null {
  if (!request) {
    return sources.length === 1 ? sources[0] ?? null : null;
  }

  const directMatch = sources.find((source) =>
    sourceMatchesDirectIdentifier(source, request)
  );
  if (directMatch) {
    return directMatch;
  }

  const stableMintMatches = sources.filter((source) =>
    sourceMatchesStableMint(source, request)
  );
  if (stableMintMatches.length === 1) {
    return stableMintMatches[0] ?? null;
  }

  const amountMatchedStableMintMatches = stableMintMatches.filter(
    (source) => request.amountRaw === source.amountRaw.toString()
  );

  return amountMatchedStableMintMatches.length === 1
    ? amountMatchedStableMintMatches[0] ?? null
    : null;
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
        tokenAccount,
        type: "idle",
      });
      continue;
    }
    if (!holding.reserve || !holding.market) {
      continue;
    }
    sources.push({
      amountRaw,
      id: holding.reserve,
      liquidityMint: holding.liquidityMint,
      market: holding.market,
      reserve: holding.reserve,
      type: "reserve",
    });
  }
  return sources;
}

// The deployed Kamino reserve target for a snapshot-sourced withdrawal — used
// when withdrawing idle USDC (a reserve withdrawal targets its own reserve).
// Null when the vault holds no Kamino reserve (fully idle).
function snapshotReserveTarget(
  holdings: EarnRpcHolding[]
): EarnUsdcReserveTarget | null {
  const kamino = holdings.find(
    (holding) => holding.kind === "kamino" && holding.reserve && holding.market
  );
  if (!kamino || !kamino.reserve || !kamino.market) {
    return null;
  }
  let supplyApyBps: bigint | null = null;
  if (kamino.supplyApyBps) {
    try {
      supplyApyBps = BigInt(kamino.supplyApyBps);
    } catch {
      supplyApyBps = null;
    }
  }
  return {
    liquidityMint: new PublicKey(kamino.liquidityMint),
    market: new PublicKey(kamino.market),
    reserve: new PublicKey(kamino.reserve),
    supplyApyBps,
  };
}

// Full-withdrawal targets from every live Kamino holding. Collateral metadata
// comes from the holding provenance when present; the SDK resolves omissions.
function snapshotFullWithdrawalTargets(holdings: EarnRpcHolding[]): {
  amountRaw: bigint;
  liquidityMint: PublicKey;
  market: PublicKey;
  reserve: PublicKey;
  reserveCollateralMint?: PublicKey;
  supplyApyBps: bigint | null;
}[] {
  const targets = [];
  for (const holding of holdings) {
    if (holding.kind !== "kamino" || !holding.reserve || !holding.market) {
      continue;
    }
    let amountRaw: bigint;
    try {
      amountRaw = BigInt(holding.amountRaw);
    } catch {
      continue;
    }
    if (amountRaw <= BigInt(0)) {
      continue;
    }
    let supplyApyBps: bigint | null = null;
    if (holding.supplyApyBps) {
      try {
        supplyApyBps = BigInt(holding.supplyApyBps);
      } catch {
        supplyApyBps = null;
      }
    }
    const reserveCollateralMint = publicKeyFromMetadata(holding.provenance, [
      "reserveCollateralMint",
    ]);
    targets.push({
      amountRaw,
      liquidityMint: new PublicKey(holding.liquidityMint),
      market: new PublicKey(holding.market),
      reserve: new PublicKey(holding.reserve),
      ...(reserveCollateralMint ? { reserveCollateralMint } : {}),
      supplyApyBps,
    });
  }
  return targets;
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
  amountRaw: bigint;
  mode: "partial" | "full";
  sourceRequest: EarnWithdrawSourceRequest;
  // Route-specific log prefix so on-call greps keep working per endpoint.
  logTag: string;
}): Promise<ResolvedEarnUsdcWithdraw> {
  const {
    connection,
    cluster,
    walletAddress,
    settingsPda,
    earnVaultPda,
    amountRaw,
    mode,
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
      "Set up the Earn policy before withdrawing USDC."
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
    throw new Error("No active Earn withdrawal source was found.");
  }

  let selectedSource: SelectedEarnWithdrawSource;
  let withdrawTarget: EarnUsdcReserveTarget;
  let effectiveAmountRaw: bigint;
  if (mode === "partial") {
    const selected = selectRequestedEarnWithdrawSource(
      snapshotSources,
      args.sourceRequest
    );
    if (!selected) {
      throw new Error("Select an Earn source before withdrawing.");
    }
    if (amountRaw > selected.amountRaw) {
      throw new Error("Withdrawal exceeds the selected Earn source amount.");
    }
    selectedSource = selected;
    effectiveAmountRaw = amountRaw;
    withdrawTarget =
      selected.type === "reserve"
        ? {
            liquidityMint: new PublicKey(selected.liquidityMint),
            market: new PublicKey(selected.market),
            reserve: new PublicKey(selected.reserve),
            supplyApyBps: null,
          }
        : snapshotReserveTarget(snapshot.holdings) ??
          earnReserveTargetFromActivePosition(position);
  } else {
    const largestReserveSource = snapshotSources.reduce<Extract<
      SelectedEarnWithdrawSource,
      { type: "reserve" }
    > | null>((largest, source) => {
      if (source.type !== "reserve") {
        return largest;
      }
      return !largest || source.amountRaw > largest.amountRaw
        ? source
        : largest;
    }, null);
    selectedSource =
      largestReserveSource ??
      snapshotSources.find((source) => source.type === "idle")!;
    effectiveAmountRaw = snapshotSources.reduce(
      (total, source) => total + source.amountRaw,
      BigInt(0)
    );
    withdrawTarget =
      selectedSource.type === "reserve"
        ? {
            liquidityMint: new PublicKey(selectedSource.liquidityMint),
            market: new PublicKey(selectedSource.market),
            reserve: new PublicKey(selectedSource.reserve),
            supplyApyBps: null,
          }
        : snapshotReserveTarget(snapshot.holdings) ??
          earnReserveTargetFromActivePosition(position);
  }

  const fullWithdrawalTargets =
    mode === "full" ? snapshotFullWithdrawalTargets(snapshot.holdings) : [];

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
    ...(fullWithdrawalTargets.length > 0 ? { fullWithdrawalTargets } : {}),
    // Full withdrawal and policy close are intentionally separate phases.
    closePoliciesOnFullWithdrawal: false,
    source:
      selectedSource.type === "idle"
        ? {
            amountRaw: selectedSource.amountRaw,
            id: selectedSource.id,
            mint: new PublicKey(selectedSource.mint),
            tokenAccount: new PublicKey(selectedSource.tokenAccount),
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
    mode,
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
