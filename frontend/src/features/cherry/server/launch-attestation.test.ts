import { describe, expect, test } from "bun:test";

import type { CherryMiniAppConfig } from "@/features/cherry/config";

import { CherryLaunchTokenError } from "./launch-token";
import {
  attestCherryLaunch,
  type CherryLaunchAttestationDependencies,
} from "./launch-attestation";

const ORIGIN = "https://askloyal.com";
const config: CherryMiniAppConfig = {
  mode: "enabled",
  appId: "miniapp_123",
  expectedOrigin: ORIGIN,
  issuer: "https://chat.cherry.fun",
  jwksUrl: "https://chat.cherry.fun/.well-known/jwks.json",
};

function launchRequest(body: unknown, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}/api/cherry/launch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
  });
}

function dependencies(
  verifyLaunch: CherryLaunchAttestationDependencies["verifyLaunch"]
): CherryLaunchAttestationDependencies {
  return {
    getConfig: () => config,
    verifyLaunch,
  };
}

describe("attestCherryLaunch", () => {
  test("rejects cross-origin callers before token verification", async () => {
    let verifierCalled = false;
    const response = await attestCherryLaunch(
      launchRequest(
        { launchToken: "sensitive.jwt" },
        "https://attacker.example"
      ),
      dependencies(async () => {
        verifierCalled = true;
        throw new Error("must not run");
      })
    );

    expect(response.status).toBe(403);
    expect(verifierCalled).toBe(false);
  });

  test("returns only minimum verified launch context without a cookie", async () => {
    const response = await attestCherryLaunch(
      launchRequest({ launchToken: "sensitive.jwt" }),
      dependencies(async (token, receivedConfig) => {
        expect(token).toBe("sensitive.jwt");
        expect(receivedConfig).toBe(config);
        return {
          walletAddress: "11111111111111111111111111111111",
          roomId: "room_123",
          tokenId: "must-not-leak-jti",
          issuedAt: 1_000,
          expiresAt: 1_300,
        };
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(body).toEqual({
      walletAddress: "11111111111111111111111111111111",
      roomId: "room_123",
      issuedAt: 1_000,
      expiresAt: 1_300,
    });
    expect(JSON.stringify(body)).not.toContain("sensitive.jwt");
    expect(JSON.stringify(body)).not.toContain("must-not-leak-jti");
  });

  test("sanitizes token verification failures", async () => {
    const response = await attestCherryLaunch(
      launchRequest({ launchToken: "sensitive.jwt" }),
      dependencies(async () => {
        throw new CherryLaunchTokenError("sensitive upstream detail", {
          code: "invalid_cherry_launch_token",
          status: 401,
        });
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: "invalid_cherry_launch_token",
        message: "Cherry launch could not be verified.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("sensitive upstream detail");
    expect(JSON.stringify(body)).not.toContain("sensitive.jwt");
  });

  test("rejects malformed input without calling the verifier", async () => {
    let verifierCalled = false;
    const response = await attestCherryLaunch(
      launchRequest({ launchToken: 123 }),
      dependencies(async () => {
        verifierCalled = true;
        throw new Error("must not run");
      })
    );

    expect(response.status).toBe(400);
    expect(verifierCalled).toBe(false);
  });
});
