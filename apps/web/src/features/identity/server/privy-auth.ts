import "server-only";

import { PrivyClient } from "@privy-io/node";
import { createAuthSessionTokenClaims } from "@loyal-labs/auth-core";
import type { AuthSessionUser } from "@loyal-labs/auth-core";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { ensureWalletUserSmartAccount } from "@/features/smart-accounts/server/service";
import { createAuthSessionCookieService } from "@/features/identity/server/session-cookie";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { getServerEnv } from "@/lib/core/config/server";

import { trackWalletOnboardingEvent } from "./wallet-onboarding-analytics";

let privyClient: PrivyClient | null = null;

function getPrivyClient(): PrivyClient {
  if (privyClient) return privyClient;
  const { privyAppId, privyAppSecret } = getServerEnv();
  if (!privyAppId || !privyAppSecret) {
    throw new WalletAuthError("Privy is not configured.", {
      code: "privy_not_configured",
      status: 503,
    });
  }
  privyClient = new PrivyClient({
    appId: privyAppId,
    appSecret: privyAppSecret,
  });
  return privyClient;
}

export type PrivyLinkedWallet = {
  address: string;
  embedded: boolean;
};

export type PrivyIdentity = {
  privyUserId: string;
  email: string | null;
  wallets: PrivyLinkedWallet[];
};

// Verifies a Privy identity token and flattens the linked accounts we care
// about. Signature-only check via Privy's verification key; no user lookup.
export async function verifyPrivyIdentityToken(
  identityToken: string
): Promise<PrivyIdentity> {
  let user;
  try {
    user = await getPrivyClient().users().get({ id_token: identityToken });
  } catch {
    throw new WalletAuthError("Privy identity token is invalid.", {
      code: "privy_identity_token_invalid",
      status: 401,
    });
  }

  const wallets: PrivyLinkedWallet[] = [];
  let email: string | null = null;
  for (const account of user.linked_accounts) {
    if (
      account.type === "wallet" &&
      "chain_type" in account &&
      account.chain_type === "solana"
    ) {
      wallets.push({
        address: account.address,
        embedded:
          "connector_type" in account && account.connector_type === "embedded",
      });
    } else if (account.type === "email") {
      email = account.address;
    } else if (account.type === "google_oauth" && !email) {
      email = account.email;
    }
  }

  return { privyUserId: user.id, email, wallets };
}

export type PrivyAuthCompletion = {
  user: AuthSessionUser;
  sessionToken: string;
};

// Exchange a verified Privy identity for a Loyal session. The user stays keyed
// by wallet address (provider "solana"), so an extension user who now logs in
// through Privy lands on the same app_users row and the same smart account.
export async function completePrivyAuth(args: {
  identityToken: string;
  walletAddress: string;
  requestOrigin: string;
}): Promise<PrivyAuthCompletion> {
  const identity = await verifyPrivyIdentityToken(args.identityToken);
  const wallet = identity.wallets.find((w) => w.address === args.walletAddress);
  if (!wallet) {
    throw new WalletAuthError(
      "Wallet is not linked to the authenticated Privy user.",
      { code: "privy_wallet_not_linked", status: 403 }
    );
  }

  const userRecord = await getOrCreateCurrentUser({
    provider: "solana",
    authMethod: "wallet",
    subjectAddress: wallet.address,
    walletAddress: wallet.address,
    ...(identity.email ? { email: identity.email } : {}),
  });
  const ensureResult = await ensureWalletUserSmartAccount({
    userId: userRecord.id,
    walletAddress: wallet.address,
  });

  const solanaEnv = getServerEnv().solanaEnv;
  trackWalletOnboardingEvent(
    ensureResult.provisioningOutcome.startsWith("sponsored_")
      ? "sponsorship_submitted"
      : "existing_smart_account_reused",
    {
      origin: args.requestOrigin,
      walletAddress: wallet.address,
      solanaEnv,
      provisioningOutcome: ensureResult.provisioningOutcome,
      authSource: "privy",
      walletKind: wallet.embedded ? "embedded" : "external",
    }
  );

  const user: AuthSessionUser = {
    authMethod: "wallet",
    provider: "solana",
    subjectAddress: wallet.address,
    displayAddress: wallet.address,
    walletAddress: wallet.address,
    smartAccountAddress: ensureResult.smartAccount.smartAccountAddress,
    settingsPda: ensureResult.smartAccount.settingsPda,
    ...(identity.email ? { email: identity.email } : {}),
  };
  createAuthSessionTokenClaims(user);
  const sessionToken = await createAuthSessionCookieService({
    getConfig: () => getServerEnv(),
  }).issueSessionToken(user);

  return { user, sessionToken };
}
