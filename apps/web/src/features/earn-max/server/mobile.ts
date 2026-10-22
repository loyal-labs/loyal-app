import "server-only";

import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  findCurrentUser,
  getOrCreateCurrentUser,
} from "@/features/chat/server/app-user";
import { authenticateMobileEarnRequest } from "@/features/identity/server/mobile-earn-session";
import { decodeWalletAddress } from "@/features/identity/server/wallet-auth-signature";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import {
  assertAuthenticatedWalletControlsSettings,
  ensureWalletUserSmartAccountTraced,
  findReadyCurrentUserSmartAccount,
  isSmartAccountProvisioningError,
} from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";

import { EARN_MAX_BACKEND } from "../constants";
import {
  readEarnMaxVoltrActivity,
  readEarnMaxVoltrSummary,
  readEarnMaxWalletUsdcBalance,
} from "../voltr/summary.server";

function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function failure(status: number, code: string, message: string) {
  return json({ error: { code, message } }, status);
}

/** Native auth resolves the canonical account server-side; callers cannot select it. */
export async function postMobileEarnMax(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !["summary", "activity", "context"].includes(body.action)) {
    return failure(400, "invalid_request", "Unknown Earn MAX action.");
  }
  try {
    const signed =
      request.headers.has("authorization") || body.signature != null;
    const principal = signed
      ? null
      : await resolveAuthenticatedPrincipalFromRequest(request);
    const walletAddress = signed
      ? (
          await authenticateMobileEarnRequest({
            request,
            body,
            purpose: "earn-max",
          })
        ).walletAddress
      : principal?.walletAddress;
    if (!walletAddress)
      return failure(401, "unauthenticated", "Sign in to access Earn MAX.");
    if (!signed && body.walletAddress !== walletAddress) {
      return failure(401, "wallet_mismatch", "Sign in with the active wallet.");
    }
    const config = getServerEnv();
    if (
      EARN_MAX_BACKEND !== "voltr" ||
      !["mainnet", "mainnet-beta"].includes(config.solanaEnv)
    ) {
      return failure(409, "unsupported_cluster", "Earn MAX requires mainnet.");
    }
    let user = await findCurrentUser({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: walletAddress,
      walletAddress,
    });
    let account = user
      ? await findReadyCurrentUserSmartAccount({
          userId: user.id,
          walletAddress,
        })
      : null;
    if (!account && body.action === "context") {
      // Shipped clients send no deposit amount; require the $1 minimum before sponsoring setup.
      const balance = await readEarnMaxWalletUsdcBalance(walletAddress);
      if (balance < BigInt(1_000_000)) {
        return failure(
          402,
          "insufficient_balance",
          "At least $1 USDC is needed in your wallet to set up Earn MAX."
        );
      }
      user ??= await getOrCreateCurrentUser({
        provider: "solana",
        authMethod: "wallet",
        subjectAddress: walletAddress,
        walletAddress,
      });
      const ensured = await ensureWalletUserSmartAccountTraced({
        userId: user.id,
        walletAddress,
        request,
      });
      account = ensured.smartAccount;
    }
    if (!account) {
      return failure(
        409,
        "smart_account_required",
        "Your Earn MAX account will be set up with your first deposit."
      );
    }
    await assertAuthenticatedWalletControlsSettings({
      settingsPda: account.settingsPda,
      smartAccountAddress: account.smartAccountAddress,
      walletAddress,
    });
    if (body.action === "context") {
      return json({
        cluster: "mainnet",
        walletAddress,
        settingsPda: account.settingsPda,
        programId: config.loyalSmartAccounts.programId,
      });
    }
    if (body.action === "activity") {
      return json(await readEarnMaxVoltrActivity(account.settingsPda));
    }
    return json({
      config: {
        delegatedSigner: "",
        programId: config.loyalSmartAccounts.programId,
      },
      summary: await readEarnMaxVoltrSummary(account.settingsPda),
    });
  } catch (error) {
    if (
      error instanceof WalletAuthError ||
      isSmartAccountProvisioningError(error)
    ) {
      return failure(error.status, error.code, error.message);
    }
    // Never log the request body: it can contain an auth signature.
    console.error("[mobile-earn-max] request failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return failure(
      500,
      "earn_max_unavailable",
      "Earn MAX is temporarily unavailable."
    );
  }
}

/** Same passive wallet-address read contract as mobile Earn state/earnings.
 * Returns on-chain-derived data only; never provisions accounts or prepares transactions.
 */
export async function getMobileEarnMax(request: Request) {
  const params = new URL(request.url).searchParams;
  const action = params.get("action");
  if (action !== "summary" && action !== "activity")
    return failure(400, "invalid_request", "Unknown Earn MAX read action.");
  const walletAddress = params.get("walletAddress")?.trim() ?? "";
  try {
    decodeWalletAddress(walletAddress);
    const config = getServerEnv();
    if (
      EARN_MAX_BACKEND !== "voltr" ||
      !["mainnet", "mainnet-beta"].includes(config.solanaEnv)
    )
      return failure(409, "unsupported_cluster", "Earn MAX requires mainnet.");
    const user = await findCurrentUser({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: walletAddress,
      walletAddress,
    });
    const account = user
      ? await findReadyCurrentUserSmartAccount({
          userId: user.id,
          walletAddress,
        })
      : null;
    if (account)
      await assertAuthenticatedWalletControlsSettings({
        settingsPda: account.settingsPda,
        smartAccountAddress: account.smartAccountAddress,
        walletAddress,
      });
    if (action === "activity")
      return json(
        account
          ? await readEarnMaxVoltrActivity(account.settingsPda)
          : { operations: [], performance: [] }
      );
    return json({
      config: {
        delegatedSigner: "",
        programId: config.loyalSmartAccounts.programId,
      },
      summary: account
        ? await readEarnMaxVoltrSummary(account.settingsPda)
        : null,
    });
  } catch (error) {
    if (
      error instanceof WalletAuthError ||
      isSmartAccountProvisioningError(error)
    )
      return failure(error.status, error.code, error.message);
    console.error("[mobile-earn-max] read failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return failure(502, "earn_max_unavailable", "Unable to update Earn MAX.");
  }
}
