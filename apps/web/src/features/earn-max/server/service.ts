import "server-only";

import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { assertAuthenticatedWalletControlsSettings } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";

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

async function settingsFor(request: Request): Promise<string | null> {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);
  if (!principal) return null;
  await assertAuthenticatedWalletControlsSettings({
    settingsPda: principal.settingsPda,
    smartAccountAddress: principal.smartAccountAddress,
    walletAddress: principal.walletAddress,
  });
  return principal.settingsPda;
}

async function authenticatedRead<T>(
  request: Request,
  read: (settings: string) => Promise<T>
) {
  const settings = await settingsFor(request);
  if (!settings) {
    return json(
      {
        error: { code: "unauthenticated", message: "No active auth session." },
      },
      401
    );
  }
  return json(await read(settings));
}

export function getSummary(request: Request) {
  return authenticatedRead<EarnMaxSummaryResponse>(
    request,
    async (settings) => ({
      config: {
        delegatedSigner: getDeploymentPolicySignerPublicKey().toBase58(),
        programId: getServerEnv().loyalSmartAccounts.programId,
      },
      summary: await readEarnMaxSummary(settings),
    })
  );
}

export function getActivity(request: Request) {
  return authenticatedRead(request, readEarnMaxActivity);
}
