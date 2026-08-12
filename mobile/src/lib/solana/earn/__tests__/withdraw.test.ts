import { PublicKey } from "@solana/web3.js";

// web3.js initializes its WebSocket client eagerly, but these tests only use
// PublicKey. Keep Jest from evaluating rpc-websockets' ESM-only nested uuid.
jest.mock("rpc-websockets", () => ({
  CommonClient: class CommonClient {},
  WebSocket: jest.fn(),
}));

const prepareEarnUsdcWithdraw = jest.fn();
const prepareEarnUsdcCleanup = jest.fn();
const createSmartAccountVaultsClient = jest.fn(() => ({
  prepareEarnUsdcCleanup,
  prepareEarnUsdcWithdraw,
}));
const fetchEarnWithdrawCleanupPrepareContext = jest.fn();
const fetchEarnWithdrawPrepareContext = jest.fn();
const confirmEarnWithdraw = jest.fn();
const confirmEarnWithdrawCleanup = jest.fn();
const signAndSendPreparedOperations = jest.fn();
const observeLifecycle = jest.fn();
const failFromLifecycle = jest.fn();
const prepareEarnWithdrawServer = jest.fn();

// Mirrors the real EarnApiError so withdraw.ts's instanceof/code checks that
// gate cleanup-context retries stay exercised.
class MockEarnApiError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly detail?: string;

  constructor(message: string, code?: string, status?: number, detail?: string) {
    super(message);
    this.name = "EarnApiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

jest.mock(
  "@loyal-labs/actions",
  () => ({
    normalizeLoyalCluster: (cluster: string) => cluster,
  }),
  { virtual: true },
);

// Mirrors the real KaminoUpstreamError; connection-retry.ts instanceof-checks
// it to decide whether a device-prepare failure is worth retrying.
class MockKaminoUpstreamError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "KaminoUpstreamError";
    this.status = status;
  }
}

jest.mock(
  "@loyal-labs/smart-account-vaults",
  () => ({
    createSmartAccountVaultsClient,
    KaminoUpstreamError: MockKaminoUpstreamError,
  }),
  { virtual: true },
);

jest.mock("@/lib/solana/rpc/connection", () => ({
  getConnection: () => ({ rpc: true }),
}));

// Kept inert: the real module pulls expo-updates, and lifecycle telemetry is
// fire-and-forget by contract.
jest.mock("@/services/observability", () => ({
  mapLifecycleErrorCode: () => "unexpected_error",
  startLifecycleFlow: () => ({
    complete: () => {},
    fail: () => {},
    failFrom: failFromLifecycle,
    flowId: "test-flow-id",
    observe: observeLifecycle,
    setVariant: () => {},
    start: () => {},
  }),
}));

jest.mock("../autodeposit", () => ({
  executeEarnAutodepositClose: jest.fn(),
}));

jest.mock("../earn-api", () => ({
  EarnApiError: MockEarnApiError,
  confirmEarnWithdraw,
  confirmEarnWithdrawCleanup,
  // Real connection-retry runs inside these tests; its exhaustion error must
  // keep the real shape (no code, no status, detail carried) so the
  // server-prepare fallback gate in withdraw.ts is exercised for real.
  earnNetworkError: (message: string, detail?: string) =>
    new MockEarnApiError(message, undefined, undefined, detail),
  fetchEarnWithdrawCleanupPrepareContext,
  fetchEarnWithdrawPrepareContext,
  prepareEarnWithdraw: prepareEarnWithdrawServer,
}));

jest.mock("../earn-auth", () => ({
  signEarnAuth: jest.fn(async () => ({
    issuedAt: "2026-07-10T00:00:00.000Z",
    signature: "auth-signature",
    walletAddress: PublicKey.default.toBase58(),
  })),
  withEarnAuth: jest.fn(
    async (
      _signer: unknown,
      auth: unknown,
      _purpose: unknown,
      call: (value: unknown) => unknown,
    ) => call(auth),
  ),
}));

jest.mock("../send-prepared", () => ({
  signAndSendPreparedOperations,
}));

jest.mock("../wire", () => ({
  hydratePreparedOperation: (operation: unknown) => operation,
  serializePreparedEarnUsdcWithdraw: () => ({ wire: "withdraw" }),
}));

// Keep the subject import after mock initialization: this test uses virtual
// workspace-package mocks that cannot be referenced before their declarations.
// eslint-disable-next-line import/first
import { executeEarnWithdraw } from "../withdraw";
// eslint-disable-next-line import/first
import { WalletRejectedError } from "@/lib/wallet/rejection";

const address = PublicKey.default.toBase58();
const withdrawOperation = { operation: "withdraw" };
const cleanupOperation = { operation: "cleanup" };
const signer = { publicKey: PublicKey.default } as never;

