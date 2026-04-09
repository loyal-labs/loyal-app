import "server-only";

import { createHash } from "node:crypto";
import {
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type CryptoKey as JoseCryptoKey,
  type JWTPayload,
} from "jose";

import {
  authSessionTokenClaimsSchema,
  type AuthSessionTokenClaimsData,
} from "@loyal-labs/auth-core";

export type AuthSessionTokenClaims = JWTPayload & AuthSessionTokenClaimsData;

function createSecretKey(secret: string): Uint8Array {
  return createHash("sha256").update(secret).digest();
}

export async function issueAuthSessionToken(
  claims: Omit<AuthSessionTokenClaims, "iat" | "exp">,
  secret: string,
  ttlSeconds: number
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(createSecretKey(secret));
}

export async function verifyAuthSessionToken(
  token: string,
  secret: string
): Promise<AuthSessionTokenClaims> {
  const { payload } = await jwtVerify<AuthSessionTokenClaims>(
    token,
    createSecretKey(secret)
  );

  return authSessionTokenClaimsSchema.parse(payload);
}

const RS256_ALG = "RS256";

let cachedRs256PrivateKey: JoseCryptoKey | null = null;
let cachedRs256PrivateKeyPem: string | null = null;

let cachedRs256PublicKey: JoseCryptoKey | null = null;
let cachedRs256PublicKeyPem: string | null = null;

async function getRs256PrivateKey(pem: string): Promise<JoseCryptoKey> {
  if (cachedRs256PrivateKey && cachedRs256PrivateKeyPem === pem) {
    return cachedRs256PrivateKey;
  }

  cachedRs256PrivateKey = await importPKCS8(pem, RS256_ALG);
  cachedRs256PrivateKeyPem = pem;
  return cachedRs256PrivateKey;
}

async function getRs256PublicKey(pem: string): Promise<JoseCryptoKey> {
  if (cachedRs256PublicKey && cachedRs256PublicKeyPem === pem) {
    return cachedRs256PublicKey;
  }

  cachedRs256PublicKey = await importSPKI(pem, RS256_ALG);
  cachedRs256PublicKeyPem = pem;
  return cachedRs256PublicKey;
}

export async function issueAuthSessionTokenRS256(
  claims: Omit<AuthSessionTokenClaims, "iat" | "exp">,
  privateKeyPem: string,
  ttlSeconds: number
): Promise<string> {
  const key = await getRs256PrivateKey(privateKeyPem);

  return new SignJWT(claims)
    .setProtectedHeader({ alg: RS256_ALG, typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

export async function verifyAuthSessionTokenRS256(
  token: string,
  publicKeyPem: string
): Promise<AuthSessionTokenClaims> {
  const key = await getRs256PublicKey(publicKeyPem);
  const { payload } = await jwtVerify<AuthSessionTokenClaims>(token, key, {
    algorithms: [RS256_ALG],
  });

  return authSessionTokenClaimsSchema.parse(payload);
}

export async function verifyAuthSessionTokenMulti(
  token: string,
  options: { rs256PublicKey?: string; hs256Secret?: string }
): Promise<AuthSessionTokenClaims> {
  if (options.rs256PublicKey) {
    try {
      return await verifyAuthSessionTokenRS256(token, options.rs256PublicKey);
    } catch {
      // Fall through to HS256 verification below.
    }
  }

  if (options.hs256Secret) {
    return verifyAuthSessionToken(token, options.hs256Secret);
  }

  throw new Error("No valid JWT verification key provided");
}
