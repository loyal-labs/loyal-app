// Protects the Autodeposit lifecycle boundary behind ASK-1859. A wallet
// decline before any chain write is a clean cancellation. Setup and close are
// projected from chain, so neither may request a second backend-confirm auth.

const mockTrack = jest.fn();
const mockFetchState = jest.fn();
const mockToggleAutodeposit = jest.fn();
const mockSignEarnAuth = jest.fn();
const mockWithEarnAuth = jest.fn();
const mockGetSessionToken = jest.fn();
const mockClearSession = jest.fn();
const mockPrepareClose = jest.fn();
const mockPrepareSetupBatch = jest.fn();
const mockSendPreparedOperation = jest.fn();
const mockSendPreparedOperations = jest.fn();
const mockUpdateFloor = jest.fn();

jest.mock("expo-updates", () => ({
  channel: "production",
  runtimeVersion: "1.0.0",
  updateId: undefined,
}));
jest.mock("@/config/env", () => ({
  env: { earnApiBaseUrl: "https://example.test" },
}));
jest.mock(
  "@loyal-labs/actions",
  () => ({
    normalizeLoyalCluster: (cluster: unknown) => cluster,
  }),
  { virtual: true },
);
jest.mock(
  "@loyal-labs/smart-account-vaults",
  () => ({
    createSmartAccountVaultsClient: () => ({
      prepareEarnUsdcAutodepositClose: (...args: unknown[]) =>
        mockPrepareClose(...args),
      prepareEarnUsdcAutodepositSetupBatch: (...args: unknown[]) =>
        mockPrepareSetupBatch(...args),
    }),
  }),
  { virtual: true },
);
jest.mock("@solana/web3.js", () => ({
  PublicKey: class PublicKey {
    constructor(private readonly value: string) {}
    toBase58() {
      return this.value;
    }
  },
}));
jest.mock("@/lib/analytics/analytics", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));
jest.mock("@/lib/analytics/earn-events", () => ({
  EARN_EVENTS: {
    autodepositDisabled: "autodeposit_disabled",
    autodepositEnabled: "autodeposit_enabled",
  },
}));
jest.mock("@/lib/solana/rpc/connection", () => ({
  getConnection: () => ({}),
}));
jest.mock("../earn-api", () => {
  class EarnApiError extends Error {
    constructor(message: string, readonly code?: string) {
      super(message);
    }
  }
  return {
    EarnApiError,
    fetchEarnAutodepositState: (...args: unknown[]) => mockFetchState(...args),
    requestEarnAutodepositSweepExecute: jest.fn(),
    toggleEarnAutodeposit: (...args: unknown[]) =>
      mockToggleAutodeposit(...args),
    updateEarnAutodepositFloor: (...args: unknown[]) =>
      mockUpdateFloor(...args),
  };
});
jest.mock("../earn-auth", () => ({
  signEarnAuth: (...args: unknown[]) => mockSignEarnAuth(...args),
  withEarnAuth: (...args: unknown[]) => mockWithEarnAuth(...args),
}));
jest.mock("../earn-session", () => ({
  clearEarnSession: (...args: unknown[]) => mockClearSession(...args),
  getEarnSessionToken: (...args: unknown[]) => mockGetSessionToken(...args),
}));
jest.mock("../send-prepared", () => ({
  signAndSendPreparedOperation: (...args: unknown[]) =>
    mockSendPreparedOperation(...args),
  signAndSendPreparedOperations: (...args: unknown[]) =>
    mockSendPreparedOperations(...args),
}));
jest.mock("../wire", () => ({
  serializePreparedEarnAutodepositClose: () => ({ serialized: true }),
  serializePreparedEarnAutodepositSetup: jest.fn(),
}));

// eslint-disable-next-line import/first
import {
  executeEarnAutodepositClose,
  executeEarnAutodepositSetup,
  setEarnAutodepositActive,
} from "../autodeposit";
// eslint-disable-next-line import/first
import { WalletRejectedError } from "@/lib/wallet/rejection";

type Envelope = {
  errorCode?: string;
  flowName: string;
  flowVariant: string;
  outcome: string;
  stage: string;
};

const walletAddress = "11111111111111111111111111111111";
const signer = {
  kind: "mwa" as const,
  publicKey: { toBase58: () => walletAddress },
  signAllTransactions: jest.fn(),
  signMessage: jest.fn(),
  signTransaction: jest.fn(),
} as unknown as Parameters<typeof setEarnAutodepositActive>[0]["signer"];