function fullFinalExitContext() {
  return {
    cluster: "mainnet-beta",
    programId: address,
    settingsPda: address,
    smartAccountAddress: address,
    withdrawInput: {
      amountRaw: "1000000",
      closePoliciesOnFullWithdrawal: false,
      fullWithdrawalTargets: [
        {
          amountRaw: "1000000",
          liquidityMint: address,
          market: address,
          reserve: address,
          supplyApyBps: null,
        },
      ],
      mode: "full",
      policySigner: address,
      source: {
        amountRaw: "1000000",
        id: address,
        liquidityMint: address,
        market: address,
        reserve: address,
        type: "reserve",
      },
      target: {
        liquidityMint: address,
        market: address,
        reserve: address,
        supplyApyBps: null,
      },
      yieldRoutingPolicy: {
        account: address,
        seed: "1",
      },
    },
  };
}

describe("executeEarnWithdraw", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchEarnWithdrawPrepareContext.mockResolvedValue(fullFinalExitContext());
    fetchEarnWithdrawCleanupPrepareContext.mockResolvedValue({
      cleanupInput: {
        closeVaultCollateralAtas: [],
        idleAmountRaw: "7",
        policySigner: address,
        yieldRoutingPolicy: {
          account: address,
          seed: "1",
          setupPolicy: null,
        },
      },
      cluster: "mainnet-beta",
      programId: address,
      settingsPda: address,
    });
    prepareEarnUsdcWithdraw.mockResolvedValue({
      prepared: withdrawOperation,
      withdrawSteps: [{ prepared: withdrawOperation }],
    });
    prepareEarnUsdcCleanup.mockResolvedValue({
      prepared: cleanupOperation,
    });
    // clearAllMocks does not drain queued mockResolvedValueOnce values; reset
    // so tests that send only the withdraw don't leak a stale cleanup entry.
    signAndSendPreparedOperations.mockReset();
    signAndSendPreparedOperations
      .mockResolvedValueOnce([
        { confirmedSlot: "101", signature: "withdraw-signature" },
      ])
      .mockResolvedValueOnce([
        { confirmedSlot: "102", signature: "cleanup-signature" },
      ]);
  });

  test("defers final-exit cleanup until after the full withdrawal confirms", async () => {
    const result = await executeEarnWithdraw({
      amountUsd: 1,
      mode: "full",
      signer,
    });

    expect(prepareEarnUsdcWithdraw).toHaveBeenCalledWith(
      expect.objectContaining({
        closePoliciesOnFullWithdrawal: false,
        mode: "full",
      }),
    );
    expect(confirmEarnWithdraw).toHaveBeenCalledTimes(1);
    expect(confirmEarnWithdrawCleanup).toHaveBeenCalledWith({
      auth: expect.objectContaining({
        signature: "auth-signature",
        walletAddress: address,
      }),
      cleanupSignature: "cleanup-signature",
      confirmedSlot: "102",
    });
    expect(fetchEarnWithdrawCleanupPrepareContext).toHaveBeenCalledTimes(1);
    expect(fetchEarnWithdrawCleanupPrepareContext).toHaveBeenCalledWith(
      expect.objectContaining({ minContextSlot: "101" }),
    );
    expect(prepareEarnUsdcCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        idleAmountRaw: BigInt(7),
        walletAddress: PublicKey.default,
      }),
    );
    expect(signAndSendPreparedOperations).toHaveBeenCalledTimes(2);
    expect(signAndSendPreparedOperations.mock.calls[1]?.[0]).toMatchObject({
      operations: [cleanupOperation],
    });
    expect(result).toEqual({
      cleanupSignature: "cleanup-signature",
      withdrawalSignatures: ["withdraw-signature"],
    });
  });

  test("returns the landed withdrawal when cleanup fails", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    // Code-less EarnApiError = terminal (e.g. backend without the endpoint):
    // no retry, and the landed withdrawal must still resolve as a success.
    fetchEarnWithdrawCleanupPrepareContext.mockRejectedValue(
      new MockEarnApiError("Failed to prepare Earn account cleanup."),
    );

    const result = await executeEarnWithdraw({
      amountUsd: 1,
      mode: "full",
      signer,
    });

    expect(fetchEarnWithdrawCleanupPrepareContext).toHaveBeenCalledTimes(1);
    expect(signAndSendPreparedOperations).toHaveBeenCalledTimes(1);
    expect(confirmEarnWithdraw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      withdrawalSignatures: ["withdraw-signature"],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test("returns the cleanup signature when cleanup confirm fails", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    // Code-less EarnApiError = terminal (non-EarnApiError failures are treated
    // as network errors and retried; see retryEarnApiCall).
    confirmEarnWithdrawCleanup.mockRejectedValueOnce(
      new MockEarnApiError("Failed to confirm Earn account cleanup."),
    );

    const result = await executeEarnWithdraw({
      amountUsd: 1,
      mode: "full",
      signer,
    });

    expect(result).toEqual({
      cleanupSignature: "cleanup-signature",
      withdrawalSignatures: ["withdraw-signature"],
    });
    expect(warn).toHaveBeenCalledWith(
      "[earn-withdraw] cleanup confirm failed; backend will reconcile",
      expect.any(Error),
    );
    expect(observeLifecycle).toHaveBeenCalledWith(
      "cleanup_backend_confirm",
      expect.objectContaining({
        chainState: "confirmed",
        errorCode: "backend_confirmation_failed",
        persistenceState: "failed",
        recoveryRequired: true,
      }),
    );
    warn.mockRestore();
  });

  test("retries the cleanup context while the backend RPC catches up", async () => {
    fetchEarnWithdrawCleanupPrepareContext.mockRejectedValueOnce(
      new MockEarnApiError("Minimum context slot not reached", "context_failed"),
    );

    const result = await executeEarnWithdraw({
      amountUsd: 1,
      mode: "full",
      signer,
    });

    expect(fetchEarnWithdrawCleanupPrepareContext).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      cleanupSignature: "cleanup-signature",
      withdrawalSignatures: ["withdraw-signature"],
    });
  });

  test("does not retry cleanup after the user rejects a wallet prompt", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    fetchEarnWithdrawCleanupPrepareContext.mockRejectedValueOnce(
      new WalletRejectedError(),
    );

    const result = await executeEarnWithdraw({
      amountUsd: 1,
      mode: "full",
      signer,
    });

    expect(fetchEarnWithdrawCleanupPrepareContext).toHaveBeenCalledTimes(1);
    expect(signAndSendPreparedOperations).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      withdrawalSignatures: ["withdraw-signature"],
    });
    warn.mockRestore();
  });

  test("keeps partial withdrawals single-phase", async () => {
    const context = fullFinalExitContext();
    fetchEarnWithdrawPrepareContext.mockResolvedValue({
      ...context,
      withdrawInput: {
        ...context.withdrawInput,
        closePoliciesOnFullWithdrawal: false,
        mode: "partial",
      },
    });

    const result = await executeEarnWithdraw({
      amountUsd: 1,
      mode: "partial",
      signer,
    });

    expect(fetchEarnWithdrawCleanupPrepareContext).not.toHaveBeenCalled();
    expect(prepareEarnUsdcCleanup).not.toHaveBeenCalled();
    expect(signAndSendPreparedOperations).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      withdrawalSignatures: ["withdraw-signature"],
    });
  });

  test("recovers via server prepare when device prepare exhausts its retry budget", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const context = fullFinalExitContext();
    fetchEarnWithdrawPrepareContext.mockResolvedValue({
      ...context,
      withdrawInput: { ...context.withdrawInput, mode: "partial" },
    });
    // Kamino keeps answering 503 until the real retry budget runs out.
    prepareEarnUsdcWithdraw.mockRejectedValue(
      new MockKaminoUpstreamError(503, "Kamino unavailable"),
    );
    const serverOperation = { operation: "server-withdraw" };
    prepareEarnWithdrawServer.mockResolvedValue({
      preparedWithdraw: { prepared: serverOperation },
    });

    const result = await executeEarnWithdraw({
      amountUsd: 1,
      mode: "partial",
      signer,
    });

    expect(prepareEarnWithdrawServer).toHaveBeenCalledTimes(1);
    expect(prepareEarnWithdrawServer).toHaveBeenCalledWith(
      expect.objectContaining({ amountRaw: "1000000", mode: "partial" }),
    );
    expect(signAndSendPreparedOperations).toHaveBeenCalledWith(
      expect.objectContaining({ operations: [serverOperation] }),
    );
    expect(observeLifecycle).toHaveBeenCalledWith(
      "prepare",
      expect.objectContaining({
        errorDetail: "kamino_upstream_unavailable",
        stageCount: 4,
        stageIndex: 3,
      }),
    );
    expect(result).toEqual({
      withdrawalSignatures: ["withdraw-signature"],
    });
    warn.mockRestore();
  }, 15_000);

  test("does not fall back to server prepare on a semantic device-prepare failure", async () => {
    const context = fullFinalExitContext();
    fetchEarnWithdrawPrepareContext.mockResolvedValue({
      ...context,
      withdrawInput: { ...context.withdrawInput, mode: "partial" },
    });
    // A plain error from the SDK build is a bug or a rejected input, not a
    // transport blip: connection-retry throws it through unretried.
    const semanticError = new Error(
      "Kamino withdrawal simulation produced less liquidity than requested.",
    );
    prepareEarnUsdcWithdraw.mockRejectedValue(semanticError);

    await expect(
      executeEarnWithdraw({ amountUsd: 1, mode: "partial", signer }),
    ).rejects.toThrow(semanticError.message);

    expect(prepareEarnWithdrawServer).not.toHaveBeenCalled();
    expect(signAndSendPreparedOperations).not.toHaveBeenCalled();
    expect(failFromLifecycle).toHaveBeenCalledWith(
      "prepare",
      semanticError,
      expect.objectContaining({ stageCount: 4, stageIndex: 2 }),
    );
  });
});
