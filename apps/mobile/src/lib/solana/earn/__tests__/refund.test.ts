import { PublicKey } from "@solana/web3.js";

jest.mock("rpc-websockets", () => ({
  CommonClient: class CommonClient {},
  WebSocket: jest.fn(),
}));

const fetchEarnState = jest.fn();
const fetchEarnAutodepositState = jest.fn();
const fetchEarnRefundCandidates = jest.fn();
const fetchEarnVaultRefundSnapshot = jest.fn();

jest.mock(
  "@loyal-labs/actions",
  () => ({
    normalizeLoyalCluster: (cluster: string) => cluster,
    SUBSCRIPTIONS_PROGRAM_ID: PublicKey.default,
    subscriptionRevokeDelegationData: () => new Uint8Array([1]),
  }),
  { virtual: true }
);

jest.mock(
  "@loyal-labs/smart-account-vaults",
  () => ({
    createSmartAccountVaultsClient: () => ({
      fetchEarnRefundCandidates,
      fetchEarnVaultRefundSnapshot,
    }),
  }),
  { virtual: true }
);

jest.mock("@/lib/solana/rpc/connection", () => ({
  getConnection: () => ({ rpc: true }),
}));

jest.mock("../earn-api", () => ({
  fetchEarnAutodepositState,
  fetchEarnState,
}));

jest.mock("../send-prepared", () => ({
  signAndSendPreparedOperations: jest.fn(),
}));

// eslint-disable-next-line import/first
import { scanEarnRefunds } from "../refund";

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const wallet = key(1);
const settings = key(2);
const vault = key(3);
const routePolicy = key(4);
const stalePolicy = key(5);
const autoswapPolicy = key(6);
const activeDelegation = key(7);
const staleDelegation = key(8);

function policy(account: PublicKey) {
  return {
    account,
    accountIndex: 1,
    lamports: 9_000_000,
    seed: BigInt(1),
    state: "ProgramInteraction",
  };
}

function delegation(account: PublicKey) {
  return {
    account,
    amountPerPeriodRaw: BigInt(1),
    authority: wallet,
    delegatee: vault,
    delegator: wallet,
    lamports: 2_000_000,
    mint: key(9),
  };
}

describe("scanEarnRefunds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchEarnState.mockResolvedValue({
      autoswapPolicyAccounts: [autoswapPolicy.toBase58()],
      autoswapStateAuthoritative: true,
      cluster: "mainnet-beta",
      position: null,
      programId: PublicKey.default.toBase58(),
      protectedPolicyAccounts: [routePolicy.toBase58()],
      settingsPda: settings.toBase58(),
      smartAccountAddress: vault.toBase58(),
    });
    fetchEarnAutodepositState.mockResolvedValue({
      autodeposit: {
        policyAccount: null,
        recurringDelegation: activeDelegation.toBase58(),
      },
    });
    fetchEarnRefundCandidates.mockResolvedValue({
      policies: [
        policy(routePolicy),
        policy(stalePolicy),
        policy(autoswapPolicy),
      ],
      recurringDelegations: [
        delegation(activeDelegation),
        delegation(staleDelegation),
      ],
      vaultPda: vault,
    });
    fetchEarnVaultRefundSnapshot.mockResolvedValue({
      lamports: BigInt(1_000_000),
      observedSlot: 1,
      tokenAccounts: [],
      vaultPda: vault,
      vaultUsdcAta: key(10),
    });
  });

  test("preserves active route, Autoswap, and Autodeposit accounts", async () => {
    const result = await scanEarnRefunds(wallet.toBase58());

    expect(
      result.scan?.policies.find(
        (candidate) => candidate.account === stalePolicy.toBase58()
      )?.canRefund
    ).toBe(true);
    expect(
      result.scan?.policies.find(
        (candidate) => candidate.account === routePolicy.toBase58()
      )?.blockedReason
    ).toBe("Active Earn vault policy");
    expect(
      result.scan?.policies.find(
        (candidate) => candidate.account === autoswapPolicy.toBase58()
      )?.blockedReason
    ).toBe("Active Autoswap policy");
    expect(
      result.scan?.recurringDelegations.find(
        (candidate) => candidate.account === activeDelegation.toBase58()
      )?.canRefund
    ).toBe(false);
    expect(
      result.scan?.recurringDelegations.find(
        (candidate) => candidate.account === staleDelegation.toBase58()
      )?.canRefund
    ).toBe(true);
  });

  test("fails closed while Autoswap projection is ambiguous", async () => {
    fetchEarnState.mockResolvedValueOnce({
      ...(await fetchEarnState(wallet.toBase58())),
      autoswapStateAuthoritative: false,
    });

    const result = await scanEarnRefunds(wallet.toBase58());

    expect(
      result.scan?.policies.every((candidate) => !candidate.canRefund)
    ).toBe(true);
    expect(
      result.scan?.recurringDelegations.every(
        (candidate) => !candidate.canRefund
      )
    ).toBe(true);
    expect(result.scan?.vault?.canRefund).toBe(false);
  });
});