function captureEnvelopes(): Envelope[] {
  const envelopes: Envelope[] = [];
  global.fetch = jest.fn(async (_url: unknown, init: unknown) => {
    envelopes.push(JSON.parse((init as { body: string }).body) as Envelope);
    return { ok: true, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
  return envelopes;
}

function terminal(envelopes: Envelope[]): Envelope[] {
  return envelopes.filter(
    ({ outcome }) => outcome === "cancelled" || outcome === "failed",
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSessionToken.mockResolvedValue(null);
  mockFetchState.mockResolvedValue({
    prepareContext: {
      cluster: "mainnet",
      policySigner: "policy-signer",
      programId: "program-id",
    },
    settingsPda: "settings-pda",
  });
  mockPrepareClose.mockResolvedValue({ prepared: { instructions: [] } });
  mockSendPreparedOperation.mockResolvedValue({
    confirmedSlot: "42",
    signature: "landed-close-signature",
  });
  mockSendPreparedOperations.mockResolvedValue([
    { confirmedSlot: "41", signature: "policy-signature" },
    { confirmedSlot: "42", signature: "delegation-signature" },
  ]);
  mockSignEarnAuth.mockResolvedValue({ walletAddress });
  mockUpdateFloor.mockResolvedValue(undefined);
});

describe("Autodeposit transaction ordering", () => {
  it("confirms policy creation before broadcasting its dependent delegation", async () => {
    mockPrepareSetupBatch.mockResolvedValue([
      {
        nativeSolRequirement: { requiredLamports: "0" },
        persistence: { policySeed: "3" },
        policy: { seed: BigInt(3) },
        prepared: { instructions: ["create-policy"] },
        stage: "create_policy",
      },
      {
        nativeSolRequirement: { requiredLamports: "0" },
        persistence: {
          policyAccount: "policy-3",
          policySeed: "3",
          recurringDelegation: "delegation-3",
        },
        policy: { seed: BigInt(3) },
        prepared: { instructions: ["create-delegation"] },
        stage: "create_recurring_delegation",
      },
    ]);

    await expect(
      executeEarnAutodepositSetup({ signer, thresholdUsd: 10 }),
    ).resolves.toMatchObject({
      policyAccount: "policy-3",
      recurringDelegation: "delegation-3",
    });

    expect(mockSendPreparedOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        operations: [
          { instructions: ["create-policy"] },
          { instructions: ["create-delegation"] },
        ],
        sendMode: "confirm-each",
      }),
    );
  });
});

describe("Autodeposit wallet rejection lifecycle", () => {
  it("reports the exact resume auth rejection as cancelled without calling the backend", async () => {
    const envelopes = captureEnvelopes();
    const rejection = new WalletRejectedError();
    mockSignEarnAuth.mockRejectedValueOnce(rejection);

    await expect(
      setEarnAutodepositActive({
        active: true,
        policyAccount: "policy",
        recurringDelegation: "delegation",
        signer,
        vaultIndex: 1,
      }),
    ).rejects.toBe(rejection);

    expect(mockToggleAutodeposit).not.toHaveBeenCalled();
    expect(terminal(envelopes)).toEqual([
      expect.objectContaining({
        errorCode: "wallet_rejected",
        flowName: "earn.autodeposit.configuration",
        flowVariant: "resume",
        outcome: "cancelled",
        stage: "backend_confirm",
      }),
    ]);
  });

  it("keeps a pre-submit close rejection as a clean cancellation", async () => {
    const envelopes = captureEnvelopes();
    const rejection = new WalletRejectedError();
    mockSendPreparedOperation.mockRejectedValueOnce(rejection);

    await expect(
      executeEarnAutodepositClose({
        policy: "policy",
        recurringDelegation: "delegation",
        signer,
      }),
    ).rejects.toBe(rejection);

    expect(mockSignEarnAuth).not.toHaveBeenCalled();
    expect(terminal(envelopes)).toEqual([
      expect.objectContaining({
        errorCode: "wallet_rejected",
        flowName: "earn.autodeposit.configuration",
        flowVariant: "close",
        outcome: "cancelled",
        stage: "wallet_approval",
      }),
    ]);
  });

  it("finishes a confirmed close without requesting backend-confirm auth", async () => {
    const envelopes = captureEnvelopes();
    await executeEarnAutodepositClose({
      policy: "policy",
      recurringDelegation: "delegation",
      signer,
    });

    expect(mockSignEarnAuth).not.toHaveBeenCalled();
    expect(terminal(envelopes)).toEqual([]);
    expect(envelopes).toContainEqual(
      expect.objectContaining({
        flowName: "earn.autodeposit.configuration",
        flowVariant: "close",
        outcome: "observed",
        stage: "chain_confirm",
      }),
    );
  });

  it("polls through each stale closed row before closing a duplicate", async () => {
    jest.useFakeTimers();
    mockFetchState
      .mockReset()
      .mockResolvedValueOnce({
        prepareContext: {
          cluster: "mainnet",
          policySigner: "policy-signer",
          programId: "program-id",
        },
        settingsPda: "settings-pda",
      })
      .mockResolvedValueOnce({
        autodeposit: {
          policyAccount: "policy",
          recurringDelegation: "delegation",
        },
      })
      .mockResolvedValueOnce({
        autodeposit: {
          policyAccount: "duplicate-policy",
          recurringDelegation: "duplicate-delegation",
        },
      })
      .mockResolvedValueOnce({
        autodeposit: {
          policyAccount: "duplicate-policy",
          recurringDelegation: "duplicate-delegation",
        },
      })
      .mockResolvedValueOnce({ autodeposit: null });

    const closePromise = executeEarnAutodepositClose({
      policy: "policy",
      recurringDelegation: "delegation",
      signer,
    });
    await jest.runAllTimersAsync();
    const result = await closePromise;
    jest.useRealTimers();

    expect(result.policyAccounts).toEqual(["policy", "duplicate-policy"]);
    expect(mockPrepareClose).toHaveBeenCalledTimes(2);
    expect(mockSendPreparedOperation).toHaveBeenCalledTimes(2);
  });
});
