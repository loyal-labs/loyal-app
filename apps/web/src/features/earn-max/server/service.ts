import "server-only";

import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { assertAuthenticatedWalletControlsSettings } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";

import { EARN_MAX_BACKEND } from "../constants";
import {
  readEarnMaxVoltrActivity,
  readEarnMaxVoltrSummary,
} from "../voltr/summary.server";
import { hasRedeemedInvite, redeemInvite } from "./invite.server";
import { consumeInviteAttempt } from "./invite-rate-limit.server";
import { readEarnMaxActivity, readEarnMaxSummary } from "./repository.server";

import type { EarnMaxSummaryResponse } from "../types";

const headers = {
  "x-loyal-earn-max-contract": "earn-max-v4",
  "x-loyal-deployment-revision":
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.RENDER_GIT_COMMIT ??
    "unknown",
};

function json<T>(value: T, status = 200) {
  return NextResponse.json(value, { headers, status });
}

async function principalFor(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);
  if (!principal) return null;
  await assertAuthenticatedWalletControlsSettings({
    settingsPda: principal.settingsPda,
    smartAccountAddress: principal.smartAccountAddress,
    walletAddress: principal.walletAddress,
  });
  return principal;
}

const unauthenticated = () =>
  json(
    { error: { code: "unauthenticated", message: "No active auth session." } },
    401
  );

async function authenticatedRead<T>(
  request: Request,
  read: (settings: string) => Promise<T>
) {
  const principal = await principalFor(request);
  if (!principal) return unauthenticated();
  if (!(await hasRedeemedInvite(principal.walletAddress))) {
    return json({ error: { code: "invite_required" } }, 403);
  }
  return json(await read(principal.settingsPda));
}

export function getSummary(request: Request) {
  return authenticatedRead<EarnMaxSummaryResponse>(request, async (settings) =>
    EARN_MAX_BACKEND === "voltr"
      ? {
          // Voltr has no delegated worker signer on the user's account.
          config: {
            delegatedSigner: "",
            programId: getServerEnv().loyalSmartAccounts.programId,
          },
          summary: await readEarnMaxVoltrSummary(settings),
        }
      : {
          config: {
            delegatedSigner: getDeploymentPolicySignerPublicKey().toBase58(),
            programId: getServerEnv().loyalSmartAccounts.programId,
          },
          summary: await readEarnMaxSummary(settings),
        }
  );
}

export function getActivity(request: Request) {
  return authenticatedRead(request, (settings) =>
    EARN_MAX_BACKEND === "voltr"
      ? readEarnMaxVoltrActivity(settings)
      : readEarnMaxActivity(settings)
  );
}

export async function getInvite(request: Request) {
  const principal = await principalFor(request);
  if (!principal) return unauthenticated();
  return json({ redeemed: await hasRedeemedInvite(principal.walletAddress) });
}

export async function postInvite(request: Request) {
  const principal = await principalFor(request);
  if (!principal) return unauthenticated();
  if (!consumeInviteAttempt(principal.walletAddress)) {
    return json({ error: { code: "rate_limited" } }, 429);
  }
  const body = (await request.json().catch(() => null)) as {
    code?: unknown;
  } | null;
  const result = await redeemInvite({
    code: body?.code,
    settingsPda: principal.settingsPda,
    walletAddress: principal.walletAddress,
  });
  if (result === "redeemed" || result === "already_redeemed") {
    return json({ redeemed: true });
  }
  return json({ error: { code: result } }, result === "code_used" ? 409 : 400);
}
