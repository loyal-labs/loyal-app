import "server-only";

import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { assertAuthenticatedWalletControlsSettings } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";

import {
  readEarnMaxActivity,
  readEarnMaxPerformance,
  readEarnMaxState,
} from "./repository.server";

const headers = {
  "x-loyal-earn-max-contract": "earn-max-v2",
  "x-loyal-deployment-revision":
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.RENDER_GIT_COMMIT ??
    "unknown",
};

function json(value: unknown, status = 200) {
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

async function authenticatedRead(
  request: Request,
  read: (settings: string) => Promise<unknown>
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

export function getState(request: Request) {
  return authenticatedRead(request, async (settings) => {
    const state = await readEarnMaxState(settings);
    return {
      config: {
        delegatedSigner: getDeploymentPolicySignerPublicKey().toBase58(),
        programId: getServerEnv().loyalSmartAccounts.programId,
      },
      state,
    };
  });
}

export function getPerformance(request: Request) {
  return authenticatedRead(request, async (settings) => ({
    performance: await readEarnMaxPerformance(settings),
  }));
}

export function getActivity(request: Request) {
  return authenticatedRead(request, readEarnMaxActivity);
}
