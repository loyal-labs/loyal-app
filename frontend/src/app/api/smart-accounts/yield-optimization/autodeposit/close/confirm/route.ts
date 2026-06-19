import { NextResponse } from "next/server";
import {
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  parseEarnAutodepositCloseConfirmRequestBody,
  type EarnAutodepositCloseConfirmResponse,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import {
  recordClosedAutodepositTarget,
  type BalanceSweepTargetRecord,
  type ConfirmedEarnAutodepositCloseInput,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";

const EARN_DEPOSIT_VAULT_INDEX = 1 as const;

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

function assertCanonicalField(
  actual: string | bigint | number | null,
  expected: string | bigint | number | null,
  label: string
) {
  if (actual !== expected) {
    throw new Error(
      `${label} does not match canonical Earn autodeposit metadata.`
    );
  }
}

function createCanonicalAutodepositCloseInput(
  requestInput: ConfirmedEarnAutodepositCloseInput
): ConfirmedEarnAutodepositCloseInput {
  const cluster = normalizeLoyalCluster(requestInput.cluster);
  const normalizedRequestInput = { ...requestInput, cluster };
  const settings = new PublicKey(requestInput.settings);
  const expectedVault = pda.getSmartAccountPda({
    settingsPda: settings,
    accountIndex: EARN_DEPOSIT_VAULT_INDEX,
  })[0];
  const expectedPolicySigner = getDeploymentPolicySignerPublicKey().toBase58();
  const canonicalInput = {
    ...normalizedRequestInput,
    cluster,
    delegatedSigner: expectedPolicySigner,
    vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
    vaultPubkey: expectedVault.toBase58(),
  };

  assertCanonicalField(
    normalizedRequestInput.cluster,
    canonicalInput.cluster,
    "cluster"
  );
  assertCanonicalField(
    requestInput.delegatedSigner,
    canonicalInput.delegatedSigner,
    "delegatedSigner"
  );
  assertCanonicalField(
    requestInput.vaultIndex,
    canonicalInput.vaultIndex,
    "vaultIndex"
  );
  assertCanonicalField(
    requestInput.vaultPubkey,
    canonicalInput.vaultPubkey,
    "vaultPubkey"
  );
  new PublicKey(requestInput.policyAccount);
  new PublicKey(requestInput.recurringDelegation);

  return canonicalInput;
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

async function resolveConfirmedSignatureSlot(args: {
  cluster: SolanaEnv;
  signature: string;
}): Promise<bigint> {
  const { value } = await getConnection(args.cluster).getSignatureStatuses(
    [args.signature],
    { searchTransactionHistory: true }
  );
  const status = value[0];

  if (!status || status.err) {
    throw new Error("Autodeposit close transaction is not confirmed.");
  }

  if (
    status.confirmationStatus !== "confirmed" &&
    status.confirmationStatus !== "finalized"
  ) {
    throw new Error("Autodeposit close transaction is not confirmed.");
  }

  if (typeof status.slot !== "number") {
    throw new Error("Confirmed transaction slot is unavailable.");
  }

  return BigInt(status.slot);
}

function serializeTarget(
  target: BalanceSweepTargetRecord
): EarnAutodepositCloseConfirmResponse["target"] {
  return {
    active: target.active,
    balanceSweepPolicyId: target.balanceSweepPolicyId?.toString() ?? null,
    id: target.id.toString(),
    lifecycleStatus: target.lifecycleStatus,
    policyAccount: target.policyAccount,
    recurringDelegation: target.recurringDelegation,
    walletBalanceFloorRaw: target.walletBalanceFloorRaw?.toString() ?? null,
  };
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: ConfirmedEarnAutodepositCloseInput;
  try {
    input = parseEarnAutodepositCloseConfirmRequestBody(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  if (
    input.walletAddress !== principal.walletAddress ||
    input.settings !== principal.settingsPda
  ) {
    return jsonError(
      403,
      "principal_mismatch",
      "Confirmed autodeposit close does not match the authenticated wallet session."
    );
  }

  try {
    input = createCanonicalAutodepositCloseInput(input);
  } catch (error) {
    return jsonError(
      400,
      "metadata_mismatch",
      error instanceof Error
        ? error.message
        : "Confirmed autodeposit close metadata is invalid."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const configuredCluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  if (input.cluster !== configuredCluster) {
    return jsonError(
      400,
      "cluster_mismatch",
      "Confirmed autodeposit close cluster does not match the configured Solana environment."
    );
  }

  let confirmedSlot: bigint;
  try {
    confirmedSlot = await resolveConfirmedSignatureSlot({
      cluster: solanaEnv,
      signature: input.closeSignature,
    });
  } catch (error) {
    return jsonError(
      400,
      "unconfirmed_signature",
      error instanceof Error
        ? error.message
        : "Autodeposit close transaction is not confirmed."
    );
  }

  if (input.confirmedSlot !== confirmedSlot) {
    return jsonError(
      400,
      "slot_mismatch",
      "Confirmed autodeposit close slot does not match the transaction status."
    );
  }

  try {
    const target = await recordClosedAutodepositTarget(input);
    return NextResponse.json({ target: serializeTarget(target) });
  } catch (error) {
    return jsonError(
      400,
      "record_failed",
      error instanceof Error
        ? error.message
        : "Failed to record confirmed autodeposit close."
    );
  }
}
