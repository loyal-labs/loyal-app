import "server-only";

import {
  findCurrentUser,
  getOrCreateCurrentUser,
} from "@/features/chat/server/app-user";
import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";
import { deriveCanonicalSmartAccountAddress } from "@/features/smart-accounts/derivation";
import type { AppUserSmartAccountRecord } from "@/features/smart-accounts/server/repository";
import type {
  EnsureUserSmartAccountResult,
  SmartAccountSummary,
  SmartAccountServiceDependencies,
} from "@/features/smart-accounts/service";
import {
  ensureUserSmartAccount,
  findReadyUserSmartAccount,
  isSmartAccountProvisioningError,
  SmartAccountProvisioningError,
} from "@/features/smart-accounts/service";
import { getServerEnv } from "@/lib/core/config/server";

import {
  fetchProgramConfigAccount,
  fetchRootSettingsSigners,
  findSettingsSignerAddresses,
} from "./onchain";
import { createOnchainSmartAccountProvisioner } from "./provisioner";
import {
  AppUserSmartAccountSettingsConflictError,
  findActiveRootSmartAccountSignerMemberships,
  findAppUserSmartAccountByUserIdAndEnv,
  listStaleAppUserSmartAccounts,
  markRootSmartAccountSignerRemoved,
  markAppUserSmartAccountFailed,
  markAppUserSmartAccountReady,
  reserveProvisioningAppUserSmartAccount,
  upsertActiveRootSmartAccountSigner,
} from "./repository";

function createServiceDependencies(): SmartAccountServiceDependencies {
  const provisioner = createOnchainSmartAccountProvisioner();

  return {
    getCurrentConfig: () => {
      const serverEnv = getServerEnv();
      return {
        solanaEnv: serverEnv.solanaEnv,
        programId: serverEnv.loyalSmartAccounts.programId,
      };
    },
    findByUserIdAndEnv: findAppUserSmartAccountByUserIdAndEnv,
    reserveProvisioning: reserveProvisioningAppUserSmartAccount,
    markReady: markAppUserSmartAccountReady,
    markFailed: markAppUserSmartAccountFailed,
    fetchProgramConfig: fetchProgramConfigAccount,
    createSmartAccount: (input) => provisioner.createSmartAccount(input),
    findSignerAddressesForSettings: findSettingsSignerAddresses,
    findActiveRootSignerMemberships:
      findActiveRootSmartAccountSignerMemberships,
    fetchRootSettingsSigners,
    recordActiveRootSignerMembership: upsertActiveRootSmartAccountSigner,
    markRootSignerRemoved: markRootSmartAccountSignerRemoved,
    isSettingsReservationConflict: (error) =>
      error instanceof AppUserSmartAccountSettingsConflictError,
  };
}

export { isSmartAccountProvisioningError };
export type {
  EnsureUserSmartAccountResult,
  SmartAccountSummary,
  AppUserSmartAccountRecord,
};

export async function ensureWalletUserSmartAccount(args: {
  userId: string;
  walletAddress: string;
}): Promise<EnsureUserSmartAccountResult> {
  return ensureUserSmartAccount(args, createServiceDependencies());
}

export async function ensureCurrentUserSmartAccount(args: {
  principal: AuthenticatedPrincipal;
}) {
  const user = await getOrCreateCurrentUser(args.principal);

  return ensureWalletUserSmartAccount({
    userId: user.id,
    walletAddress: args.principal.walletAddress,
  });
}

export async function findReadyCurrentUserSmartAccount(args: {
  userId: string;
  walletAddress?: string;
}) {
  return findReadyUserSmartAccount(args, createServiceDependencies());
}

async function invalidateCurrentReadySmartAccount(args: {
  dependencies: SmartAccountServiceDependencies;
  errorCode: string;
  errorMessage: string;
  settingsPda: string;
  walletAddress: string;
}): Promise<void> {
  const { solanaEnv } = args.dependencies.getCurrentConfig();
  const user = await findCurrentUser({
    authMethod: "wallet",
    provider: "solana",
    subjectAddress: args.walletAddress,
    walletAddress: args.walletAddress,
  });
  if (!user) {
    return;
  }

  const record = await args.dependencies.findByUserIdAndEnv(
    user.id,
    solanaEnv
  );
  if (record?.state !== "ready" || record.settingsPda !== args.settingsPda) {
    return;
  }

  await args.dependencies.markFailed({
    id: record.id,
    userId: record.userId,
    solanaEnv: record.solanaEnv,
    settingsPda: record.settingsPda,
    errorCode: args.errorCode,
    errorMessage: args.errorMessage,
    creationSignature: record.creationSignature,
  });
}

export async function assertAuthenticatedWalletControlsSettings(args: {
  settingsPda: string;
  smartAccountAddress?: string;
  walletAddress: string;
}): Promise<void> {
  const dependencies = createServiceDependencies();
  const { solanaEnv, programId } = dependencies.getCurrentConfig();
  const expectedSmartAccountAddress = deriveCanonicalSmartAccountAddress({
    programId,
    settingsPda: args.settingsPda,
  });

  if (
    args.smartAccountAddress &&
    args.smartAccountAddress !== expectedSmartAccountAddress
  ) {
    throw new SmartAccountProvisioningError({
      code: "smart_account_principal_mismatch",
      message:
        "The authenticated smart account does not match its settings account.",
      status: 409,
    });
  }

  const signerAddresses = await dependencies.findSignerAddressesForSettings({
    solanaEnv,
    programId,
    settingsPda: args.settingsPda,
  });

  if (!signerAddresses?.includes(args.walletAddress)) {
    const errorCode = "smart_account_signer_mismatch";
    const errorMessage =
      "The smart account settings are no longer controlled by this wallet.";
    await invalidateCurrentReadySmartAccount({
      dependencies,
      errorCode,
      errorMessage,
      settingsPda: args.settingsPda,
      walletAddress: args.walletAddress,
    }).catch((error) => {
      console.warn("[smart-accounts] failed to invalidate stale ready row", {
        errorMessage:
          error instanceof Error ? error.message : "Unknown invalidate error.",
        settingsPda: args.settingsPda,
        walletAddress: args.walletAddress,
      });
    });

    throw new SmartAccountProvisioningError({
      code: errorCode,
      message: errorMessage,
      status: 409,
    });
  }
}

export async function listRecoverableSmartAccountRecords(args: {
  limit: number;
  staleBefore: Date;
}) {
  return listStaleAppUserSmartAccounts(args);
}
