import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import {
  parseEarnWithdrawPrepareRequestBody,
  serializePreparedEarnUsdcWithdraw,
} from "@/lib/yield-optimization/earn-withdraw-prepare-contracts.shared";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  findCurrentEarnAutodepositState,
  reconcileMissingOnChainEarnAutodepositPolicy,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";
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

// Mobile twin of `yield-optimization/withdrawals/prepare`. Identical source
// selection + prepare logic, but authenticated by a wallet signature (no
// Turnstile/session) and it resolves the caller's smart account itself instead
// of reading it from a session principal. Withdrawing requires an existing
// account, so (unlike deposit) it never provisions. Keep the prepare body below
// in sync with the session route.
const EARN_DEPOSIT_VAULT_INDEX = 1;

const connectionCache = new Map<SolanaEnv, Connection>();

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function getConfiguredSolanaEnv(): SolanaEnv {
  return resolveLoyalWebSolanaEnvFromEnv(process.env);
}

function getConnection(cluster: SolanaEnv): Connection {
  const cached = connectionCache.get(cluster);
  if (cached) {
    return cached;
  }

  const { rpcEndpoint, websocketEndpoint } =
    getServerSolanaEndpoints(cluster);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(cluster, connection);
  return connection;
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

  const identifiers = [
    request.id,
    request.liquidityMint,
    request.mint,
  ].filter(isNonEmptyString);

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

function selectEarnWithdrawSource(args: {
  amountRaw: bigint;
  idleRows: CurrentYieldVaultIdleTokenBalanceRecord[];
  mode: "partial" | "full";
  position: UserYieldPositionRecord;
  request: EarnWithdrawSourceRequest;
  reserveRows: CurrentYieldVaultReservePositionRecord[];
}): SelectedEarnWithdrawSource {
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
  const sources = [
    ...reserveSources,
    ...idleSources,
    ...positionFallbackSources,
  ];

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

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_request", "Invalid request body.");
  }

  let walletAddress: string;
  try {
    ({ walletAddress } = await authenticateMobileWalletRequest({
      body,
      purpose: "earn-withdraw-prepare",
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let amountRaw: bigint;
  let mode: "partial" | "full";
  let selectedSourceRequest: EarnWithdrawSourceRequest;
  try {
    ({
      amountRaw,
      mode,
      source: selectedSourceRequest,
    } = parseEarnWithdrawPrepareRequestBody(body));
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  // Withdrawing requires an already-provisioned smart account (you can't
  // withdraw from one that was never created). Resolve it; never provision.
  let settingsPda: string;
  let smartAccountAddress: string;
  try {
    const user = await getOrCreateCurrentUser({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: walletAddress,
      walletAddress,
    });
    const existing = await findReadyCurrentUserSmartAccount({
      userId: user.id,
    });
    if (!existing) {
      return jsonError(
        409,
        "smart_account_not_ready",
        "No provisioned smart account for this wallet."
      );
    }
    settingsPda = existing.settingsPda;
    smartAccountAddress = existing.smartAccountAddress;
  } catch (error) {
    console.error("[mobile-earn-withdraw-prepare] resolve failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown resolve error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      502,
      "resolve_failed",
      "Failed to resolve the smart account for this wallet."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  let policy: RoutePolicyRecord | null = null;
  let effectiveAmountRaw: bigint | null = null;

  try {
    const serverEnv = getServerEnv();
    const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
    const settingsPdaKey = new PublicKey(settingsPda);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
      programId,
      settingsPda: settingsPdaKey,
    });
    const connection = getConnection(solanaEnv);
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
    policy = policyResult?.routePolicy ?? null;
    if (!policy) {
      console.warn("[mobile-earn-withdraw-prepare] missing active Earn policy", {
        cluster,
        settings: settingsPda,
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        walletAddress,
      });
      return jsonError(
        409,
        "missing_earn_policy",
        "Set up the Earn policy before withdrawing USDC."
      );
    }

    if (!position) {
      console.warn(
        "[mobile-earn-withdraw-prepare] missing active Earn position",
        {
          cluster,
          settings: settingsPda,
          vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
          walletAddress,
        }
      );
      return jsonError(
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
    let isFinalExit: boolean;
    let withdrawTarget: EarnUsdcReserveTarget;
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
        programId,
        settingsPda: settingsPdaKey,
      });
      const snapshotSources = buildSnapshotWithdrawSources(snapshot.holdings);
      if (snapshotSources.length === 0) {
        throw new Error("No active Earn withdrawal source was found.");
      }
      const selected = selectRequestedEarnWithdrawSource(
        snapshotSources,
        selectedSourceRequest
      );
      if (!selected) {
        throw new Error("Select an Earn source before withdrawing.");
      }
      if (amountRaw > selected.amountRaw) {
        throw new Error("Withdrawal exceeds the selected Earn source amount.");
      }
      selectedSource = selected;
      effectiveAmountRaw = amountRaw;
      const snapshotTotal = snapshotSources.reduce(
        (total, source) => total + source.amountRaw,
        BigInt(0)
      );
      isFinalExit = snapshotTotal - effectiveAmountRaw <= BigInt(0);
      withdrawTarget =
        selected.type === "reserve"
          ? {
              liquidityMint: new PublicKey(selected.liquidityMint),
              market: new PublicKey(selected.market),
              reserve: new PublicKey(selected.reserve),
              supplyApyBps: null,
            }
          : (snapshotReserveTarget(snapshot.holdings) ??
            earnReserveTargetFromActivePosition(position));
    } else {
      selectedSource = selectEarnWithdrawSource({
        amountRaw,
        idleRows: currentIdleRows,
        mode,
        position,
        request: selectedSourceRequest,
        reserveRows: currentReserveRows,
      });
      effectiveAmountRaw = selectedSource.amountRaw;
      const remainingSourceAmountRaw =
        currentReserveRows.reduce(
          (total, row) =>
            total +
            (selectedSource.type === "reserve" &&
            row.reserve === selectedSource.reserve
              ? row.amountRaw > effectiveAmountRaw!
                ? row.amountRaw - effectiveAmountRaw!
                : BigInt(0)
              : row.amountRaw),
          BigInt(0)
        ) +
        currentIdleRows.reduce(
          (total, row) =>
            total +
            (selectedSource.type === "idle" &&
            row.tokenAccount === selectedSource.tokenAccount
              ? row.amountRaw > effectiveAmountRaw!
                ? row.amountRaw - effectiveAmountRaw!
                : BigInt(0)
              : row.amountRaw),
          BigInt(0)
        );
      isFinalExit = remainingSourceAmountRaw <= BigInt(0);
      withdrawTarget = earnReserveTargetFromActivePosition(position);
    }

    const policySigner = getDeploymentPolicySignerPublicKey();
    const client = createSmartAccountVaultsClient({
      connection,
      programId,
    });
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
    const autodepositState =
      mode === "full" && isFinalExit
        ? await findCurrentEarnAutodepositState({
            settings: settingsPda,
            vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
            walletAddress,
          })
        : null;
    let autodepositClose:
      | {
          policy: PublicKey;
          recurringDelegation: PublicKey;
        }
      | undefined;
    let reconciledMissingAutodepositPolicy = false;

    if (
      autodepositState?.policy.policyAccount &&
      autodepositState.target.recurringDelegation
    ) {
      const autodepositPolicyAccount = new PublicKey(
        autodepositState.policy.policyAccount
      );
      const autodepositPolicyInfo = await connection.getAccountInfo(
        autodepositPolicyAccount,
        "confirmed"
      );

      if (autodepositPolicyInfo) {
        autodepositClose = {
          policy: autodepositPolicyAccount,
          recurringDelegation: new PublicKey(
            autodepositState.target.recurringDelegation
          ),
        };
      } else {
        reconciledMissingAutodepositPolicy = true;
        const reconciledTarget =
          await reconcileMissingOnChainEarnAutodepositPolicy({
            policyAccount: autodepositState.policy.policyAccount,
            settings: settingsPda,
            vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
            walletAddress,
          });
        console.warn(
          "[mobile-earn-withdraw-prepare] reconciled missing autodeposit policy account",
          {
            cluster,
            lifecycleStatus: reconciledTarget.lifecycleStatus,
            policyAccount: autodepositState.policy.policyAccount,
            reconciliationSource: "reconciled_missing_policy",
            settings: settingsPda,
            targetId: reconciledTarget.id.toString(),
            vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
            walletAddress,
          }
        );
      }
    }

    if (
      mode === "full" &&
      isFinalExit &&
      autodepositState &&
      !autodepositClose &&
      !reconciledMissingAutodepositPolicy
    ) {
      console.warn(
        "[mobile-earn-withdraw-prepare] active autodeposit state is missing close metadata",
        {
          cluster,
          policyAccount: autodepositState.policy.policyAccount,
          recurringDelegation: autodepositState.target.recurringDelegation,
          settings: settingsPda,
          targetId: autodepositState.target.id.toString(),
          vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
          walletAddress,
        }
      );
    }

    const withdrawInput = {
      amountRaw: effectiveAmountRaw,
      cluster,
      feePayer: new PublicKey(walletAddress),
      policySigner,
      settingsPda: settingsPdaKey,
      target: withdrawTarget,
      ...(mode === "full" && selectedSource.type === "reserve"
        ? {
            fullWithdrawalTargets: currentReserveRows
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
                  ...(reserveCollateralMint ? { reserveCollateralMint } : {}),
                  ...(reserveLiquiditySupply ? { reserveLiquiditySupply } : {}),
                  supplyApyBps: row.supplyApyBps ?? null,
                  ...(vaultCollateralAta ? { vaultCollateralAta } : {}),
                };
              }),
          }
        : {}),
      closePoliciesOnFullWithdrawal: isFinalExit,
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
    const preparedWithdraw =
      mode === "full"
        ? await client.prepareEarnUsdcWithdraw({
            ...withdrawInput,
            ...(autodepositClose ? { autodepositClose } : {}),
            mode,
          })
        : await client.prepareEarnUsdcWithdraw({
            ...withdrawInput,
            mode,
          });

    return NextResponse.json({
      cluster,
      programId: serverEnv.loyalSmartAccounts.programId,
      settingsPda,
      smartAccountAddress,
      preparedWithdraw: serializePreparedEarnUsdcWithdraw(preparedWithdraw),
    });
  } catch (error) {
    console.error("[mobile-earn-withdraw-prepare] prepare failed", {
      amountRaw: amountRaw.toString(),
      effectiveAmountRaw: effectiveAmountRaw?.toString() ?? null,
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown prepare error.",
      errorName: error instanceof Error ? error.name : typeof error,
      mode,
      policyAccount: policy?.policyAccount ?? null,
      policySeed: policy?.policySeed.toString() ?? null,
      settings: settingsPda,
      solanaEnv,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      500,
      "prepare_failed",
      error instanceof Error
        ? error.message
        : "Failed to prepare Earn withdrawal."
    );
  }
}
