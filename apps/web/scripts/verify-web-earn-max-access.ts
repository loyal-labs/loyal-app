import assert from "node:assert/strict";
import { mock } from "bun:test";
import { PublicKey, type Connection } from "@solana/web3.js";

let signedIn = true;
let ownsAccount = true;
let reads = 0;
let inviteReads = 0;
const settings = "canonical-settings";
mock.module("server-only", () => ({}));
mock.module("@/features/identity/server/auth-session", () => ({
  resolveAuthenticatedPrincipalFromRequest: async () =>
    signedIn
      ? {
          settingsPda: settings,
          smartAccountAddress: "canonical-account",
          walletAddress: "signed-in-wallet",
        }
      : null,
}));
mock.module("@/features/smart-accounts/server/service", () => ({
  assertAuthenticatedWalletControlsSettings: async () => {
    if (!ownsAccount) throw new Error("ownership refused");
  },
}));
mock.module("@/lib/core/config/server", () => ({
  getServerEnv: () => ({ loyalSmartAccounts: { programId: "program" } }),
}));
mock.module("@/lib/yield-optimization/deployment-policy-signer.server", () => ({
  getDeploymentPolicySignerPublicKey: () => {
    throw new Error("legacy signer reached");
  },
}));
mock.module("@/features/earn-max/server/invite.server", () => ({
  hasRedeemedInvite: async () => {
    inviteReads++;
    return false;
  },
  redeemInvite: async () => {
    throw new Error("redemption reached");
  },
}));
mock.module("@/features/earn-max/server/repository.server", () => ({
  readEarnMaxActivity: async () => {
    throw new Error("legacy activity reached");
  },
  readEarnMaxSummary: async () => {
    throw new Error("legacy summary reached");
  },
}));
mock.module("@/features/earn-max/voltr/summary.server", () => ({
  readEarnMaxVoltrSummary: async (account: string) => {
    assert.equal(account, settings);
    reads++;
    return null;
  },
  readEarnMaxVoltrActivity: async (account: string) => {
    assert.equal(account, settings);
    reads++;
    return { operations: [], performance: [] };
  },
}));
const { getSummary, getActivity, getInvite } = await import(
  "../src/features/earn-max/server/service"
);
const request = new Request(
  "https://example.com/api/smart-accounts/earn-max/summary?settingsPda=someone-else"
);
for (const endpoint of [getSummary, getActivity, getInvite]) {
  signedIn = false;
  reads = 0;
  assert.equal((await endpoint(request)).status, 401);
  assert.equal(reads, 0);
  signedIn = true;
  ownsAccount = false;
  await assert.rejects(() => endpoint(request), /ownership refused/);
  assert.equal(reads, 0);
  ownsAccount = true;
  assert.equal((await endpoint(request)).status, 200);
}
assert.equal(inviteReads, 0);
assert.equal((await (await getInvite(request)).json()).redeemed, true);

// Exercise cache eviction and freshness through the reader's RPC boundary.
const { readVoltrHistory } = await import(
  "../src/features/earn-max/voltr/activity.server"
);
let decodedReads = 0;
let newest = "one";
const connection = {
  getSignaturesForAddress: async () => [{ err: null, signature: newest }],
  getParsedTransactions: async () => {
    decodedReads++;
    return [null];
  },
} as unknown as Connection;
const key = (n: number) => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(n, 28);
  return new PublicKey(bytes);
};
await readVoltrHistory(connection, key(1));
await readVoltrHistory(connection, key(2));
await readVoltrHistory(connection, key(1));
assert.equal(decodedReads, 2);
for (let n = 3; n <= 257; n++) await readVoltrHistory(connection, key(n));
assert.equal(decodedReads, 257);
await readVoltrHistory(connection, key(1));
assert.equal(decodedReads, 257, "recent account must remain cached");
await readVoltrHistory(connection, key(2));
assert.equal(decodedReads, 258, "oldest account must be evicted");
newest = "new-deposit";
await readVoltrHistory(connection, key(1));
assert.equal(
  decodedReads,
  259,
  "new on-chain activity must invalidate the cache"
);
console.log(
  "Web Earn MAX: invite-free access, authentication, ownership and bounded history cache checks passed (offline)."
);
