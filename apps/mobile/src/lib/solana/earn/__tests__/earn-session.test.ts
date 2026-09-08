const mockEnv = {
  earnApiBaseUrl: "https://askloyal.com",
  solanaEnv: "mainnet",
};
const mockGet = jest.fn();
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockDelete = jest.fn().mockResolvedValue(undefined);
const mockMint = jest.fn();
jest.mock("@/config/env", () => ({ env: mockEnv }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: mockGet,
  setItemAsync: mockSet,
  deleteItemAsync: mockDelete,
}));
jest.mock("../earn-api", () => ({ mintEarnSession: mockMint }));
let session: typeof import("../earn-session");
const auth = {
  walletAddress: "wallet",
  signature: "signed-auth",
  issuedAt: "2026-01-01",
};
const expiresAt = "2099-01-01T00:00:00.000Z";
beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  mockGet.mockResolvedValue(null);
  mockMint.mockResolvedValue({ token: "renewed", expiresAt });
  mockEnv.earnApiBaseUrl = "https://askloyal.com";
  mockEnv.solanaEnv = "mainnet";
  session = await import("../earn-session");
});

test("OTA reuses production approval but never sends an unscoped legacy bearer to another origin or cluster", async () => {
  mockGet.mockResolvedValue(
    JSON.stringify({ walletAddress: "wallet", token: "legacy", expiresAt })
  );
  expect(await session.getEarnSessionToken("wallet")).toBe("legacy");
  expect(await session.getEarnSessionToken("other-wallet")).toBeNull();
  mockEnv.earnApiBaseUrl = "http://localhost:3000";
  expect(await session.getEarnSessionToken("wallet")).toBeNull();
  mockEnv.earnApiBaseUrl = "https://askloyal.com";
  mockEnv.solanaEnv = "devnet";
  expect(await session.getEarnSessionToken("wallet")).toBeNull();
});

test("a delayed rejection of an old bearer cannot delete the renewed session", async () => {
  mockGet.mockResolvedValue(
    JSON.stringify({ walletAddress: "wallet", token: "old", expiresAt })
  );
  await session.clearEarnSession("old");
  await session.maybeMintEarnSession(auth);
  await session.clearEarnSession("old");
  expect(await session.getEarnSessionToken("wallet")).toBe("renewed");
  expect(mockDelete).toHaveBeenCalledTimes(1);
});

test("clearing auth while a mint is in flight prevents that old mint from restoring a credential", async () => {
  let resolveMint!: (value: { token: string; expiresAt: string }) => void;
  mockMint.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveMint = resolve;
      })
  );
  const mint = session.maybeMintEarnSession(auth);
  while (!resolveMint) await Promise.resolve();
  await session.clearEarnSession();
  resolveMint({ token: "stale", expiresAt });
  await mint;
  expect(await session.getEarnSessionToken("wallet")).toBeNull();
  expect(mockSet).not.toHaveBeenCalled();
});
