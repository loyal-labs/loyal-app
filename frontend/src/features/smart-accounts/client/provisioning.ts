import type { AuthSessionUser } from "@loyal-labs/auth-core";
import type { Connection } from "@solana/web3.js";

import type {
  EnsureSmartAccountRequest,
  SmartAccountProvisioningResponse,
} from "@/features/smart-accounts/contracts";
import {
  isSmartAccountProvisioningNetworkMismatchError,
  sendCreateSmartAccountTransaction,
  type WalletSignTransaction,
  type WalletSendTransaction,
} from "@/features/smart-accounts/client/send";

type ProvisionSmartAccountDependencies = {
  connection: Connection;
  walletAddress: string;
  sendTransaction: WalletSendTransaction;
  signTransaction?: WalletSignTransaction;
  ensure: (
    request?: EnsureSmartAccountRequest
  ) => Promise<SmartAccountProvisioningResponse>;
};

const POST_SEND_RECONCILIATION_DELAYS_MS = [250, 500, 1000] as const;

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldProvisionWalletSmartAccount(args: {
  isHydrated: boolean;
  user: AuthSessionUser | null;
  connected: boolean;
  walletAddress: string | null;
  hasSendTransaction: boolean;
}): boolean {
  return Boolean(
    args.isHydrated &&
      args.user &&
      args.user.authMethod === "wallet" &&
      args.user.walletAddress &&
      args.connected &&
      args.walletAddress &&
      args.walletAddress === args.user.walletAddress &&
      args.hasSendTransaction
  );
}

export function isUserRejectedSmartAccountProvisionError(
  error: unknown
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("rejected") ||
    message.includes("declined") ||
    message.includes("cancelled") ||
    message.includes("canceled")
  );
}

export function shouldRetrySmartAccountProvisionError(
  error: unknown
): boolean {
  return (
    !isUserRejectedSmartAccountProvisionError(error) &&
    !isSmartAccountProvisioningNetworkMismatchError(error)
  );
}

async function reconcileReadyStateAfterSend(args: {
  settingsPda: string;
  signature: string;
  ensure: (
    request?: EnsureSmartAccountRequest
  ) => Promise<SmartAccountProvisioningResponse>;
}): Promise<SmartAccountProvisioningResponse> {
  let response = await args.ensure({
    settingsPda: args.settingsPda,
    signature: args.signature,
  });

  for (const delayMs of POST_SEND_RECONCILIATION_DELAYS_MS) {
    if (
      response.state === "ready" ||
      response.settingsPda !== args.settingsPda
    ) {
      return response;
    }

    await wait(delayMs);
    response = await args.ensure({
      settingsPda: args.settingsPda,
      signature: args.signature,
    });
  }

  return response;
}

async function reconcileProvisioningResult(args: {
  response: SmartAccountProvisioningResponse;
  dependencies: ProvisionSmartAccountDependencies;
  hasRetried: boolean;
}): Promise<SmartAccountProvisioningResponse> {
  if (args.response.state === "ready") {
    return args.response;
  }

  try {
    const signature = await sendCreateSmartAccountTransaction({
      connection: args.dependencies.connection,
      walletAddress: args.dependencies.walletAddress,
      sendTransaction: args.dependencies.sendTransaction,
      signTransaction: args.dependencies.signTransaction,
      response: args.response,
    });
    const reconciledResponse = await reconcileReadyStateAfterSend({
      settingsPda: args.response.settingsPda,
      signature,
      ensure: args.dependencies.ensure,
    });

    if (reconciledResponse.state === "ready") {
      return reconciledResponse;
    }

    if (
      !args.hasRetried &&
      reconciledResponse.settingsPda !== args.response.settingsPda
    ) {
      return reconcileProvisioningResult({
        response: reconciledResponse,
        dependencies: args.dependencies,
        hasRetried: true,
      });
    }

    return reconciledResponse;
  } catch (error) {
    if (args.hasRetried || !shouldRetrySmartAccountProvisionError(error)) {
      throw error;
    }

    const refreshedResponse = await args.dependencies.ensure({
      refreshPending: true,
    });

    return reconcileProvisioningResult({
      response: refreshedResponse,
      dependencies: args.dependencies,
      hasRetried: true,
    });
  }
}

export async function provisionSmartAccountForWalletSession(
  dependencies: ProvisionSmartAccountDependencies
): Promise<SmartAccountProvisioningResponse> {
  const initialResponse = await dependencies.ensure();

  return reconcileProvisioningResult({
    response: initialResponse,
    dependencies,
    hasRetried: false,
  });
}
