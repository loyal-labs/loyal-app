import assert from "node:assert/strict";
import { mock } from "bun:test";

let authenticated = true;
let cookieWallet: string | null = null;
let controls = true;
let reads = 0;
let accountExists = true;

let cluster = "mainnet";
const settings = "canonical-settings";
mock.module("server-only", () => ({}));
mock.module("@/features/identity/server/mobile-earn-session", () => ({
  authenticateMobileEarnRequest: async () => {
    if (!authenticated)
      throw new WalletAuthError("denied", {
        code: "invalid_mobile_session",
        status: 401,
      });
    return { walletAddress: "authenticated-wallet" };
  },
}));
mock.module("@/features/chat/server/app-user", () => ({
  findCurrentUser: async () => ({ id: "user" }),
}));
mock.module("@/features/smart-accounts/server/service", () => ({
  findReadyCurrentUserSmartAccount: async () =>
    accountExists
      ? {
          settingsPda: settings,
          smartAccountAddress: "canonical-account",
        }
      : null,
  assertAuthenticatedWalletControlsSettings: async () => {
    if (!controls) throw new Error("ownership changed");
  },
  isSmartAccountProvisioningError: () => false,
}));
mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({
    solanaEnv: cluster,
    loyalSmartAccounts: { programId: "program" },
  }),
}));
mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () =>
    cookieWallet ? { walletAddress: cookieWallet } : null,
}));
mock.module("@/features/earn-max/voltr/summary.server", () => ({
  readEarnMaxVoltrSummary: async (address: string) => {
    assert.equal(address, settings);
    reads++;
    return null;
  },
  readEarnMaxVoltrActivity: async (address: string) => {
    assert.equal(address, settings);
    reads++;
    return { operations: [], performance: [] };
  },
}));
const { WalletAuthError } = await import(
  "../src/features/identity/server/wallet-auth-errors"
);
const { POST, GET } = await import(
  "../src/app/api/smart-accounts/mobile/earn-max/route"
);
const call = (action: string, signed = true) =>
  POST(
    new Request("https://example.com/api/smart-accounts/mobile/earn-max", {
      method: "POST",
      headers: signed ? { authorization: "Bearer test" } : {},
      body: JSON.stringify({
        action,
        settingsPda: "attacker-settings",
        walletAddress: "attacker-wallet",
      }),
    })
  );

authenticated = false;
assert.equal((await call("summary")).status, 401);
assert.equal(reads, 0);
assert.equal((await call("summary", false)).status, 401);
cookieWallet = "different-wallet";
assert.equal((await call("summary", false)).status, 401);
assert.equal(reads, 0);
cookieWallet = "attacker-wallet";
assert.equal((await call("summary", false)).status, 200);
assert.equal(reads, 1);
reads = 0;
authenticated = true;
for (const action of ["summary", "activity", "context"])
  assert.equal((await call(action)).status, 200);
assert.equal(reads, 2);
reads = 0;
assert.equal((await call("redeem")).status, 400);
const context = await (await call("context")).json();
assert.equal(context.settingsPda, settings);
assert.equal(context.walletAddress, "authenticated-wallet");
controls = false;
assert.equal((await call("summary")).status, 500);
assert.equal(reads, 0);
controls = true;
cluster = "devnet";
assert.equal((await call("context")).status, 409);
assert.equal(reads, 0);
console.log(
  "Mobile Earn MAX session/signature auth, invite-free access, ownership and cluster checks passed (offline)."
);

cluster = "mainnet";
authenticated = false;
cookieWallet = null;
const publicRead = (
  action: string,
  wallet = "11111111111111111111111111111111"
) =>
  GET(
    new Request(
      `https://example.com/api/smart-accounts/mobile/earn-max?action=${action}&walletAddress=${wallet}&settingsPda=attacker-settings`
    )
  );
for (const action of ["context", "deposit", "claim"])
  assert.equal((await publicRead(action)).status, 400);
assert.equal((await publicRead("summary", "invalid")).status, 400);
assert.equal(reads, 0);
for (const action of ["summary", "activity"]) {
  const response = await publicRead(action);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
}
assert.equal(reads, 2);
accountExists = false;
assert.equal((await (await publicRead("summary")).json()).summary, null);
assert.deepEqual((await (await publicRead("activity")).json()).operations, []);
assert.equal(
  reads,
  2,
  "wallets without accounts must not trigger chain reads or provisioning"
);
accountExists = true;
controls = false;
assert.equal((await publicRead("summary")).status, 502);
assert.equal(reads, 2);
controls = true;
cluster = "devnet";
assert.equal((await publicRead("summary")).status, 409);
assert.equal(reads, 2);
console.log(
  "Passive Earn MAX reads need no session; context remains authenticated (offline)."
);
