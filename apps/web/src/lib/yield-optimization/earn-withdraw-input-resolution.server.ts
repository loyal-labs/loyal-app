import "server-only";

import type { LoyalCluster } from "@loyal-labs/actions";
import {
  isEarnWithdrawRequiredAccountMissingError,
  type SmartAccountEarnUsdcWithdrawInput,
} from "@loyal-labs/smart-account-vaults";
import { type Connection, PublicKey } from "@solana/web3.js";

import {
  type EarnUsdcReserveTarget,
} from "@/lib/yield-optimization/earn-reserve-target.server";
import {
  type EarnRpcHolding,
  fetchEarnRpcHoldingsSnapshot,
} from "@/lib/yield-optimization/earn-rpc-holdings.client";
import { serializeRoutePolicyState } from "@/lib/yield-optimization/earn-state-serializers.server";
import type {
  EarnWithdrawLegacyPrepareRequest,
  EarnWithdrawLegacySourceRequest,
  parseEarnWithdrawPrepareRequestBody,
} from "@/lib/yield-optimization/earn-withdraw-prepare-contracts.shared";
import {
  findActiveYieldRoutePolicyPair,
  type RoutePolicyRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

// Source selection + SDK-input assembly for a mobile Earn withdrawal,
// extracted VERBATIM from `mobile/earn/withdraw/prepare` so the route (server
// build) and `mobile/earn/withdraw/prepare-context` (on-device build) resolve
// the exact same input. Everything here is the decision "WHAT to withdraw";
// the caller decides where the instruction build ("HOW") runs.
const EARN_DEPOSIT_VAULT_INDEX = 1;
const POLICY_PROJECTION_RETRY_DELAYS_MS = [0, 100, 250, 500, 1_000] as const;

async function waitForPolicyProjection(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

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

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return typeof error === "string" ? error : "";
}

export function normalizeEarnWithdrawPreparationError(
  error: unknown
): EarnWithdrawResolveError | null {
  if (error instanceof EarnWithdrawResolveError) {
    return error;
  }
  if (isEarnWithdrawRequiredAccountMissingError(error)) {
    return new EarnWithdrawResolveError(409, error.code, error.message);
  }

  const errorText = getErrorText(error);
  if (
    /KLEND_(MARKET|OBLIGATION)_NOT_FOUND/i.test(errorText) ||
    /Kamino (reserve account|vault collateral token account) (was not found|is unavailable)/i.test(
      errorText
    ) ||
    /Selected Kamino reserve account was not found/i.test(errorText)
  ) {
    return new EarnWithdrawResolveError(
      409,
      "earn_withdraw_source_changed",
      "The selected Earn source changed. Refresh Earn and choose it again."
    );
  }

  if (/\bAccountNotFound\b/i.test(errorText)) {
    return new EarnWithdrawResolveError(
      409,
      "earn_withdraw_required_account_missing",
      "A required Earn withdrawal transaction account is unavailable. Refresh Earn and prepare the withdrawal again."
    );
  }

  return null;
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

// ---------------------------------------------------------------------------
// Legacy request compatibility (ASK-2099). Mobile binaries and OTAs that
// predate the sourceId contract still send `{ amountRaw, mode, source }`;
// these are the selection/matching rules that contract shipped with, applied
// to the same snapshot sources. Delete once the mobile fleet speaks sourceId.

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Legacy clients that refreshed their source list after the contract change
// hold new-format ids ("reserve:<pubkey>" / "idle:<tokenAccount>") — strip
// the prefix so they still match the raw identifiers below.
function stripSourceIdPrefix(value: string): string {
  return value.replace(/^(?:reserve|idle):/, "");
}

function legacySourceMatchesDirectIdentifier(
  source: SelectedEarnWithdrawSource,
  request: NonNullable<EarnWithdrawLegacySourceRequest>
): boolean {
  if (source.type !== request.type) {
    return false;
  }

  const identifiers = [request.id, request.reserve, request.tokenAccount]
    .filter(isNonEmptyString)
    .map(stripSourceIdPrefix);

  if (identifiers.includes(source.id)) {
    return true;
  }

  return source.type === "reserve" && identifiers.includes(source.reserve);
}

function legacySourceMatchesStableMint(
  source: SelectedEarnWithdrawSource,
  request: NonNullable<EarnWithdrawLegacySourceRequest>
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

function selectLegacyEarnWithdrawSource(
  sources: SelectedEarnWithdrawSource[],
  request: EarnWithdrawLegacySourceRequest
): SelectedEarnWithdrawSource | null {
  if (!request) {
    return sources.length === 1 ? (sources[0] ?? null) : null;
  }

  const directMatch = sources.find((source) =>
    legacySourceMatchesDirectIdentifier(source, request)
  );
  if (directMatch) {
    return directMatch;
  }

  const stableMintMatches = sources.filter((source) =>
    legacySourceMatchesStableMint(source, request)
  );
  if (stableMintMatches.length === 1) {
    return stableMintMatches[0] ?? null;
  }

  const amountMatchedStableMintMatches = stableMintMatches.filter(
    (source) => request.amountRaw === source.amountRaw.toString()
  );

  return amountMatchedStableMintMatches.length === 1
    ? (amountMatchedStableMintMatches[0] ?? null)
    : null;
}

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

// Reserve target the legacy contract attached to idle-source withdrawals so
// the device SDK always had a routing venue.
function snapshotReserveTarget(
  holdings: EarnRpcHolding[]
): EarnUsdcReserveTarget | null {
  const kamino = holdings.find(
    (holding) => holding.kind === "kamino" && holding.reserve && holding.market
  );
  if (!(kamino?.reserve && kamino.market)) {
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
    liquidityTokenProgram: new PublicKey(kamino.tokenProgramId),
    market: new PublicKey(kamino.market),
    reserve: new PublicKey(kamino.reserve),
    supplyApyBps,
  };
}

// Legacy full exit unwinds EVERY market the wallet holds; the aggregate target
// list drives the SDK's multi-market full-withdrawal build.
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

// ---------------------------------------------------------------------------

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
  // Set for legacy `{ amountRaw, mode, source }` bodies (ASK-2099); resolved
  // with the legacy matcher instead of an exact sourceId match.
  legacyRequest?: EarnWithdrawLegacyPrepareRequest | null;
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
  // Policy identity is durable setup metadata. The money position itself is
  // derived from the live chain snapshot below, so a newly finalized deposit
  // can be withdrawn before LaserStream has projected its aggregate row.
  let policyResult: Awaited<ReturnType<typeof findActiveYieldRoutePolicyPair>> =
    null;
  for (const delayMs of POLICY_PROJECTION_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await waitForPolicyProjection(delayMs);
    }
    policyResult = await findActiveYieldRoutePolicyPair({
      authority: walletAddress,
      cluster,
      settings: settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      vaultPubkey: earnVaultPda.toBase58(),
    });
    if (policyResult?.routePolicy) {
      break;
    }
  }
  if (!policyResult?.routePolicy) {
    console.warn(`[${logTag}] Earn policy projection still pending`, {
      cluster,
      settings: settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      walletAddress,
    });
    throw new EarnWithdrawResolveError(
      503,
      "earn_policy_projection_pending",
      "The confirmed Earn policy is still updating. Retry this withdrawal."
    );
  }
  const policy = policyResult.routePolicy;

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

  const legacyRequest = args.legacyRequest ?? null;
  let selectedSource: SelectedEarnWithdrawSource;
  let effectiveAmountRaw: bigint;
  let mode: "partial" | "full" = "partial";
  let fullWithdrawalTargets: ReturnType<typeof snapshotFullWithdrawalTargets> =
    [];
  let withdrawTarget: EarnUsdcReserveTarget | undefined;

  if (legacyRequest && legacyRequest.mode === "full") {
    // Legacy full exit: aggregate every source and let the SDK unwind each
    // market; the client's amountRaw is display-precision and ignored.
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
    mode = "full";
    fullWithdrawalTargets = snapshotFullWithdrawalTargets(snapshot.holdings);
    withdrawTarget =
      selectedSource.type === "reserve"
        ? reserveSourceWithdrawTarget(selectedSource)
        : snapshotReserveTarget(snapshot.holdings);
  } else if (legacyRequest) {
    const selected = selectLegacyEarnWithdrawSource(
      snapshotSources,
      legacyRequest.source
    );
    if (!selected) {
      throw new EarnWithdrawResolveError(
        400,
        "earn_withdraw_source_required",
        "Select an Earn source before withdrawing."
      );
    }
    selectedSource = selected;
    effectiveAmountRaw =
      requestedAmountRaw === "max" ? selected.amountRaw : requestedAmountRaw;
    if (effectiveAmountRaw > selected.amountRaw) {
      throw new EarnWithdrawResolveError(
        409,
        "earn_withdraw_amount_exceeds_source",
        "Withdrawal exceeds the selected Earn source amount."
      );
    }
    withdrawTarget =
      selected.type === "reserve"
        ? reserveSourceWithdrawTarget(selected)
        : snapshotReserveTarget(snapshot.holdings);
  } else {
    if (args.sourceId === null) {
      throw new EarnWithdrawResolveError(
        400,
        "earn_withdraw_source_required",
        "Select an Earn source before withdrawing."
      );
    }
    selectedSource = selectRequestedEarnWithdrawSource(
      snapshotSources,
      args.sourceId
    );
    effectiveAmountRaw =
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
    withdrawTarget =
      selectedSource.type === "reserve"
        ? reserveSourceWithdrawTarget(selectedSource)
        : undefined;
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
    mode,
  };

  return { input, policy, effectiveAmountRaw };
}

function reserveSourceWithdrawTarget(
  source: Extract<SelectedEarnWithdrawSource, { type: "reserve" }>
): EarnUsdcReserveTarget {
  return {
    liquidityMint: new PublicKey(source.liquidityMint),
    liquidityTokenProgram: new PublicKey(source.tokenProgramId),
    market: new PublicKey(source.market),
    reserve: new PublicKey(source.reserve),
    supplyApyBps: null,
  };
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
