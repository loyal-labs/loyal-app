import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
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
import { earnReserveTargetFromActivePosition } from "@/lib/yield-optimization/earn-reserve-target.server";
import {
  findActiveYieldRoutePolicyPair,
  findCurrentNonzeroYieldVaultReservePositions,
  EARN_FINAL_EXIT_IDLE_DUST_TOLERANCE_RAW,
  findCurrentYieldVaultIdleTokenBalances,
  findReconciledActiveYieldPositionForVault,
  type CurrentYieldVaultIdleTokenBalanceRecord,
  type CurrentYieldVaultReservePositionRecord,
  type RoutePolicyRecord,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

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
  const sources = [...reserveSources, ...idleSources, ...positionFallbackSources];

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
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let amountRaw: bigint;
  let mode: "partial" | "full";
  let selectedSourceRequest: ReturnType<
    typeof parseEarnWithdrawPrepareRequestBody
  >["source"];
  try {
    ({
      amountRaw,
      mode,
      source: selectedSourceRequest,
    } = parseEarnWithdrawPrepareRequestBody(await request.json()));
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  let policy: RoutePolicyRecord | null = null;
  let effectiveAmountRaw: bigint | null = null;

  try {
    const serverEnv = getServerEnv();
    const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
    const settingsPda = new PublicKey(principal.settingsPda);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
      programId,
      settingsPda,
    });
    const connection = getConnection(solanaEnv);
    await reconcileEarnVaultPosition({
      authority: principal.walletAddress,
      cluster,
      connection,
      force: true,
      settings: principal.settingsPda,
      vaultPubkey: earnVaultPda.toBase58(),
    });
    const [policyResult, position, currentReserveRows, currentIdleRows] =
      await Promise.all([
        findActiveYieldRoutePolicyPair({
          authority: principal.walletAddress,
          cluster,
          settings: principal.settingsPda,
          vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
          vaultPubkey: earnVaultPda.toBase58(),
        }),
        findReconciledActiveYieldPositionForVault({
          cluster,
          settings: principal.settingsPda,
          vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
          walletAddress: principal.walletAddress,
        }),
        findCurrentNonzeroYieldVaultReservePositions({
          cluster,
          settings: principal.settingsPda,
          vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
          vaultPubkey: earnVaultPda.toBase58(),
          walletAddress: principal.walletAddress,
        }),
        findCurrentYieldVaultIdleTokenBalances({
          cluster,
          settings: principal.settingsPda,
          vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
          vaultPubkey: earnVaultPda.toBase58(),
          walletAddress: principal.walletAddress,
        }),
      ]);
    policy = policyResult?.routePolicy ?? null;
    if (!policy) {
      console.warn("[earn-withdraw-prepare] missing active Earn policy", {
        cluster,
        settings: principal.settingsPda,
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        walletAddress: principal.walletAddress,
      });
      return jsonError(
        409,
        "missing_earn_policy",
        "Set up the Earn policy before withdrawing USDC."
      );
    }

    if (!position) {
      console.warn("[earn-withdraw-prepare] missing active Earn position", {
        cluster,
        settings: principal.settingsPda,
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        walletAddress: principal.walletAddress,
      });
      return jsonError(
        409,
        "missing_earn_position",
        "No active Earn position was found for this full withdrawal."
      );
    }

    const selectedSource = selectEarnWithdrawSource({
      amountRaw,
      idleRows: currentIdleRows,
      mode,
      position,
      request: selectedSourceRequest,
      reserveRows: currentReserveRows,
    });
    effectiveAmountRaw = mode === "full" ? selectedSource.amountRaw : amountRaw;
    const remainingReserveAmountRaw = currentReserveRows.reduce(
      (total, row) =>
        total +
        (selectedSource.type === "reserve" &&
        row.reserve === selectedSource.reserve
          ? row.amountRaw > effectiveAmountRaw!
            ? row.amountRaw - effectiveAmountRaw!
            : BigInt(0)
          : row.amountRaw),
      BigInt(0)
    );
    const remainingIdleAmountRaw = currentIdleRows.reduce(
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
    const isFinalExit =
      remainingReserveAmountRaw <= BigInt(0) &&
      remainingIdleAmountRaw < EARN_FINAL_EXIT_IDLE_DUST_TOLERANCE_RAW;

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
            settings: principal.settingsPda,
            vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
            walletAddress: principal.walletAddress,
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
      autodepositState?.target.policyAccount &&
      autodepositState.target.recurringDelegation
    ) {
      const autodepositPolicyAccount = new PublicKey(
        autodepositState.target.policyAccount
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
            policyAccount: autodepositState.target.policyAccount,
            settings: principal.settingsPda,
            vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
            walletAddress: principal.walletAddress,
          });
        console.warn(
          "[earn-withdraw-prepare] reconciled missing autodeposit policy account",
          {
            cluster,
            lifecycleStatus: reconciledTarget.lifecycleStatus,
            policyAccount: autodepositState.target.policyAccount,
            reconciliationSource: "reconciled_missing_policy",
            settings: principal.settingsPda,
            targetId: reconciledTarget.id.toString(),
            vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
            walletAddress: principal.walletAddress,
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
        "[earn-withdraw-prepare] active autodeposit state is missing close metadata",
        {
          cluster,
          policyAccount: autodepositState.target.policyAccount,
          recurringDelegation: autodepositState.target.recurringDelegation,
          settings: principal.settingsPda,
          targetId: autodepositState.target.id.toString(),
          vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
          walletAddress: principal.walletAddress,
        }
      );
    }

    const withdrawInput = {
      amountRaw: effectiveAmountRaw,
      cluster,
      feePayer: new PublicKey(principal.walletAddress),
      policySigner,
      settingsPda: new PublicKey(principal.settingsPda),
      target: earnReserveTargetFromActivePosition(position),
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
      walletAddress: new PublicKey(principal.walletAddress),
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
      preparedWithdraw: serializePreparedEarnUsdcWithdraw(preparedWithdraw),
    });
  } catch (error) {
    console.error("[earn-withdraw-prepare] prepare failed", {
      amountRaw: amountRaw.toString(),
      effectiveAmountRaw: effectiveAmountRaw?.toString() ?? null,
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown prepare error.",
      errorName: error instanceof Error ? error.name : typeof error,
      mode,
      policyAccount: policy?.policyAccount ?? null,
      policySeed: policy?.policySeed.toString() ?? null,
      settings: principal.settingsPda,
      solanaEnv,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress: principal.walletAddress,
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
