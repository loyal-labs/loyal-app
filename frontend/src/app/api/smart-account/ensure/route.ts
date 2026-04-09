import type { EnsureSmartAccountRequest } from "@/features/smart-accounts/contracts";
import { ensureSmartAccountRequestSchema } from "@/features/smart-accounts/contracts";
import {
  ensureCurrentUserSmartAccount,
  isSmartAccountProvisioningError,
} from "@/features/smart-accounts/server/service";
import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";
import {
  isAuthGatewayError,
  resolveAuthenticatedPrincipalFromRequest,
} from "@/features/identity/server/auth-session";
import { LOCAL_DEV_PRINCIPAL } from "@/features/identity/server/local-dev-principal";
import { getServerEnv } from "@/lib/core/config/server";

async function resolveRequestPrincipal(
  request: Request
): Promise<AuthenticatedPrincipal | null> {
  const { appEnvironment } = getServerEnv();
  const isLocal = appEnvironment === "local";

  try {
    return (
      (await resolveAuthenticatedPrincipalFromRequest(request)) ??
      (isLocal ? LOCAL_DEV_PRINCIPAL : null)
    );
  } catch (error) {
    if (isLocal) {
      return LOCAL_DEV_PRINCIPAL;
    }

    if (isAuthGatewayError(error)) {
      throw error;
    }

    throw error;
  }
}

async function readRequestBody(request: Request): Promise<EnsureSmartAccountRequest> {
  const payload = (await request.json().catch(() => ({}))) as unknown;
  const parsed = ensureSmartAccountRequestSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Response(
      JSON.stringify({
        error: {
          code: "invalid_request",
          message: "Invalid smart account ensure payload.",
        },
      }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }

  return parsed.data;
}

export async function POST(request: Request) {
  try {
    const principal = await resolveRequestPrincipal(request);
    if (!principal) {
      return Response.json(
        {
          error: {
            code: "unauthenticated",
            message: "Authentication is required to provision a smart account.",
          },
        },
        { status: 401 }
      );
    }

    const payload = await readRequestBody(request);
    const response = await ensureCurrentUserSmartAccount({
      principal,
      refreshPending: payload.refreshPending ?? false,
      settingsPda: payload.settingsPda,
      signature: payload.signature,
    });

    return Response.json(response);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    if (isAuthGatewayError(error)) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }

    if (isSmartAccountProvisioningError(error)) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }

    throw error;
  }
}
