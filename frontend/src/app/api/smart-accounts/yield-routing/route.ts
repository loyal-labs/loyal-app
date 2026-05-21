import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  fetchCurrentSmartAccountOverview,
  isSmartAccountOverviewRateLimitError,
} from "@/features/smart-accounts/server/read-model";
import {
  listYieldRoutingPoliciesForPrincipal,
  saveYieldRoutingPolicyForPrincipal,
} from "@/features/yield-routing/server/repository";
import type { SaveYieldRoutingPolicyRequest } from "@/features/yield-routing/types";

function parsePublicKey(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }

  return new PublicKey(value).toBase58();
}

function parsePublicKeyList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must include at least one address.`);
  }

  return value.map((entry, index) =>
    parsePublicKey(entry, `${field}[${index}]`)
  );
}

function parseRequestBody(value: unknown): SaveYieldRoutingPolicyRequest {
  const body = value as Record<string, unknown>;
  const accountIndex = Number(body.accountIndex);

  if (
    !Number.isInteger(accountIndex) ||
    accountIndex < 0 ||
    accountIndex > 255
  ) {
    throw new Error("A valid accountIndex is required.");
  }

  const creationSignature =
    typeof body.creationSignature === "string" &&
    body.creationSignature.trim().length > 0
      ? body.creationSignature.trim()
      : null;

  return {
    accountIndex,
    vaultAddress: parsePublicKey(body.vaultAddress, "vaultAddress"),
    routeMint: parsePublicKey(body.routeMint, "routeMint"),
    rebalancePolicyPda: parsePublicKey(
      body.rebalancePolicyPda,
      "rebalancePolicyPda"
    ),
    rebalancePolicySeed: (() => {
      const seed =
        typeof body.rebalancePolicySeed === "string"
          ? body.rebalancePolicySeed.trim()
          : String(body.rebalancePolicySeed ?? "");
      if (!/^\d+$/.test(seed)) {
        throw new Error("rebalancePolicySeed must be an integer string.");
      }
      return seed;
    })(),
    delegatedSigner: parsePublicKey(body.delegatedSigner, "delegatedSigner"),
    allowedReserves: parsePublicKeyList(
      body.allowedReserves,
      "allowedReserves"
    ),
    allowedMarkets: parsePublicKeyList(body.allowedMarkets, "allowedMarkets"),
    allowedLiquidityMints: parsePublicKeyList(
      body.allowedLiquidityMints,
      "allowedLiquidityMints"
    ),
    creationSignature,
  };
}

async function resolvePrincipal(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return {
      principal: null,
      response: NextResponse.json(
        {
          error: {
            code: "unauthenticated",
            message: "No active auth session.",
          },
        },
        { status: 401 }
      ),
    };
  }

  return { principal, response: null };
}

export async function GET(request: Request) {
  const { principal, response } = await resolvePrincipal(request);
  if (!principal) return response;

  const policies = await listYieldRoutingPoliciesForPrincipal(principal);

  return NextResponse.json({ policies });
}

export async function POST(request: Request) {
  const { principal, response } = await resolvePrincipal(request);
  if (!principal) return response;

  let policy: SaveYieldRoutingPolicyRequest;

  try {
    policy = parseRequestBody(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_yield_routing_policy",
          message:
            error instanceof Error
              ? error.message
              : "Yield-routing policy payload is invalid.",
        },
      },
      { status: 400 }
    );
  }

  try {
    const overview = await fetchCurrentSmartAccountOverview({
      settingsPda: principal.settingsPda,
      invalidateAddresses: [policy.rebalancePolicyPda],
    });
    const vault = overview.vaults.find(
      (entry) => entry.accountIndex === policy.accountIndex
    );
    const onchainPolicy = overview.policies.find(
      (entry) => entry.address === policy.rebalancePolicyPda
    );

    if (!vault || vault.address !== policy.vaultAddress) {
      return NextResponse.json(
        {
          error: {
            code: "vault_not_found",
            message: "Yield-routing policy does not match an owned vault.",
          },
        },
        { status: 409 }
      );
    }

    if (
      !onchainPolicy ||
      onchainPolicy.state !== "ProgramInteraction" ||
      onchainPolicy.accountIndex !== policy.accountIndex ||
      !onchainPolicy.signers.some(
        (signer) => signer.address === policy.delegatedSigner
      )
    ) {
      return NextResponse.json(
        {
          error: {
            code: "policy_not_found",
            message:
              "Create the on-chain yield-routing policy before saving metadata.",
          },
        },
        { status: 409 }
      );
    }

    const saved = await saveYieldRoutingPolicyForPrincipal({
      principal,
      policy,
    });

    return NextResponse.json({ policy: saved });
  } catch (error) {
    if (isSmartAccountOverviewRateLimitError(error)) {
      return NextResponse.json(
        {
          error: {
            code: "rpc_rate_limited",
            message:
              "Smart-account data is temporarily rate limited. Please wait a moment and try again.",
          },
        },
        {
          headers: {
            "Retry-After": error.retryAfterSeconds.toString(),
          },
          status: 429,
        }
      );
    }

    throw error;
  }
}
