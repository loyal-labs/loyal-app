import "server-only";

import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";
import {
  ensureUserSmartAccount,
  findReadyUserSmartAccount,
  isSmartAccountProvisioningError,
  type SmartAccountServiceDependencies,
} from "@/features/smart-accounts/service";
import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { getServerEnv } from "@/lib/core/config/server";

import {
  fetchProgramConfigAccount,
  findSettingsSignerAddresses,
} from "./onchain";
import {
  AppUserSmartAccountSettingsConflictError,
  findAppUserSmartAccountByUserIdAndEnv,
  markAppUserSmartAccountReady,
  upsertPendingAppUserSmartAccount,
} from "./repository";

function createServiceDependencies(): SmartAccountServiceDependencies {
  return {
    getCurrentConfig: () => {
      const serverEnv = getServerEnv();
      return {
        solanaEnv: serverEnv.solanaEnv,
        programId: serverEnv.loyalSmartAccounts.programId,
      };
    },
    findByUserIdAndEnv: findAppUserSmartAccountByUserIdAndEnv,
    upsertPending: upsertPendingAppUserSmartAccount,
    markReady: markAppUserSmartAccountReady,
    fetchProgramConfig: fetchProgramConfigAccount,
    findSignerAddressesForSettings: findSettingsSignerAddresses,
    isSettingsReservationConflict: (
      error
    ) => error instanceof AppUserSmartAccountSettingsConflictError,
  };
}

export { isSmartAccountProvisioningError };

export async function ensureCurrentUserSmartAccount(args: {
  principal: AuthenticatedPrincipal;
  refreshPending?: boolean;
  settingsPda?: string;
  signature?: string;
}) {
  const user = await getOrCreateCurrentUser(args.principal);

  return ensureUserSmartAccount(
    {
      userId: user.id,
      walletAddress: args.principal.walletAddress,
      refreshPending: args.refreshPending,
      settingsPda: args.settingsPda,
      signature: args.signature,
    },
    createServiceDependencies()
  );
}

export async function findReadyCurrentUserSmartAccount(args: {
  userId: string;
}) {
  return findReadyUserSmartAccount(args, createServiceDependencies());
}
