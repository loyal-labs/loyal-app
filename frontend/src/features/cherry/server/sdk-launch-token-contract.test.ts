import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { verifyLaunchToken } from "@cherrydotfun/miniapp-sdk";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

mock.module("server-only", () => ({}));

import type { CherryMiniAppConfig } from "@/features/cherry/config";

const { verifyCherryLaunch } = await import("./launch-token");

const JWKS_URL = "https://jwks.cherry-contract.invalid/keys";
const APP_ID = "miniapp_contract_test";
const ORIGIN = "https://askloyal.com/app/cherry";
const ISSUER = "https://chat.cherry.fun";
const originalFetch = globalThis.fetch;
const config: CherryMiniAppConfig = {
  mode: "enabled",
  appId: APP_ID,
  expectedOrigin: ORIGIN,
  issuer: ISSUER,
  jwksUrl: JWKS_URL,
};

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const generated = await generateKeyPair("RS256");
  privateKey = generated.privateKey;
  publicJwk = {
    ...(await exportJWK(generated.publicKey)),
    alg: "RS256",
    kid: "cherry-contract-key",
    use: "sig",
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installLocalJwks() {
  globalThis.fetch = (async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
    if (url !== JWKS_URL) {
      throw new Error(`Unexpected network request: ${url}`);
    }
    return Response.json({ keys: [publicJwk] });
  }) as typeof globalThis.fetch;
}

async function issueToken(options: {
  expiresAt?: number;
  issuedAt?: number;
  issuer?: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    app_id: APP_ID,
    origin: ORIGIN,
    room_id: "room_contract_test",
  })
    .setProtectedHeader({ alg: "RS256", kid: "cherry-contract-key" })
    .setIssuer(options.issuer ?? ISSUER)
    .setSubject("11111111111111111111111111111111")
    .setJti("token_contract_test")
    .setIssuedAt(options.issuedAt ?? now)
    .setExpirationTime(options.expiresAt ?? now + 300)
    .sign(privateKey);
}

describe("installed Cherry SDK launch-token contract", () => {
  test("verifies one signed launch through both the SDK and Loyal claim boundary", async () => {
    installLocalJwks();
    const now = Math.floor(Date.now() / 1000);
    const valid = await issueToken({ issuedAt: now, expiresAt: now + 300 });

    await expect(
      verifyCherryLaunch(valid, config, verifyLaunchToken, () => now)
    ).resolves.toEqual({
      walletAddress: "11111111111111111111111111111111",
      roomId: "room_contract_test",
      tokenId: "token_contract_test",
      issuedAt: now,
      expiresAt: now + 300,
    });

    await expect(
      verifyCherryLaunch(
        await issueToken({ issuedAt: now, expiresAt: now + 301 }),
        config,
        verifyLaunchToken,
        () => now
      )
    ).rejects.toMatchObject({ code: "invalid_cherry_context" });

    await expect(
      verifyCherryLaunch(
        await issueToken({ issuer: "https://attacker.invalid" }),
        config,
        verifyLaunchToken,
        () => now
      )
    ).rejects.toMatchObject({ code: "invalid_cherry_issuer" });
  });
});
