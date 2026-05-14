import "server-only";

import type { AppUserSmartAccountRecord } from "@/features/smart-accounts/server/repository";
import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";
import type {
  EnsureUserSmartAccountResult,
  SmartAccountSummary,
  SmartAccountServiceDependencies,
} from "@/features/smart-accounts/service";
import {
  ensureUserSmartAccount,
  findReadyUserSmartAccount,
  isSmartAccountProvisioningError,
} from "@/features/smart-accounts/service";
import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { getServerEnv } from "@/lib/core/config/server";

import {
  fetchProgramConfigAccount,
  findSettingsSignerAddresses,
} from "./onchain";
import { createOnchainSmartAccountProvisioner } from "./provisioner";
import {
  AppUserSmartAccountSettingsConflictError,
  findAppUserSmartAccountByUserIdAndEnv,
  listStaleAppUserSmartAccounts,
  markAppUserSmartAccountFailed,
  markAppUserSmartAccountReady,
  reserveProvisioningAppUserSmartAccount,
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
    isSettingsReservationConflict: (
      error
    ) => error instanceof AppUserSmartAccountSettingsConflictError,
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
}) {
  return findReadyUserSmartAccount(args, createServiceDependencies());
}

export async function listRecoverableSmartAccountRecords(args: {
  limit: number;
  staleBefore: Date;
}) {
  return listStaleAppUserSmartAccounts(args);
}
