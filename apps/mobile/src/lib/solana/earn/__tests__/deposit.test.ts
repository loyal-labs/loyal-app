import { PublicKey } from "@solana/web3.js";

jest.mock("rpc-websockets", () => ({
  CommonClient: class {},
  WebSocket: jest.fn(),
}));
const prepare = jest.fn();
const send = jest.fn();
jest.mock(
  "@loyal-labs/actions",
  () => ({ normalizeLoyalCluster: (value: string) => value }),
  { virtual: true }
);
jest.mock(
  "@loyal-labs/smart-account-vaults",
  () => ({
    createSmartAccountVaultsClient: () => ({ prepareEarnUsdcDeposit: prepare }),
    isEarnPolicyUpdateRequiredError: () => false,
  }),
  { virtual: true }
);
jest.mock("../connection-retry", () => ({
  withConnectionRetry: (_label: string, _message: string, run: () => unknown) =>
    run(),
}));
jest.mock("../earn-api", () => ({
  fetchEarnDepositPrepareContext: async () => ({
    cluster: "devnet",
    settingsPda: PublicKey.default.toBase58(),
    programId: PublicKey.default.toBase58(),
    policySigner: PublicKey.default.toBase58(),
    yieldRoutingPolicy: null,
    target: null,
  }),
}));
jest.mock("../earn-auth", () => ({ signEarnAuth: async () => ({}) }));
jest.mock("../send-prepared", () => ({ signAndSendPreparedOperations: send }));
jest.mock("@/lib/solana/rpc/connection", () => ({ getConnection: () => ({}) }));
jest.mock("@/lib/analytics/analytics", () => ({ track: jest.fn() }));
jest.mock("@/services/observability", () => ({
  startLifecycleFlow: () => ({
    start() {},
    observe() {},
    complete() {},
    failFrom() {},
    setVariant() {},
  }),
}));

// eslint-disable-next-line import/first
import { executeEarnDeposit } from "../deposit";

const signer = { publicKey: PublicKey.default } as never;
beforeEach(() => {
  jest.clearAllMocks();
});

test("SDK native SOL deficit rejects before transaction signing or submission", async () => {
  prepare.mockResolvedValue({
    prepared: {},
    targetReserve: { reserve: PublicKey.default },
    nativeSolRequirement: {
      canProceed: false,
      deficitLamports: "1000000",
      requiredLamports: "2000000",
    },
  });
  await expect(
    executeEarnDeposit({
      signer,
      amountUsd: 1,
      mint: PublicKey.default.toBase58(),
    })
  ).rejects.toMatchObject({ name: "InsufficientSolError" });
  expect(send).not.toHaveBeenCalled();
});

test("missing SDK rent/fee evidence rejects before signing", async () => {
  prepare.mockResolvedValue({
    prepared: {},
    targetReserve: { reserve: PublicKey.default },
  });
  await expect(
    executeEarnDeposit({
      signer,
      amountUsd: 1,
      mint: PublicKey.default.toBase58(),
    })
  ).rejects.toThrow(/SOL requirement/);
  expect(send).not.toHaveBeenCalled();
});

test("deposit optimism is emitted only after the money-moving stage confirms, not policy setup", async () => {
  prepare.mockResolvedValue({
    policySetupPrepared: {},
    prepared: {},
    targetReserve: { reserve: PublicKey.default },
    nativeSolRequirement: { canProceed: true },
  });
  const onConfirmed = jest.fn();
  send.mockImplementation(async ({ onConfirmed: confirmed }) => {
    confirmed({ signature: "policy", confirmedSlot: "100" }, 0);
    expect(onConfirmed).not.toHaveBeenCalled();
    confirmed({ signature: "deposit", confirmedSlot: "101" }, 1);
    return [
      { signature: "policy", confirmedSlot: "100" },
      { signature: "deposit", confirmedSlot: "101" },
    ];
  });
  const result = await executeEarnDeposit({
    signer,
    amountUsd: 2,
    mint: PublicKey.default.toBase58(),
    onConfirmed,
  });
  expect(result.confirmedSlot).toBe("101");
  expect(onConfirmed).toHaveBeenCalledTimes(1);
  expect(onConfirmed.mock.calls[0][0].deltaAmountRaw).toBe("2000000");
});
