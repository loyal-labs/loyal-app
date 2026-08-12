import { NextResponse } from "next/server";
import {
  normalizeLoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  buildEarnAutodepositCloseConfirmRequestBody,
  hydratePreparedEarnUsdcAutodepositClose,
  parseEarnAutodepositCloseConfirmRequestBody,
  type EarnAutodepositCloseConfirmResponse,
  type WireSmartAccountPreparedEarnUsdcAutodepositClose,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import {
  recordClosedAutodepositTarget,
  type BalanceSweepTargetRecord,
  type ConfirmedEarnAutodepositCloseInput,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";

// Mobile twin of `yield-optimization/autodeposit/close/confirm`. The device
// echoes the serialized prepared close it signed + signature/slot; this route
// rebuilds the canonical confirm payload server-side and records the closed
// target. The canonicalization mirrors the session route — keep in sync.
const EARN_DEPOSIT_VAULT_INDEX = 1 as const;

const connectionCache = new Map<SolanaEnv, Connection>();

type MobileCloseConfirmFields = {
  preparedClose: WireSmartAccountPreparedEarnUsdcAutodepositClose;
  closeSignature: string;
  confirmedSlot: string;
};

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

function parseMobileCloseConfirmFields(
  body: unknown
): MobileCloseConfirmFields {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object.");
  }
  const record = body as Record<string, unknown>;
  if (typeof record.preparedClose !== "object" || record.preparedClose === null) {
    throw new Error("preparedClose is required.");
  }
  if (typeof record.closeSignature !== "string" || !record.closeSignature) {
    throw new Error("closeSignature is required.");
  }
  if (typeof record.confirmedSlot !== "string" || !record.confirmedSlot) {
    throw new Error("confirmedSlot is required.");
  }
  return {
    preparedClose:
      record.preparedClose as WireSmartAccountPreparedEarnUsdcAutodepositClose,
    closeSignature: record.closeSignature,
    confirmedSlot: record.confirmedSlot,
  };
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
      // Accepts the flow's prepare signature too — the device signs one auth
      // message per flow (see authenticateMobileWalletRequest).
      purpose: ["earn-autodeposit-close-confirm", "earn-autodeposit-close-prepare"],
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let fields: MobileCloseConfirmFields;
  try {
    fields = parseMobileCloseConfirmFields(body);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  let settingsPda: string;
  try {
    const user = await getOrCreateCurrentUser({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: walletAddress,
      walletAddress,
    });
    const existing = await findReadyCurrentUserSmartAccount({
      userId: user.id,
      walletAddress,
    });
    if (!existing) {
      return jsonError(
        409,
        "smart_account_not_ready",
        "No provisioned smart account for this wallet."
      );
    }
    settingsPda = existing.settingsPda;
  } catch (error) {
    console.error("[mobile-earn-autodeposit-close-confirm] resolve failed", {
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

  let input: ConfirmedEarnAutodepositCloseInput;
  try {
    const prepared = hydratePreparedEarnUsdcAutodepositClose(
      fields.preparedClose
    );
    const confirmBody = buildEarnAutodepositCloseConfirmRequestBody({
      confirmedSlot: fields.confirmedSlot,
      preparedClose: prepared,
      signature: fields.closeSignature,
    });
    input = parseEarnAutodepositCloseConfirmRequestBody(confirmBody);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid prepared close."
    );
  }

  if (input.walletAddress !== walletAddress || input.settings !== settingsPda) {
    return jsonError(
      403,
      "principal_mismatch",
      "Confirmed autodeposit close does not match the authenticated wallet."
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
