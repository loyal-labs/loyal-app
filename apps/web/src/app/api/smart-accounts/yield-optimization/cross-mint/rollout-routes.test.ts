import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const WALLET = "11111111111111111111111111111111";
const principal = {
  authMethod: "wallet" as const,
  provider: "solana" as const,
  settingsPda: "11111111111111111111111111111112",
  smartAccountAddress: "11111111111111111111111111111113",
  subjectAddress: WALLET,
  walletAddress: WALLET,
};
let currentPrincipal: typeof principal | null = principal;
const originalRollout = process.env.EARN_AUTOSWAP_ENABLED_WALLETS;

mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () => currentPrincipal,
}));

const { POST: prepare } = await import("./policies/prepare/route");
const { POST: confirm } = await import("./policies/confirm/route");

function request(path: string) {
  return new Request(`https://loyal.local/${path}`, {
    body: JSON.stringify({}),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("Autoswap setup rollout routes", () => {
  beforeEach(() => {
    currentPrincipal = principal;
    delete process.env.EARN_AUTOSWAP_ENABLED_WALLETS;
  });

  afterAll(() => {
    if (originalRollout === undefined) {
      delete process.env.EARN_AUTOSWAP_ENABLED_WALLETS;
    } else {
      process.env.EARN_AUTOSWAP_ENABLED_WALLETS = originalRollout;
    }
  });

  test("both setup stages fail closed before constructing policy work", async () => {
    const [prepareResponse, confirmResponse] = await Promise.all([
      prepare(request("prepare")),
      confirm(request("confirm")),
    ]);

    expect(prepareResponse.status).toBe(404);
    expect(confirmResponse.status).toBe(404);
    await expect(prepareResponse.json()).resolves.toMatchObject({
      error: { code: "autoswap_unavailable" },
    });
    await expect(confirmResponse.json()).resolves.toMatchObject({
      error: { code: "autoswap_unavailable" },
    });
  });

  test("both setup stages reject invalid rollout configuration", async () => {
    process.env.EARN_AUTOSWAP_ENABLED_WALLETS = `${WALLET},${WALLET}`;

    const [prepareResponse, confirmResponse] = await Promise.all([
      prepare(request("prepare")),
      confirm(request("confirm")),
    ]);

    expect(prepareResponse.status).toBe(503);
    expect(confirmResponse.status).toBe(503);
  });

  test("authentication is required before rollout evaluation", async () => {
    currentPrincipal = null;
    process.env.EARN_AUTOSWAP_ENABLED_WALLETS = "not-a-wallet";

    const [prepareResponse, confirmResponse] = await Promise.all([
      prepare(request("prepare")),
      confirm(request("confirm")),
    ]);

    expect(prepareResponse.status).toBe(401);
    expect(confirmResponse.status).toBe(401);
  });
});
