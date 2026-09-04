import "server-only";

import {
  verifyLaunchToken,
  type LaunchTokenPayload,
} from "@cherrydotfun/miniapp-sdk";
import { PublicKey } from "@solana/web3.js";

import type { CherryMiniAppConfig } from "@/features/cherry/config";

type EnabledCherryConfig = Extract<CherryMiniAppConfig, { mode: "enabled" }>;

type LaunchTokenVerifier = (
  token: string,
  options: {
    expectedAppId: string;
    expectedOrigin?: string;
    jwksUrl?: string;
  }
) => Promise<LaunchTokenPayload>;

type UnixTimeSource = () => number;

const MAX_ISSUED_AT_FUTURE_SKEW_SECONDS = 60;
const MAX_LAUNCH_TOKEN_LIFETIME_SECONDS = 5 * 60;

export class CherryLaunchTokenError extends Error {
  readonly code:
    | "cherry_not_configured"
    | "invalid_cherry_launch_token"
    | "invalid_cherry_issuer"
    | "invalid_cherry_wallet"
    | "invalid_cherry_context";
  readonly status: number;

  constructor(
    message: string,
    options: { code: CherryLaunchTokenError["code"]; status: number }
  ) {
    super(message);
    this.name = "CherryLaunchTokenError";
    this.code = options.code;
    this.status = options.status;
  }
}

export type VerifiedCherryLaunch = {
  walletAddress: string;
  roomId: string;
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
};

export async function verifyCherryLaunch(
  token: string,
  config: CherryMiniAppConfig,
  verifier: LaunchTokenVerifier = verifyLaunchToken,
  now: UnixTimeSource = () => Math.floor(Date.now() / 1000)
): Promise<VerifiedCherryLaunch> {
  if (config.mode !== "enabled") {
    throw new CherryLaunchTokenError(config.reason, {
      code: "cherry_not_configured",
      status: 503,
    });
  }

  const normalizedToken = token.trim();
  if (!normalizedToken) {
    throw new CherryLaunchTokenError("Cherry launch token is required.", {
      code: "invalid_cherry_launch_token",
      status: 400,
    });
  }

  let payload: LaunchTokenPayload;
  try {
    payload = await verifier(normalizedToken, {
      expectedAppId: config.appId,
      expectedOrigin: config.expectedOrigin,
      jwksUrl: config.jwksUrl,
    });
  } catch {
    throw new CherryLaunchTokenError(
      "Cherry launch token could not be verified.",
      {
        code: "invalid_cherry_launch_token",
        status: 401,
      }
    );
  }

  const issuer = (payload as LaunchTokenPayload & { iss?: unknown }).iss;
  if (issuer !== config.issuer) {
    throw new CherryLaunchTokenError("Cherry launch token issuer is invalid.", {
      code: "invalid_cherry_issuer",
      status: 401,
    });
  }

  let walletAddress: string;
  try {
    walletAddress = new PublicKey(payload.sub).toBase58();
  } catch {
    throw new CherryLaunchTokenError("Cherry launch token wallet is invalid.", {
      code: "invalid_cherry_wallet",
      status: 401,
    });
  }

  const roomId = payload.room_id?.trim();
  const tokenId = payload.jti?.trim();
  const issuedAt = payload.iat;
  const expiresAt = payload.exp;
  const currentTime = now();

  if (
    !roomId ||
    !tokenId ||
    !Number.isInteger(issuedAt) ||
    !Number.isInteger(expiresAt) ||
    issuedAt <= 0 ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_LAUNCH_TOKEN_LIFETIME_SECONDS ||
    issuedAt > currentTime + MAX_ISSUED_AT_FUTURE_SKEW_SECONDS ||
    expiresAt <= currentTime
  ) {
    throw new CherryLaunchTokenError(
      "Cherry launch token context is incomplete.",
      {
        code: "invalid_cherry_context",
        status: 401,
      }
    );
  }

  return {
    walletAddress,
    roomId,
    tokenId,
    issuedAt,
    expiresAt,
  };
}

export type { EnabledCherryConfig, LaunchTokenVerifier, UnixTimeSource };
