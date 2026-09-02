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
const executeEarnAutodepositClose = jest.fn();
const signAndSendPreparedOperations = jest.fn();
const scanEarnRefunds = jest.fn();
const observeLifecycle = jest.fn();
const failFromLifecycle = jest.fn();

// Mirrors the real EarnApiError so withdraw.ts's instanceof/code checks that
// gate cleanup-context retries stay exercised.
class MockEarnApiError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly detail?: string;

  constructor(
    message: string,
    code?: string,
    status?: number,
    detail?: string
  ) {
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
  { virtual: true }
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
  { virtual: true }
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
  executeEarnAutodepositClose,
}));

jest.mock("../earn-api", () => ({
  EarnApiError: MockEarnApiError,
  // Real connection-retry runs inside these tests; its exhaustion error keeps
  // the production shape so the device-only failure path is exercised.
  earnNetworkError: (message: string, detail?: string) =>
    new MockEarnApiError(message, undefined, undefined, detail),
  fetchEarnWithdrawCleanupPrepareContext,
  fetchEarnWithdrawPrepareContext,
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
      call: (value: unknown) => unknown
    ) => call(auth)
  ),
}));

jest.mock("../refund", () => ({
  scanEarnRefunds,
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
        policySigner: address,
        vaultTokenAccounts: [
          {
            address,
            amountRaw: "7",
            decimals: 6,
            mint: address,
            tokenProgramId: address,
          },
        ],
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
    scanEarnRefunds.mockResolvedValue({
      cluster: "mainnet-beta",
      programId: address,
      scan: {
        policies: [],
        recurringDelegations: [],
        settingsPda: address,
        vault: null,
      },
    });
    executeEarnAutodepositClose.mockReset();
    executeEarnAutodepositClose.mockResolvedValue({
      policyAccounts: ["autodeposit-policy"],
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
      })
    );
    expect(fetchEarnWithdrawCleanupPrepareContext).toHaveBeenCalledTimes(1);
    expect(fetchEarnWithdrawCleanupPrepareContext).toHaveBeenCalledWith(
      expect.objectContaining({ minContextSlot: "101" })
    );
    expect(prepareEarnUsdcCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultTokenAccounts: [expect.objectContaining({ amountRaw: BigInt(7) })],
        walletAddress: PublicKey.default,
      })
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

  test("adds only client-classified supplemental refunds to final cleanup", async () => {
    const supplementalPolicy = new PublicKey(new Uint8Array(32).fill(2));
    const protectedPolicy = new PublicKey(new Uint8Array(32).fill(3));
    const recurringDelegation = new PublicKey(new Uint8Array(32).fill(4));
    scanEarnRefunds.mockResolvedValue({
      cluster: "mainnet-beta",
      programId: address,
      scan: {
        policies: [
          {
            account: supplementalPolicy.toBase58(),
            blockedReason: null,
            canRefund: true,
            lamports: 1,
          },
          {
            account: protectedPolicy.toBase58(),
            blockedReason: "Active Autoswap policy",
            canRefund: false,
            lamports: 1,
          },
        ],
        recurringDelegations: [
          {
            account: recurringDelegation.toBase58(),
            blockedReason: null,
            canRefund: true,
            lamports: 1,
          },
        ],
        settingsPda: address,
        vault: null,
      },
    });

    await executeEarnWithdraw({ amountUsd: 1, mode: "full", signer });

    expect(prepareEarnUsdcCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalPolicyAccounts: [supplementalPolicy],
        refundableRecurringDelegations: [recurringDelegation],
      })
    );
  });

  test("waits past a stale confirmed Autodeposit close before withdrawing", async () => {
    jest.useFakeTimers();
    const finalContext = fullFinalExitContext();
    const staleCloseContext = {
      ...finalContext,
      withdrawInput: {
        ...finalContext.withdrawInput,
        autodepositClose: {
          policy: "autodeposit-policy",
          recurringDelegation: "autodeposit-delegation",
        },
      },
    };
    fetchEarnWithdrawPrepareContext
      .mockReset()
      .mockResolvedValueOnce(staleCloseContext)
      .mockResolvedValueOnce(staleCloseContext)
      .mockResolvedValueOnce(finalContext);

    const withdrawPromise = executeEarnWithdraw({
      amountUsd: 1,
      mode: "full",
      signer,
    });
    await jest.runAllTimersAsync();
    const result = await withdrawPromise;
    jest.useRealTimers();

    expect(executeEarnAutodepositClose).toHaveBeenCalledTimes(1);
    expect(fetchEarnWithdrawPrepareContext).toHaveBeenCalledTimes(3);
    expect(prepareEarnUsdcWithdraw).toHaveBeenCalledTimes(1);
    expect(result.withdrawalSignatures).toEqual(["withdraw-signature"]);
  });

  test("returns the landed withdrawal when cleanup fails", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    // Code-less EarnApiError = terminal (e.g. backend without the endpoint):
    // no retry, and the landed withdrawal must still resolve as a success.
    fetchEarnWithdrawCleanupPrepareContext.mockRejectedValue(
      new MockEarnApiError("Failed to prepare Earn account cleanup.")
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
    // Message-matched, not counted: the fixture's placeholder mint also draws
    // a benign catalog-miss warning from tokenProgramForEarnMint.
    expect(warn).toHaveBeenCalledWith(
      "[earn-withdraw] cleanup skipped after landed withdrawal",
      expect.anything()
    );
    warn.mockRestore();
  });

  test("returns the cleanup signature without an API accounting write", async () => {
    const result = await executeEarnWithdraw({
      amountUsd: 1,
      mode: "full",
      signer,
    });

    expect(result).toEqual({
      cleanupSignature: "cleanup-signature",
      withdrawalSignatures: ["withdraw-signature"],
    });
    expect(observeLifecycle).not.toHaveBeenCalledWith(
      "cleanup_backend_confirm",
      expect.anything()
    );
  });

  test("retries the cleanup context while the backend RPC catches up", async () => {
    fetchEarnWithdrawCleanupPrepareContext.mockRejectedValueOnce(
      new MockEarnApiError("Minimum context slot not reached", "context_failed")
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
      new WalletRejectedError()
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

  test("fails closed when device prepare exhausts its retry budget", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const context = fullFinalExitContext();
    fetchEarnWithdrawPrepareContext.mockResolvedValue({
      ...context,
      withdrawInput: { ...context.withdrawInput, mode: "partial" },
    });
    // Kamino keeps answering 503 until the real retry budget runs out.
    prepareEarnUsdcWithdraw.mockRejectedValue(
      new MockKaminoUpstreamError(503, "Kamino unavailable")
    );
    await expect(
      executeEarnWithdraw({ amountUsd: 1, mode: "partial", signer })
    ).rejects.toThrow(
      "We couldn't reach the network to prepare the withdrawal"
    );
    expect(signAndSendPreparedOperations).not.toHaveBeenCalled();
    warn.mockRestore();
  }, 15_000);

  test("does not fall back to server prepare on a semantic device-prepare failure", async () => {
    const context = fullFinalExitContext();
    fetchEarnWithdrawPrepareContext.mockResolvedValue({
      ...context,
      withdrawInput: { ...context.withdrawInput, mode: "partial" },
    });
    // A semantic SDK error is not a transport blip: connection-retry throws
    // it through unretried even when it carries a stable telemetry code.
    const semanticError = Object.assign(
      new Error(
        "Kamino withdrawal simulation produced less liquidity than requested."
      ),
      { code: "earn_withdraw_underfilled" }
    );
    prepareEarnUsdcWithdraw.mockRejectedValue(semanticError);

    await expect(
      executeEarnWithdraw({ amountUsd: 1, mode: "partial", signer })
    ).rejects.toThrow(semanticError.message);

    expect(signAndSendPreparedOperations).not.toHaveBeenCalled();
    expect(failFromLifecycle).toHaveBeenCalledWith(
      "prepare",
      semanticError,
      expect.objectContaining({ stageCount: 3, stageIndex: 2 })
    );
  });
});
