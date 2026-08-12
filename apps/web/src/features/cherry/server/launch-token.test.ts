import { describe, expect, test } from "bun:test";
import type { LaunchTokenPayload } from "@cherrydotfun/miniapp-sdk";

import type { CherryMiniAppConfig } from "../config";
import {
  CherryLaunchTokenError,
  verifyCherryLaunch,
  type LaunchTokenVerifier,
} from "./launch-token";

const WALLET = "11111111111111111111111111111111";
const NOW = 1_100;
const config: CherryMiniAppConfig = {
  mode: "enabled",
  appId: "miniapp_123",
  expectedOrigin: "https://askloyal.com",
  issuer: "https://chat.cherry.fun",
  jwksUrl: "https://chat.cherry.fun/.well-known/jwks.json",
};

function payload(
  overrides: Partial<LaunchTokenPayload & { iss: string }> = {}
): LaunchTokenPayload {
  return {
    sub: WALLET,
    app_id: "miniapp_123",
    room_id: "room_123",
    origin: "https://askloyal.com",
    user: { display_name: "Test", avatar_url: "" },
    room: { title: "Loyal", member_count: 2 },
    iat: 1_000,
    exp: 1_300,
    jti: "token_123",
    iss: "https://chat.cherry.fun",
    ...overrides,
  } as LaunchTokenPayload;
}

function verifier(result: LaunchTokenPayload): LaunchTokenVerifier {
  return async () => result;
}

describe("verifyCherryLaunch", () => {
  test("returns only the verified identity and idempotency context", async () => {
    await expect(
      verifyCherryLaunch("signed.jwt", config, verifier(payload()), () => NOW)
    ).resolves.toEqual({
      walletAddress: WALLET,
      roomId: "room_123",
      tokenId: "token_123",
      issuedAt: 1_000,
      expiresAt: 1_300,
    });
  });

  test("rejects a token signed for an unexpected issuer", async () => {
    await expect(
      verifyCherryLaunch(
        "signed.jwt",
        config,
        verifier(payload({ iss: "https://attacker.example" })),
        () => NOW
      )
    ).rejects.toMatchObject({
      code: "invalid_cherry_issuer",
      status: 401,
    });
  });

  test("rejects a token without a valid Solana wallet", async () => {
    await expect(
      verifyCherryLaunch(
        "signed.jwt",
        config,
        verifier(payload({ sub: "not-a-wallet" })),
        () => NOW
      )
    ).rejects.toMatchObject({
      code: "invalid_cherry_wallet",
      status: 401,
    });
  });

  test("does not call the verifier while integration is unconfigured", async () => {
    let called = false;
    const disabledVerifier: LaunchTokenVerifier = async () => {
      called = true;
      return payload();
    };

    await expect(
      verifyCherryLaunch(
        "signed.jwt",
        { mode: "disabled", reason: "missing config" },
        disabledVerifier,
        () => NOW
      )
    ).rejects.toMatchObject({
      code: "cherry_not_configured",
      status: 503,
    });
    expect(called).toBe(false);
  });

  test("rejects a blank token before calling the SDK verifier", async () => {
    let called = false;
    const trackingVerifier: LaunchTokenVerifier = async () => {
      called = true;
      return payload();
    };

    await expect(
      verifyCherryLaunch("  ", config, trackingVerifier, () => NOW)
    ).rejects.toMatchObject({
      code: "invalid_cherry_launch_token",
      status: 400,
    });
    expect(called).toBe(false);
  });

  test("passes the exact app, origin, and JWKS contract to the SDK", async () => {
    const calls: Array<Parameters<LaunchTokenVerifier>> = [];
    const trackingVerifier: LaunchTokenVerifier = async (...args) => {
      calls.push(args);
      return payload();
    };

    await verifyCherryLaunch(
      "  signed.jwt  ",
      config,
      trackingVerifier,
      () => NOW
    );

    expect(calls).toEqual([
      [
        "signed.jwt",
        {
          expectedAppId: "miniapp_123",
          expectedOrigin: "https://askloyal.com",
          jwksUrl: "https://chat.cherry.fun/.well-known/jwks.json",
        },
      ],
    ]);
  });

  test.each([
    ["missing room", { room_id: "" }],
    ["blank room", { room_id: "  " }],
    ["missing token id", { jti: "" }],
    ["blank token id", { jti: "  " }],
    ["non-integer issued-at", { iat: 1_000.5 }],
    ["non-integer expiry", { exp: 1_300.5 }],
    ["non-positive issued-at", { iat: 0 }],
    ["expiry before issued-at", { exp: 999 }],
    ["lifetime longer than five minutes", { exp: 1_301 }],
    ["expired context", { exp: NOW }],
    ["issued too far in the future", { iat: NOW + 61, exp: NOW + 300 }],
  ])("rejects %s", async (_label, overrides) => {
    await expect(
      verifyCherryLaunch(
        "signed.jwt",
        config,
        verifier(payload(overrides)),
        () => NOW
      )
    ).rejects.toMatchObject({
      code: "invalid_cherry_context",
      status: 401,
    });
  });

  test("maps any SDK verification failure to a non-sensitive error", async () => {
    const failingVerifier: LaunchTokenVerifier = async () => {
      throw new Error("sensitive upstream token detail");
    };

    await expect(
      verifyCherryLaunch("signed.jwt", config, failingVerifier, () => NOW)
    ).rejects.toEqual(
      new CherryLaunchTokenError("Cherry launch token could not be verified.", {
        code: "invalid_cherry_launch_token",
        status: 401,
      })
    );
  });
});
