import { createHmac } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { PROGRAM_ADDRESS, pda } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey } from "@solana/web3.js";

import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";

mock.module("server-only", () => ({}));

const { issueEarnRealtimeToken } = await import("./token.server");

const principal: AuthenticatedPrincipal = {
  authMethod: "wallet",
  provider: "solana",
  settingsPda: "SysvarRent111111111111111111111111111111111",
  smartAccountAddress: "SysvarC1ock11111111111111111111111111111111",
  subjectAddress: "11111111111111111111111111111111",
  walletAddress: "11111111111111111111111111111111",
};
const secret = "test-realtime-secret-that-is-at-least-32-bytes";

describe("Earn realtime token contract", () => {
  test("signs routing-compatible claims from the authenticated identity", () => {
    const issued = issueEarnRealtimeToken({
      authSecret: secret,
      now: new Date("2026-07-14T00:00:00.000Z"),
      principal,
      programId: PROGRAM_ADDRESS,
      solanaEnv: "mainnet",
    });
    const [payload, signature] = issued.accessToken.split(".");
    const claims = JSON.parse(
      Buffer.from(payload as string, "base64url").toString("utf8")
    );
    const expectedVault = pda
      .getSmartAccountPda({
        accountIndex: 1,
        programId: new PublicKey(PROGRAM_ADDRESS),
        settingsPda: new PublicKey(principal.settingsPda),
      })[0]
      .toBase58();

    expect(signature).toBe(
      createHmac("sha256", secret)
        .update(payload as string)
        .digest("base64url")
    );
    expect(claims).toEqual({
      aud: "loyal-yield-realtime",
      clientKind: "web",
      earnVaultAddress: expectedVault,
      exp: 1_783_987_500,
      iat: 1_783_987_200,
      iss: "loyal-apps",
      scopes: ["autodeposit", "earn"],
      settingsPda: principal.settingsPda,
      solanaEnv: "mainnet-beta",
      v: 1,
      walletAddress: principal.walletAddress,
    });
  });

  test("rejects unsupported clusters and undersized secrets before minting", () => {
    expect(() =>
      issueEarnRealtimeToken({
        authSecret: "too-short",
        principal,
        programId: PROGRAM_ADDRESS,
        solanaEnv: "devnet",
      })
    ).toThrow("secret is invalid");
    expect(() =>
      issueEarnRealtimeToken({
        authSecret: secret,
        principal,
        programId: PROGRAM_ADDRESS,
        solanaEnv: "localnet",
      })
    ).toThrow("unavailable on localnet");
  });
});
