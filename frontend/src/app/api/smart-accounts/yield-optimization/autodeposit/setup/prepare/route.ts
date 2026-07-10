import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  assertAuthenticatedWalletControlsSettings,
  isSmartAccountProvisioningError,
} from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  parseEarnAutodepositSetupPrepareRequestBody,
  serializePreparedEarnUsdcAutodepositSetup,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import {
  EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION,
  findCurrentEarnAutodepositState,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import {
  EARN_POSITION_REQUIRED_ERROR,
  hasActiveEarnRoutePolicyPair,
} from "@/lib/yield-optimization/earn-position-gate.server";

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

  const { rpcEndpoint, websocketEndpoint } = getServerSolanaEndpoints(cluster);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(cluster, connection);
  return connection;
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let parsed: ReturnType<typeof parseEarnAutodepositSetupPrepareRequestBody>;
  try {
    parsed = parseEarnAutodepositSetupPrepareRequestBody(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);

  try {
    await assertAuthenticatedWalletControlsSettings({
      settingsPda: principal.settingsPda,
      smartAccountAddress: principal.smartAccountAddress,
      walletAddress: principal.walletAddress,
    });

    // A fresh setup (no resume seed) while an Autodeposit is already active
    // would mint a second policy seed and stand up a duplicate on-chain
    // policy that delete/withdraw flows then trip over. Resumes pass the
    // recorded seed and skip this. Keep in sync with the mobile twin route.
    if (parsed.policySeed === undefined) {
      const current = await findCurrentEarnAutodepositState({
        settings: principal.settingsPda,
        vaultIndex: 1,
        walletAddress: principal.walletAddress,
      });
      // A position-paused row is the same fully-built autodeposit (it
      // auto-resumes on the next state read after a deposit), so it guards
      // identically.
      if (
        current?.target.lifecycleStatus === "active" ||
        current?.target.lifecycleStatus ===
          EARN_AUTODEPOSIT_PAUSED_MISSING_POSITION
      ) {
        return jsonError(
          409,
          "autodeposit_already_active",
          "An Autodeposit is already active for this wallet. Delete it before creating a new one."
        );
      }
    }

    // Setup on an empty Earn (e.g. after a full withdrawal) strands every
    // sweep — see earn-position-gate.server.ts. Fail open on lookup errors:
    // the worker's refusal remains the last line. Keep in sync with the
    // mobile twin route.
    try {
      if (
        !(await hasActiveEarnRoutePolicyPair({
          cluster,
          settingsPda: principal.settingsPda,
          walletAddress: principal.walletAddress,
        }))
      ) {
        return jsonError(
          409,
          EARN_POSITION_REQUIRED_ERROR.code,
          EARN_POSITION_REQUIRED_ERROR.message
        );
      }
    } catch (error) {
      console.warn("[autodeposit-setup-prepare] earn position gate skipped", {
        errorMessage:
          error instanceof Error ? error.message : "Unknown gate error.",
        walletAddress: principal.walletAddress,
      });
    }

    const serverEnv = getServerEnv();
    const policySigner = getDeploymentPolicySignerPublicKey();
    const client = createSmartAccountVaultsClient({
      connection: getConnection(solanaEnv),
      programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
    });
    const prepareArgs = {
      amountRaw: parsed.amountRaw,
      cluster,
      expiryTimestamp: parsed.expiryTimestamp,
      feePayer: new PublicKey(principal.walletAddress),
      minimumDelegatorBalanceRaw: parsed.walletBalanceFloorRaw,
      nonce: parsed.nonce,
      periodLengthSeconds: parsed.periodLengthSeconds,
      policySigner,
      policySeed: parsed.policySeed,
      settingsPda: new PublicKey(principal.settingsPda),
      signer: new PublicKey(principal.walletAddress),
      startTimestamp: parsed.startTimestamp,
      walletAddress: new PublicKey(principal.walletAddress),
    };
    const preparedSetups = parsed.includeBatch
      ? await client.prepareEarnUsdcAutodepositSetupBatch(prepareArgs)
      : [await client.prepareEarnUsdcAutodepositSetup(prepareArgs)];
    const preparedSetup = preparedSetups[0];

    if (!preparedSetup) {
      throw new Error("Failed to prepare Earn autodeposit setup.");
    }

    return NextResponse.json({
      nextPreparedSetup: preparedSetups[1]
        ? serializePreparedEarnUsdcAutodepositSetup(preparedSetups[1])
        : null,
      preparedSetup: serializePreparedEarnUsdcAutodepositSetup(preparedSetup),
    });
  } catch (error) {
    if (isSmartAccountProvisioningError(error)) {
      return jsonError(error.status, error.code, error.message);
    }

    console.error("[earn-autodeposit-setup-prepare] prepare failed", {
      amountRaw: parsed.amountRaw.toString(),
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown prepare error.",
      errorName: error instanceof Error ? error.name : typeof error,
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
        : "Failed to prepare Earn autodeposit setup."
    );
  }
}
