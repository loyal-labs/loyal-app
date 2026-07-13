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
  findCurrentNonzeroYieldVaultReservePositions,
  findCurrentYieldVaultIdleTokenBalances,
  findReconciledActiveYieldPositionForVault,
  type CurrentYieldVaultIdleTokenBalanceRecord,
  type CurrentYieldVaultReservePositionRecord,
  type RoutePolicyRecord,
  type UserYieldPositionRecord,
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

// Build withdraw sources from the LIVE on-chain holdings snapshot (partial
// withdrawals). The DB read-model + reconcile can't follow a cross-market
// rebalance; this scans the policy's markets and reflects reality. Drops entries
// missing the identifiers a withdrawal needs to match/build.
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

// Full-withdrawal targets from the live snapshot (fallback when the DB rows
// are empty). Collateral metadata comes from the holding provenance when
// present; the SDK resolves anything omitted on-chain.
function snapshotFullWithdrawalTargets(
  holdings: EarnRpcHolding[],
  reserve: string
): {
  amountRaw: bigint;
  liquidityMint: PublicKey;
  market: PublicKey;
  reserve: PublicKey;
  reserveCollateralMint?: PublicKey;
  supplyApyBps: bigint | null;
}[] {
  const targets = [];
  for (const holding of holdings) {
    if (
      holding.kind !== "kamino" ||
      holding.reserve !== reserve ||
      !holding.market
    ) {
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

// Withdraw sources from the reconciled DB rows (full exits) — the row
// planning metadata carries the collateral accounts the full-withdrawal
// instruction prefers. Empty after a cross-market rebalance the reconcile
// couldn't follow; the caller then falls back to the live snapshot.
function buildDbEarnWithdrawSources(args: {
  idleRows: CurrentYieldVaultIdleTokenBalanceRecord[];
  position: UserYieldPositionRecord;
  reserveRows: CurrentYieldVaultReservePositionRecord[];
}): SelectedEarnWithdrawSource[] {
  const reserveSources = args.reserveRows
    .filter((row) => row.amountRaw > BigInt(0))
    .map((row) => {
      if (!row.market) {
        throw new Error("Reconciled Earn reserve row is missing a market.");
      }
      return {
        amountRaw: row.amountRaw,
        id: row.reserve,
        liquidityMint: row.liquidityMint,
        market: row.market,
        reserve: row.reserve,
        type: "reserve" as const,
      };
    });
  const idleSources = args.idleRows
    .filter((row) => row.amountRaw > BigInt(0))
    .map((row) => ({
      amountRaw: row.amountRaw,
      id: row.tokenAccount,
      mint: row.mint,
      tokenAccount: row.tokenAccount,
      type: "idle" as const,
    }));
  const positionFallbackSources =
    reserveSources.length === 0 &&
    idleSources.length === 0 &&
    isNonEmptyString(args.position.currentMarket) &&
    args.position.currentAmountRaw > BigInt(0)
      ? [
          {
            amountRaw: args.position.currentAmountRaw,
            id: args.position.currentReserve,
            liquidityMint: args.position.currentLiquidityMint,
            market: args.position.currentMarket,
            reserve: args.position.currentReserve,
            type: "reserve" as const,
          },
        ]
      : [];
  return [...reserveSources, ...idleSources, ...positionFallbackSources];
}

function selectEarnWithdrawSource(args: {
  amountRaw: bigint;
  idleRows: CurrentYieldVaultIdleTokenBalanceRecord[];
  mode: "partial" | "full";
  position: UserYieldPositionRecord;
  request: EarnWithdrawSourceRequest;
  reserveRows: CurrentYieldVaultReservePositionRecord[];
}): SelectedEarnWithdrawSource {
  const sources = buildDbEarnWithdrawSources({
    idleRows: args.idleRows,
    position: args.position,
    reserveRows: args.reserveRows,
  });

  if (sources.length === 0) {
    throw new Error("No active Earn withdrawal source was found.");
  }

  const selected = selectRequestedEarnWithdrawSource(sources, args.request);

  if (!selected) {
    throw new Error("Select an Earn source before withdrawing.");
  }
  if (args.mode === "partial" && args.amountRaw > selected.amountRaw) {
    throw new Error("Withdrawal exceeds the selected Earn source amount.");
  }

  return selected;
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
  const [policyResult, position, currentReserveRows, currentIdleRows] =
    await Promise.all([
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
      findCurrentNonzeroYieldVaultReservePositions({
        cluster,
        settings: settingsPda,
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: earnVaultPda.toBase58(),
        walletAddress,
      }),
      findCurrentYieldVaultIdleTokenBalances({
        cluster,
        settings: settingsPda,
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: earnVaultPda.toBase58(),
        walletAddress,
      }),
    ]);
  const policy = policyResult?.routePolicy ?? null;
  if (!policy) {
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

  // Partial withdrawals source from the LIVE on-chain holdings snapshot — the
  // same read `/holdings`, the withdraw picker, and the positions sheet use.
  // The DB read-model + reconcile can't follow a cross-market rebalance, so it
  // reports a stale reserve that the picker showed and this route would reject
  // ("Select an Earn source"). Full exits keep the DB path (its reconciled
  // rows carry the collateral metadata the full-withdrawal instruction needs).
  let selectedSource: SelectedEarnWithdrawSource;
  let withdrawTarget: EarnUsdcReserveTarget;
  let effectiveAmountRaw: bigint;
  // Set when a full exit had to source from the live snapshot (DB rows
  // empty); the full-withdrawal targets are then built from it too.
  let snapshotFullExitHoldings: EarnRpcHolding[] | null = null;
  if (mode === "partial") {
    const snapshot = await fetchEarnRpcHoldingsSnapshot({
      cluster,
      connection,
      policy: policyResult
        ? serializeRoutePolicyState(
            policyResult.routePolicy,
            policyResult.setupPolicy ?? null
          )
        : null,
      programId: args.programId,
      settingsPda: settingsPdaKey,
    });
    const snapshotSources = buildSnapshotWithdrawSources(snapshot.holdings);
    if (snapshotSources.length === 0) {
      throw new Error("No active Earn withdrawal source was found.");
    }
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
  } else if (
    buildDbEarnWithdrawSources({
      idleRows: currentIdleRows,
      position,
      reserveRows: currentReserveRows,
    }).length === 0
  ) {
    // Full-exit snapshot fallback: after a cross-market rebalance the
    // reconciled DB rows (and the position row) can read zero while the
    // funds live on-chain in another market's obligation. Source the full
    // exit from the same live snapshot partial withdrawals use — its
    // provenance carries the collateral metadata the full path needs.
    const snapshot = await fetchEarnRpcHoldingsSnapshot({
      cluster,
      connection,
      policy: policyResult
        ? serializeRoutePolicyState(
            policyResult.routePolicy,
            policyResult.setupPolicy ?? null
          )
        : null,
      programId: args.programId,
      settingsPda: settingsPdaKey,
    });
    const snapshotSources = buildSnapshotWithdrawSources(snapshot.holdings);
    if (snapshotSources.length === 0) {
      throw new Error("No active Earn withdrawal source was found.");
    }
    const selected = selectRequestedEarnWithdrawSource(
      snapshotSources,
      args.sourceRequest
    );
    if (!selected) {
      throw new Error("Select an Earn source before withdrawing.");
    }
    selectedSource = selected;
    effectiveAmountRaw = selected.amountRaw;
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
    snapshotFullExitHoldings = snapshot.holdings;
  } else {
    selectedSource = selectEarnWithdrawSource({
      amountRaw,
      idleRows: currentIdleRows,
      mode,
      position,
      request: args.sourceRequest,
      reserveRows: currentReserveRows,
    });
    effectiveAmountRaw = selectedSource.amountRaw;
    withdrawTarget = earnReserveTargetFromActivePosition(position);
  }

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
    ...(mode === "full" && selectedSource.type === "reserve"
      ? {
          fullWithdrawalTargets: snapshotFullExitHoldings
            ? snapshotFullWithdrawalTargets(
                snapshotFullExitHoldings,
                selectedSource.reserve
              )
            : currentReserveRows
                .filter((row) => row.reserve === selectedSource.reserve)
                .map((row) => {
                  if (!row.market) {
                    throw new Error(
                      "Reconciled Earn reserve row is missing a Kamino market."
                    );
                  }
                  const reserveCollateralMint = publicKeyFromMetadata(
                    row.planningMetadata,
                    [
                      "reserveCollateralMint",
                      "reserve_collateral_mint",
                      "collateralMint",
                      "collateral_mint",
                    ]
                  );
                  const reserveLiquiditySupply = publicKeyFromMetadata(
                    row.planningMetadata,
                    [
                      "reserveLiquiditySupply",
                      "reserve_liquidity_supply",
                      "liquiditySupply",
                      "liquidity_supply",
                    ]
                  );
                  const vaultCollateralAta = publicKeyFromMetadata(
                    row.planningMetadata,
                    [
                      "vaultCollateralAta",
                      "vault_collateral_ata",
                      "collateralAta",
                      "collateral_ata",
                    ]
                  );

                  return {
                    amountRaw: row.amountRaw,
                    liquidityMint: new PublicKey(row.liquidityMint),
                    market: new PublicKey(row.market),
                    reserve: new PublicKey(row.reserve),
                    ...(reserveCollateralMint
                      ? { reserveCollateralMint }
                      : {}),
                    ...(reserveLiquiditySupply
                      ? { reserveLiquiditySupply }
                      : {}),
                    supplyApyBps: row.supplyApyBps ?? null,
                    ...(vaultCollateralAta ? { vaultCollateralAta } : {}),
                  };
                }),
        }
      : {}),
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
