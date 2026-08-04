import "server-only";

import {
  createCherryMiniAppConfig,
  type CherryMiniAppConfig,
} from "@/features/cherry/config";

import {
  CherryLaunchTokenError,
  verifyCherryLaunch,
  type VerifiedCherryLaunch,
} from "./launch-token";

type CherryLaunchVerifier = (
  token: string,
  config: CherryMiniAppConfig
) => Promise<VerifiedCherryLaunch>;

type CherryLaunchAttestationDependencies = {
  getConfig: () => CherryMiniAppConfig;
  verifyLaunch: CherryLaunchVerifier;
};

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
} as const;

function jsonError(code: string, message: string, status: number): Response {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    {
      headers: NO_STORE_HEADERS,
      status,
    }
  );
}

function isSameOriginRequest(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin;
}

function createDefaultDependencies(): CherryLaunchAttestationDependencies {
  return {
    getConfig: () => createCherryMiniAppConfig(process.env),
    verifyLaunch: (token, config) => verifyCherryLaunch(token, config),
  };
}

export async function attestCherryLaunch(
  request: Request,
  dependencies: CherryLaunchAttestationDependencies = createDefaultDependencies()
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return jsonError(
      "invalid_request_origin",
      "Cherry launch requests must come from the same origin.",
      403
    );
  }

  const body = (await request.json().catch(() => null)) as unknown;
  if (
    typeof body !== "object" ||
    body === null ||
    !("launchToken" in body) ||
    typeof body.launchToken !== "string"
  ) {
    return jsonError(
      "invalid_cherry_launch_request",
      "A Cherry launch token is required.",
      400
    );
  }

  try {
    const launch = await dependencies.verifyLaunch(
      body.launchToken,
      dependencies.getConfig()
    );

    return Response.json(
      {
        walletAddress: launch.walletAddress,
        roomId: launch.roomId,
        issuedAt: launch.issuedAt,
        expiresAt: launch.expiresAt,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    if (error instanceof CherryLaunchTokenError) {
      return jsonError(
        error.code,
        error.code === "cherry_not_configured"
          ? "Cherry MiniApp integration is not configured."
          : "Cherry launch could not be verified.",
        error.status
      );
    }

    return jsonError(
      "cherry_launch_unavailable",
      "Cherry launch could not be verified.",
      503
    );
  }
}

export type { CherryLaunchAttestationDependencies, CherryLaunchVerifier };
