// Protects the Autodeposit lifecycle boundary behind ASK-1859. A wallet
// decline before any chain write is a clean cancellation, while a second
// auth-prompt decline after a close transaction lands is a real
// confirmed-but-unrecorded failure that must keep paging.

const mockTrack = jest.fn();
const mockFetchState = jest.fn();
const mockToggleAutodeposit = jest.fn();
const mockConfirmClose = jest.fn();
const mockSignEarnAuth = jest.fn();
const mockWithEarnAuth = jest.fn();
const mockGetSessionToken = jest.fn();
const mockClearSession = jest.fn();
const mockPrepareClose = jest.fn();
const mockSendPreparedOperation = jest.fn();

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
    confirmEarnAutodepositClose: (...args: unknown[]) =>
      mockConfirmClose(...args),
    confirmEarnAutodepositSetup: jest.fn(),
    fetchEarnAutodepositState: (...args: unknown[]) => mockFetchState(...args),
    requestEarnAutodepositSweepExecute: jest.fn(),
    toggleEarnAutodeposit: (...args: unknown[]) =>
      mockToggleAutodeposit(...args),
    updateEarnAutodepositFloor: jest.fn(),
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
  signAndSendPreparedOperations: jest.fn(),
}));
jest.mock("../wire", () => ({
  serializePreparedEarnAutodepositClose: () => ({ serialized: true }),
  serializePreparedEarnAutodepositSetup: jest.fn(),
}));

// eslint-disable-next-line import/first
import {
  executeEarnAutodepositClose,
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
    expect(mockConfirmClose).not.toHaveBeenCalled();
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

  it("keeps a post-submit close auth rejection failed at backend_confirm", async () => {
    const envelopes = captureEnvelopes();
    mockSignEarnAuth.mockRejectedValueOnce(new WalletRejectedError());

    let thrown: unknown;
    try {
      await executeEarnAutodepositClose({
        policy: "policy",
        recurringDelegation: "delegation",
        signer,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(WalletRejectedError);
    expect((thrown as WalletRejectedError).landedSignatures).toEqual([
      "landed-close-signature",
    ]);
    expect(mockConfirmClose).not.toHaveBeenCalled();
    expect(terminal(envelopes)).toEqual([
      expect.objectContaining({
        errorCode: "wallet_rejected",
        flowName: "earn.autodeposit.configuration",
        flowVariant: "close",
        outcome: "failed",
        stage: "backend_confirm",
      }),
    ]);
  });

  it("carries post-submit close progress into a parent withdrawal flow", async () => {
    captureEnvelopes();
    mockSignEarnAuth.mockRejectedValueOnce(new WalletRejectedError());

    let thrown: unknown;
    try {
      await executeEarnAutodepositClose({
        policy: "policy",
        recurringDelegation: "delegation",
        signer,
        source: "withdraw",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(WalletRejectedError);
    expect((thrown as WalletRejectedError).landedSignatures).toEqual([
      "landed-close-signature",
    ]);
    expect(mockConfirmClose).not.toHaveBeenCalled();
  });
});
