import "server-only";

import { createHash } from "node:crypto";
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";

import { getServerEnv } from "@/lib/core/config/server";

import {
  authenticateMobileWalletRequest,
  type MobileWalletAuthPurpose,
} from "./mobile-wallet-auth";
import { WalletAuthError } from "./wallet-auth-errors";
import { decodeWalletAddress } from "./wallet-auth-signature";

// Mobile Earn session (ASK-1846): a long-lived bearer token that lets the
// native app call the DB-only Autodeposit endpoints (sweeps/execute, floor,
// toggle) without signing a fresh 5-minute wallet auth message — each of those
// signatures costs a Seed Vault/MWA approval prompt on-device, while the web
// does the same actions on its session cookie with zero prompts.
//
// The token is deliberately NOT interchangeable with the web session cookie:
// it carries only a dedicated audience + the wallet address as subject, so
// `authSessionTokenClaimsSchema` rejects it as a web session, and this module
// requires the audience the web tokens lack. Minting requires the same proof
// of wallet control as every other mobile Earn request (a purpose-scoped
// signed message within the freshness window), so it grants nothing a signed
// message doesn't already grant — it only amortizes the prompt.
const MOBILE_EARN_SESSION_AUDIENCE = "loyal-mobile-earn";
const MOBILE_EARN_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const RS256_ALG = "RS256";
const HS256_ALG = "HS256";

// Same secret derivation as session-token.ts so AUTH_JWT_SECRET behaves
// identically for both token kinds.
function hs256Key(secret: string): Uint8Array {
  return createHash("sha256").update(secret).digest();
}

export async function issueMobileEarnSessionToken(
  walletAddress: string
): Promise<{ token: string; expiresAt: string }> {
  const { authJwtSecret, authSessionRs256PrivateKey } = getServerEnv();

  const jwt = new SignJWT({})
    .setAudience(MOBILE_EARN_SESSION_AUDIENCE)
    .setSubject(walletAddress)
    .setIssuedAt()
    .setExpirationTime(`${MOBILE_EARN_SESSION_TTL_SECONDS}s`);

  let token: string;
  if (authSessionRs256PrivateKey) {
    token = await jwt
      .setProtectedHeader({ alg: RS256_ALG, typ: "JWT" })
      .sign(await importPKCS8(authSessionRs256PrivateKey, RS256_ALG));
  } else if (authJwtSecret) {
    token = await jwt
      .setProtectedHeader({ alg: HS256_ALG, typ: "JWT" })
      .sign(hs256Key(authJwtSecret));
  } else {
    throw new Error(
      "Mobile Earn session signing is not configured. Set AUTH_JWT_SECRET or AUTH_JWT_RS256_PRIVATE_KEY."
    );
  }

  return {
    token,
    expiresAt: new Date(
      Date.now() + MOBILE_EARN_SESSION_TTL_SECONDS * 1000
    ).toISOString(),
  };
}

async function verifyMobileEarnSessionToken(
  token: string
): Promise<string | null> {
  const { authJwtSecret, authSessionRs256PublicKey } = getServerEnv();

  if (authSessionRs256PublicKey) {
    try {
      const { payload } = await jwtVerify(
        token,
        await importSPKI(authSessionRs256PublicKey, RS256_ALG),
        { algorithms: [RS256_ALG], audience: MOBILE_EARN_SESSION_AUDIENCE }
      );
      if (typeof payload.sub === "string") {
        return payload.sub;
      }
    } catch {
      // Fall through to HS256 verification below.
    }
  }

  if (authJwtSecret) {
    try {
      const { payload } = await jwtVerify(token, hs256Key(authJwtSecret), {
        algorithms: [HS256_ALG],
        audience: MOBILE_EARN_SESSION_AUDIENCE,
      });
      if (typeof payload.sub === "string") {
        return payload.sub;
      }
    } catch {
      return null;
    }
  }

  return null;
}

// Session-or-signature auth for the DB-only mobile Earn endpoints: a bearer
// token authenticates without body auth fields; a request without the header
// keeps the existing wallet-signed-message contract. A PRESENT-but-invalid
// token fails with `invalid_mobile_session` (instead of falling through to a
// confusing body-fields error) so the client knows to drop its cached token
// and retry with a signed message.
export async function authenticateMobileEarnRequest(args: {
  request: Request;
  body: unknown;
  purpose: MobileWalletAuthPurpose | readonly MobileWalletAuthPurpose[];
}): Promise<{ walletAddress: string }> {
  const header = args.request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const walletAddress = await verifyMobileEarnSessionToken(
      header.slice("bearer ".length).trim()
    );
    if (!walletAddress) {
      throw new WalletAuthError("Mobile Earn session is invalid or expired.", {
        code: "invalid_mobile_session",
        status: 401,
      });
    }
    decodeWalletAddress(walletAddress);
    return { walletAddress };
  }

  return authenticateMobileWalletRequest({
    body: args.body,
    purpose: args.purpose,
  });
}
