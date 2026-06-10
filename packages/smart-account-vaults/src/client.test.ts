import { afterEach, describe, expect, mock, test } from "bun:test";
import { STABLECOIN_MINTS, Stablecoin } from "@loyal/actions";
import {
  generated,
  Policy,
  Settings,
} from "@loyal-labs/loyal-smart-accounts-core";
import {
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemInstruction, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

import { createSmartAccountVaultsClient } from "./client";

const programId = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const settingsPda = new PublicKey("11111111111111111111111111111112");
const walletAddress = new PublicKey("11111111111111111111111111111113");
const feePayer = walletAddress;
const backendSigner = new PublicKey("11111111111111111111111111111119");
const policyAccount = new PublicKey("11111111111111111111111111111117");
const kaminoProgram = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);
const kaminoMarket = new PublicKey(
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
);
const kaminoReserve = new PublicKey(
  "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"
);
const kaminoReserveLiquiditySupply = new PublicKey(
  "11111111111111111111111111111114"
);
const kaminoReserveCollateralMint = new PublicKey(
  "11111111111111111111111111111115"
);
const kaminoCollateralAta = getAssociatedTokenAddressSync(
  kaminoReserveCollateralMint,
  deriveVault(),
  true,
  TOKEN_PROGRAM_ID
);
const kaminoSetupAccount = new PublicKey("11111111111111111111111111111118");
const originalFetch = globalThis.fetch;
const kaminoReserveDiscriminator = Buffer.from([
  43, 242, 204, 202, 26, 247, 59, 127,
]);
const kaminoReserveOffsetBase = 8;
const kaminoReserveOffsets = {
  liquidityAvailableAmount: kaminoReserveOffsetBase + 216,
  collateralMintTotalSupply: kaminoReserveOffsetBase + 2584,
} as const;

function decimalAmountToRaw(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  return (
    BigInt(whole || "0") * BigInt(1_000_000) +
    BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0")
  );
}

function mockKaminoDepositInstruction() {
  const fetchMock = mock(async () => {
    return new Response(
      JSON.stringify({
        instructions: [
          {
            accounts: [
              { address: SystemProgram.programId.toBase58(), role: "READONLY" },
              { address: TOKEN_PROGRAM_ID.toBase58(), role: "READONLY" },
              { address: kaminoProgram.toBase58(), role: "READONLY" },
            ],
            data: "AA==",
            programAddress: "11111111111111111111111111111111",
          },
          {
            accounts: [
              { address: "VAULT_PLACEHOLDER", role: "READONLY_SIGNER" },
              { address: "VAULT_PLACEHOLDER", role: "WRITABLE_SIGNER" },
              { address: kaminoSetupAccount.toBase58(), role: "WRITABLE" },
              { address: kaminoProgram.toBase58(), role: "READONLY" },
              { address: SystemProgram.programId.toBase58(), role: "READONLY" },
            ],
            data: Buffer.from([
              117, 169, 176, 69, 197, 23, 15, 162,
            ]).toString("base64"),
            programAddress: kaminoProgram.toBase58(),
          },
          {
            accounts: [
              { address: "VAULT_PLACEHOLDER", role: "WRITABLE_SIGNER" },
              { address: "11111111111111111111111111111111", role: "READONLY" },
              { address: kaminoMarket.toBase58(), role: "READONLY" },
              { address: kaminoReserve.toBase58(), role: "WRITABLE" },
              {
                address: STABLECOIN_MINTS[Stablecoin.USDC].toBase58(),
                role: "READONLY",
              },
              {
                address: kaminoReserveLiquiditySupply.toBase58(),
                role: "WRITABLE",
              },
              {
                address: kaminoReserveCollateralMint.toBase58(),
                role: "WRITABLE",
              },
              { address: kaminoCollateralAta.toBase58(), role: "WRITABLE" },
              { address: "VAULT_USDC_ATA_PLACEHOLDER", role: "WRITABLE" },
              { address: "11111111111111111111111111111111", role: "READONLY" },
              { address: TOKEN_PROGRAM_ID.toBase58(), role: "READONLY" },
            ],
            data: Buffer.from([
              216, 224, 191, 27, 204, 151, 102, 175, 64, 66, 15, 0, 0, 0, 0,
              0,
            ]).toString("base64"),
            programAddress: kaminoProgram.toBase58(),
          },
        ],
      })
        .replace(/VAULT_PLACEHOLDER/g, deriveVault().toBase58())
        .replace(
          /VAULT_USDC_ATA_PLACEHOLDER/g,
          deriveVaultUsdcAta().toBase58()
        ),
      { status: 200 }
    );
  });

  globalThis.fetch = fetchMock as never;
  return fetchMock;
}

function mockKaminoWithdrawInstruction(
  overrides: { vaultUsdcAta?: PublicKey } = {}
) {
  const fetchMock = mock(async (_url: unknown, init: RequestInit) => {
    const amountRaw = decimalAmountToRaw(
      JSON.parse((init.body as string) ?? "{}").amount
    );
    const instructionData = Buffer.alloc(16);
    Buffer.from([
      235, 52, 119, 152, 149, 197, 20, 7,
    ]).copy(instructionData, 0);
    instructionData.writeBigUInt64LE(amountRaw, 8);
    const reserveCollateralMint = kaminoReserveCollateralMint;
    const vaultCollateralAta = getAssociatedTokenAddressSync(
      reserveCollateralMint,
      deriveVault(),
      true,
      TOKEN_PROGRAM_ID
    );
    return new Response(
      JSON.stringify({
        instructions: [
          {
            accounts: [
              { address: deriveVault().toBase58(), role: "WRITABLE_SIGNER" },
              { address: kaminoMarket.toBase58(), role: "READONLY" },
              { address: kaminoReserve.toBase58(), role: "WRITABLE" },
              { address: "11111111111111111111111111111111", role: "READONLY" },
              {
                address: STABLECOIN_MINTS[Stablecoin.USDC].toBase58(),
                role: "READONLY",
              },
              {
                address: reserveCollateralMint.toBase58(),
                role: "WRITABLE",
              },
              {
                address: kaminoReserveLiquiditySupply.toBase58(),
                role: "WRITABLE",
              },
              { address: vaultCollateralAta.toBase58(), role: "WRITABLE" },
              {
                address: (
                  overrides.vaultUsdcAta ?? deriveVaultUsdcAta()
                ).toBase58(),
                role: "WRITABLE",
              },
              { address: TOKEN_PROGRAM_ID.toBase58(), role: "READONLY" },
              { address: TOKEN_PROGRAM_ID.toBase58(), role: "READONLY" },
              {
                address: "Sysvar1nstructions1111111111111111111111111",
                role: "READONLY",
              },
            ],
            data: instructionData.toString("base64"),
            programAddress: kaminoProgram.toBase58(),
          },
        ],
      }),
      { status: 200 }
    );
  });

  globalThis.fetch = fetchMock as never;
  return fetchMock;
}

function deriveVault() {
  return PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("smart_account"),
      settingsPda.toBytes(),
      new TextEncoder().encode("smart_account"),
      Uint8Array.from([1]),
    ],
    programId
  )[0];
}

function deriveVaultUsdcAta() {
  return getAssociatedTokenAddressSync(
    STABLECOIN_MINTS[Stablecoin.USDC],
    deriveVault(),
    true,
    TOKEN_PROGRAM_ID
  );
}

function createSerializedEarnPolicyAccount(seed = new BN(1)) {
  const [data] = Policy.fromArgs({
    bump: 255,
    expiration: null,
    policyState: {
      __kind: "ProgramInteraction",
      fields: [
        {
          accountIndex: 1,
          instructionsConstraints: [],
          postHook: null,
          preHook: null,
          spendingLimits: [],
        },
      ],
    },
    rentCollector: walletAddress,
    seed,
    settings: settingsPda,
    signers: [],
    staleTransactionIndex: new BN(0),
    start: new BN(0),
    threshold: 1,
    timeLock: 0,
    transactionIndex: new BN(0),
  }).serialize();

  return {
    data,
    executable: false,
    lamports: 1,
    owner: programId,
    rentEpoch: 0,
  };
}

function createSerializedSettingsAccount(policySeed: BN | null = null) {
  const [data] = Settings.fromArgs({
    accountUtilization: 0,
    archivalAuthority: null,
    archivableAfter: new BN(0),
    bump: 255,
    policySeed,
    reserved2: 0,
    seed: new BN(0),
    settingsAuthority: walletAddress,
    signers: [],
    staleTransactionIndex: new BN(0),
    threshold: 1,
    timeLock: 0,
    transactionIndex: new BN(0),
  }).serialize();

  return {
    data,
    executable: false,
    lamports: 1,
    owner: programId,
    rentEpoch: 0,
  };
}

function createSerializedKaminoReserveAccount(args: {
  collateralSupplyRaw: bigint;
  liquidityAvailableAmountRaw: bigint;
}) {
  const data = Buffer.alloc(kaminoReserveOffsets.collateralMintTotalSupply + 8);
  kaminoReserveDiscriminator.copy(data, 0);
  data.writeBigUInt64LE(
    args.liquidityAvailableAmountRaw,
    kaminoReserveOffsets.liquidityAvailableAmount
  );
  data.writeBigUInt64LE(
    args.collateralSupplyRaw,
    kaminoReserveOffsets.collateralMintTotalSupply
  );

  return {
    data,
    executable: false,
    lamports: 1,
    owner: kaminoProgram,
    rentEpoch: 0,
  };
}

function createTokenAccountData(args: {
  amountRaw: bigint;
  mint?: PublicKey;
  owner?: PublicKey;
}): Buffer {
  const data = Buffer.alloc(AccountLayout.span);
  (args.mint ?? STABLECOIN_MINTS[Stablecoin.USDC]).toBuffer().copy(data, 0);
  (args.owner ?? deriveVault()).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(args.amountRaw, 64);
  return data;
}

function createSimulatedTokenAccountData(amountRaw: bigint): string {
  return createTokenAccountData({ amountRaw }).toString("base64");
}

function expectSyncExecutionUsesSettingsConsensus(
  instruction:
    | { keys: { pubkey: PublicKey }[]; programId: PublicKey }
    | undefined
) {
  expect(instruction?.programId.toBase58()).toBe(programId.toBase58());
  expect(instruction?.keys[0]?.pubkey.toBase58()).toBe(settingsPda.toBase58());
}

function expectIncludesKaminoSetupAccount(
  instruction:
    | { keys: { pubkey: PublicKey }[]; programId: PublicKey }
    | undefined
) {
  expect(
    instruction?.keys.some((key) => key.pubkey.equals(kaminoSetupAccount))
  ).toBe(true);
}

function expectInstructionAccountMeta(
  instruction:
    | {
        keys: { isSigner: boolean; isWritable: boolean; pubkey: PublicKey }[];
      }
    | undefined,
  pubkey: PublicKey,
  expected: { isSigner?: boolean; isWritable?: boolean }
) {
  const metas = instruction?.keys.filter((key) => key.pubkey.equals(pubkey));
  expect(metas?.length ?? 0).toBeGreaterThan(0);
  expect(
    metas?.some((meta) => {
      if (
        typeof expected.isSigner === "boolean" &&
        meta.isSigner !== expected.isSigner
      ) {
        return false;
      }
      if (
        typeof expected.isWritable === "boolean" &&
        meta.isWritable !== expected.isWritable
      ) {
        return false;
      }
      return true;
    })
  ).toBe(true);
}

function expectPolicyCreateSigner(
  instruction:
    | {
        data: Buffer | Uint8Array;
      }
    | undefined,
  expectedSigner: PublicKey
) {
  expect(instruction).toBeDefined();
  const [decoded] =
    generated.executeSettingsTransactionSyncStruct.deserialize(
      Buffer.from(instruction!.data)
    );
  const policyCreate = decoded.args.actions.find(
    (action) => action.__kind === "PolicyCreate"
  );
  expect(policyCreate?.__kind).toBe("PolicyCreate");
  if (!policyCreate || policyCreate.__kind !== "PolicyCreate") {
    throw new Error("Expected a PolicyCreate action.");
  }
  expect(policyCreate.signers.map((signer) => signer.key.toBase58())).toEqual([
    expectedSigner.toBase58(),
  ]);
}

describe("prepareEarnUsdcDeposit", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("builds the one-transaction earn deposit flow in order", async () => {
    const fetchMock = mockKaminoDepositInstruction();
    const getAccountInfo = mock(async (_address: PublicKey) =>
      createSerializedSettingsAccount(new BN(6))
    );
    const client = createSmartAccountVaultsClient({
      connection: { getAccountInfo } as never,
      programId,
    });
    const result = await client.prepareEarnUsdcDeposit({
      settingsPda,
      walletAddress,
      feePayer,
      policySigner: backendSigner,
      amountRaw: BigInt(1_000_000),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.prepared.instructions).toHaveLength(5);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );
    expect(result.prepared.instructions[1]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );

    const transfer = decodeTransferCheckedInstruction(
      result.prepared.instructions[2]!,
      TOKEN_PROGRAM_ID
    );
    expect(transfer.keys.source.pubkey.toBase58()).toBe(
      getAssociatedTokenAddressSync(
        STABLECOIN_MINTS[Stablecoin.USDC],
        walletAddress,
        false,
        TOKEN_PROGRAM_ID
      ).toBase58()
    );
    expect(transfer.keys.destination.pubkey.toBase58()).toBe(
      deriveVaultUsdcAta().toBase58()
    );
    expect(transfer.data.amount.toString()).toBe("1000000");
    expect(transfer.data.decimals).toBe(6);

    expect(result.prepared.instructions[3]?.programId.toBase58()).toBe(
      programId.toBase58()
    );
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[4]);
    expectPolicyCreateSigner(result.prepared.instructions[3], backendSigner);
    expectIncludesKaminoSetupAccount(result.prepared.instructions[4]);
    expect(result.policy.seed).toBe(BigInt(7));
    expect(result.policy.sameMintInstructionConstraintIndexes).toEqual([0, 1]);
    expect(result.vault.accountIndex).toBe(1);
    expect(result.vault.collateralAta?.toBase58()).toBe(
      kaminoCollateralAta.toBase58()
    );
    expect(result.vault.pubkey.toBase58()).toBe(deriveVault().toBase58());
    expect(result.targetReserve.reserve.toBase58()).toBe(
      kaminoReserve.toBase58()
    );
    expect(result.persistence).toMatchObject({
      cluster: "mainnet-beta",
      delegatedSigner: backendSigner.toBase58(),
      policyId: "7",
      policyInitialization: "create",
      policySeed: "7",
      principalAmountRaw: "1000000",
      vaultIndex: 1,
    });
  });

  test("builds a top-up earn deposit without recreating the routing policy", async () => {
    mockKaminoDepositInstruction();
    const client = createSmartAccountVaultsClient({
      connection: {} as never,
      programId,
    });

    const result = await client.prepareEarnUsdcDeposit({
      settingsPda,
      walletAddress,
      feePayer,
      policySigner: backendSigner,
      amountRaw: BigInt(500_000),
      initializeYieldRoutingPolicy: false,
      yieldRoutingPolicy: {
        account: policyAccount,
        seed: BigInt(7),
      },
    });

    expect(result.prepared.instructions).toHaveLength(4);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );
    expect(result.prepared.instructions[1]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );

    const transfer = decodeTransferCheckedInstruction(
      result.prepared.instructions[2]!,
      TOKEN_PROGRAM_ID
    );
    expect(transfer.data.amount.toString()).toBe("500000");
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[3]);
    expectIncludesKaminoSetupAccount(result.prepared.instructions[3]);
    expect(result.persistence).toMatchObject({
      policyInitialization: "reuse",
      principalAmountRaw: "500000",
    });
  });

  test("uses a provided earn routing policy for top-up without scanning policies", async () => {
    mockKaminoDepositInstruction();
    const getProgramAccounts = mock(async () => {
      throw new Error("policy scan should not run");
    });
    const client = createSmartAccountVaultsClient({
      connection: { getProgramAccounts } as never,
      programId,
    });
    const result = await client.prepareEarnUsdcDeposit({
      settingsPda,
      walletAddress,
      feePayer,
      policySigner: backendSigner,
      amountRaw: BigInt(500_000),
      initializeYieldRoutingPolicy: false,
      yieldRoutingPolicy: {
        account: policyAccount,
        seed: BigInt(7),
      },
    });

    expect(getProgramAccounts).not.toHaveBeenCalled();
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[3]);
    expect(result.policy.account.toBase58()).toBe(policyAccount.toBase58());
    expect(result.policy.seed).toBe(BigInt(7));
    expect(result.persistence).toMatchObject({
      policyAccount: policyAccount.toBase58(),
      policyInitialization: "reuse",
      policySeed: "7",
    });
  });

  test("adds a vault rent top-up when Kamino returns setup instructions", async () => {
    mockKaminoDepositInstruction();
    const getBalance = mock(async (address: PublicKey) =>
      address.equals(feePayer) ? 100_000_000 : 0
    );
    const client = createSmartAccountVaultsClient({
      connection: { getBalance } as never,
      programId,
    });
    const policyAccount = new PublicKey("11111111111111111111111111111117");

    const result = await client.prepareEarnUsdcDeposit({
      settingsPda,
      walletAddress,
      feePayer,
      policySigner: backendSigner,
      amountRaw: BigInt(500_000),
      initializeYieldRoutingPolicy: false,
      yieldRoutingPolicy: {
        account: policyAccount,
        seed: BigInt(7),
      },
    });

    expect(getBalance).toHaveBeenCalledWith(deriveVault(), "confirmed");
    expect(getBalance).toHaveBeenCalledWith(feePayer, "confirmed");
    expect(result.prepared.instructions).toHaveLength(5);
    const transfer = SystemInstruction.decodeTransfer(
      result.prepared.instructions[2]!
    );
    expect(transfer.fromPubkey.toBase58()).toBe(feePayer.toBase58());
    expect(transfer.toPubkey.toBase58()).toBe(deriveVault().toBase58());
    expect(transfer.lamports).toBe(BigInt(39_532_800));
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[4]);
    expectIncludesKaminoSetupAccount(result.prepared.instructions[4]);
  });

  test("rejects Kamino setup when the fee payer cannot fund rent", async () => {
    mockKaminoDepositInstruction();
    const client = createSmartAccountVaultsClient({
      connection: { getBalance: mock(async () => 0) } as never,
      programId,
    });

    await expect(
      client.prepareEarnUsdcDeposit({
        settingsPda,
        walletAddress,
        feePayer,
        policySigner: backendSigner,
        amountRaw: BigInt(500_000),
        initializeYieldRoutingPolicy: false,
        yieldRoutingPolicy: {
          account: new PublicKey("11111111111111111111111111111117"),
          seed: BigInt(7),
        },
      })
    ).rejects.toThrow("Earn setup requires 0.039532800 SOL");
  });

  test("builds standalone earn routing policy setup metadata", async () => {
    const getAccountInfo = mock(async (_address: PublicKey) =>
      createSerializedSettingsAccount(new BN(6))
    );
    const client = createSmartAccountVaultsClient({
      connection: { getAccountInfo } as never,
      programId,
    });

    const result = await client.prepareEarnUsdcYieldRoutingPolicy({
      settingsPda,
      walletAddress,
      signer: backendSigner,
      feePayer,
    });

    expect(result.prepared.instructions).toHaveLength(1);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      programId.toBase58()
    );
    expectPolicyCreateSigner(result.prepared.instructions[0], backendSigner);
    expect(result.policy.seed).toBe(BigInt(7));
    expect(result.vault).toMatchObject({
      accountIndex: 1,
    });
    expect(result.vault.pubkey.toBase58()).toBe(deriveVault().toBase58());
    expect(result.targetReserve.reserve.toBase58()).toBe(
      kaminoReserve.toBase58()
    );
    expect(result.persistence).toMatchObject({
      cluster: "mainnet-beta",
      delegatedSigner: backendSigner.toBase58(),
      liquidityMint: STABLECOIN_MINTS[Stablecoin.USDC].toBase58(),
      policyAccount: result.policy.account.toBase58(),
      policyId: "7",
      policySeed: "7",
      settings: settingsPda.toBase58(),
      targetReserve: kaminoReserve.toBase58(),
      vaultIndex: 1,
      vaultPubkey: deriveVault().toBase58(),
      walletAddress: walletAddress.toBase58(),
    });
    expect(getAccountInfo).toHaveBeenCalledTimes(1);
    expect(getAccountInfo.mock.calls[0]?.[0]?.toBase58()).toBe(
      settingsPda.toBase58()
    );
  });

  test("rejects zero amount deposits", async () => {
    const client = createSmartAccountVaultsClient({
      connection: {} as never,
      programId,
    });

    await expect(
      client.prepareEarnUsdcDeposit({
        settingsPda,
        walletAddress,
        feePayer,
        policySigner: backendSigner,
        amountRaw: BigInt(0),
      })
    ).rejects.toThrow("Earn deposit amount must be greater than 0.");
  });
});

describe("prepareEarnUsdcWithdraw", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("builds the partial withdraw flow in order", async () => {
    const fetchMock = mockKaminoWithdrawInstruction();
    const client = createSmartAccountVaultsClient({
      connection: {} as never,
      programId,
    });
    const result = await client.prepareEarnUsdcWithdraw({
      settingsPda,
      walletAddress,
      feePayer,
      policySigner: backendSigner,
      amountRaw: BigInt(1_000_000),
      mode: "partial",
      yieldRoutingPolicy: {
        account: policyAccount,
        seed: BigInt(7),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.prepared.instructions).toHaveLength(3);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );
    expect(result.prepared.instructions[1]?.programId.toBase58()).toBe(
      programId.toBase58()
    );
    expect(result.prepared.instructions[2]?.programId.toBase58()).toBe(
      programId.toBase58()
    );
    expect(result.policy.withdrawInstructionConstraintIndex).toBe(0);
    expect(result.policy.sameMintInstructionConstraintIndexes).toEqual([0, 1]);
    expect(result.mode).toBe("partial");
    expect(result.amountRaw).toBe(BigInt(1_000_000));
    expect(result.persistence).toMatchObject({
      mode: "partial",
      delegatedSigner: backendSigner.toBase58(),
      policyId: "7",
      policySeed: "7",
      withdrawnAmountRaw: "1000000",
      vaultIndex: 1,
    });
  });

  test("builds the full withdraw flow with account cleanup before policy cleanup", async () => {
    const fetchMock = mockKaminoWithdrawInstruction();
    const vaultCollateralAta = getAssociatedTokenAddressSync(
      kaminoReserveCollateralMint,
      deriveVault(),
      true,
      TOKEN_PROGRAM_ID
    );
    const getTokenAccountBalance = mock(async (account: PublicKey) => {
      if (account.equals(vaultCollateralAta)) {
        return {
          context: { slot: 1 },
          value: {
            amount: "200",
            decimals: 6,
            uiAmount: 0.0002,
            uiAmountString: "0.0002",
          },
        };
      }
      expect(account.toBase58()).toBe(deriveVaultUsdcAta().toBase58());
      return {
        context: { slot: 1 },
        value: {
          amount: "1",
          decimals: 6,
          uiAmount: 0.000001,
          uiAmountString: "0.000001",
        },
      };
    });
    const getAccountInfo = mock(async (account: PublicKey) => {
      if (account.equals(kaminoReserve)) {
        return createSerializedKaminoReserveAccount({
          collateralSupplyRaw: BigInt(100),
          liquidityAvailableAmountRaw: BigInt(500_001),
        });
      }
      if (account.equals(vaultCollateralAta)) {
        return {
          data: createTokenAccountData({
            amountRaw: BigInt(0),
            mint: kaminoReserveCollateralMint,
            owner: deriveVault(),
          }),
          executable: false,
          lamports: 1,
          owner: TOKEN_PROGRAM_ID,
          rentEpoch: 0,
        };
      }
      return createSerializedEarnPolicyAccount();
    });
    const simulateTransaction = mock(async () => ({
      value: {
        accounts: [
          {
            data: [createSimulatedTokenAccountData(BigInt(1_000_002)), "base64"],
          },
        ],
        err: null,
        logs: [],
      },
    }));
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo,
        getLatestBlockhash: mock(async () => ({
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 1,
        })),
        getTokenAccountBalance,
        simulateTransaction,
      } as never,
      programId,
    });

    const result = await client.prepareEarnUsdcWithdraw({
      settingsPda,
      walletAddress,
      feePayer,
      policySigner: backendSigner,
      amountRaw: BigInt(1_000_000),
      mode: "full",
      yieldRoutingPolicy: {
        account: policyAccount,
        seed: BigInt(7),
      },
    });

    expect(result.prepared.instructions).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fetchCalls = fetchMock.mock.calls as unknown as Array<
      [unknown, RequestInit]
    >;
    expect(
      JSON.parse((fetchCalls[0]?.[1].body as string) ?? "{}").amount
    ).toBe("1");
    expect(
      JSON.parse((fetchCalls[1]?.[1].body as string) ?? "{}").amount
    ).toBe("1.000001");
    expect(getTokenAccountBalance).toHaveBeenCalledTimes(2);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );
    expect(result.prepared.instructions.slice(1).map((instruction) =>
      instruction.programId.toBase58()
    )).toEqual([
      programId.toBase58(),
      programId.toBase58(),
      programId.toBase58(),
      programId.toBase58(),
    ]);
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[1]);
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[2]);
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[3]);
    expectInstructionAccountMeta(
      result.prepared.instructions[3],
      vaultCollateralAta,
      { isWritable: true }
    );
    expectInstructionAccountMeta(
      result.prepared.instructions[3],
      deriveVaultUsdcAta(),
      { isWritable: true }
    );
    expectInstructionAccountMeta(result.prepared.instructions[3], walletAddress, {
      isWritable: true,
    });
    expectInstructionAccountMeta(result.prepared.instructions[3], deriveVault(), {
      isWritable: true,
    });
    expectInstructionAccountMeta(
      result.prepared.instructions[4],
      result.policy.account,
      { isWritable: true }
    );
    expect(result.mode).toBe("full");
    expect(result.persistence).toMatchObject({
      mode: "full",
      kaminoWithdrawAmountRaw: "1000001",
      vaultCollateralCleanupIncluded: true,
      vaultUsdcRemainderRaw: "1",
      walletTransferAmountRaw: "1000002",
      withdrawnAmountRaw: "1000000",
    });
  });

  test("skips collateral cleanup when the token account is not vault-owned", async () => {
    mockKaminoWithdrawInstruction();
    const vaultCollateralAta = getAssociatedTokenAddressSync(
      kaminoReserveCollateralMint,
      deriveVault(),
      true,
      TOKEN_PROGRAM_ID
    );
    const getTokenAccountBalance = mock(async (account: PublicKey) => {
      if (account.equals(vaultCollateralAta)) {
        return {
          context: { slot: 1 },
          value: {
            amount: "200",
            decimals: 6,
            uiAmount: 0.0002,
            uiAmountString: "0.0002",
          },
        };
      }
      return {
        context: { slot: 1 },
        value: {
          amount: "1",
          decimals: 6,
          uiAmount: 0.000001,
          uiAmountString: "0.000001",
        },
      };
    });
    const getAccountInfo = mock(async (account: PublicKey) => {
      if (account.equals(kaminoReserve)) {
        return createSerializedKaminoReserveAccount({
          collateralSupplyRaw: BigInt(100),
          liquidityAvailableAmountRaw: BigInt(500_001),
        });
      }
      if (account.equals(vaultCollateralAta)) {
        return {
          data: createTokenAccountData({
            amountRaw: BigInt(0),
            mint: kaminoReserveCollateralMint,
            owner: walletAddress,
          }),
          executable: false,
          lamports: 1,
          owner: TOKEN_PROGRAM_ID,
          rentEpoch: 0,
        };
      }
      return createSerializedEarnPolicyAccount();
    });
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo,
        getLatestBlockhash: mock(async () => ({
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 1,
        })),
        getTokenAccountBalance,
        simulateTransaction: mock(async () => ({
          value: {
            accounts: [
              {
                data: [
                  createSimulatedTokenAccountData(BigInt(1_000_002)),
                  "base64",
                ],
              },
            ],
            err: null,
            logs: [],
          },
        })),
      } as never,
      programId,
    });

    const result = await client.prepareEarnUsdcWithdraw({
      settingsPda,
      walletAddress,
      feePayer,
      policySigner: backendSigner,
      amountRaw: BigInt(1_000_000),
      mode: "full",
      yieldRoutingPolicy: {
        account: policyAccount,
        seed: BigInt(7),
      },
    });

    expect(result.prepared.instructions).toHaveLength(5);
    expect(
      result.prepared.instructions[3]?.keys.some((key) =>
        key.pubkey.equals(vaultCollateralAta)
      )
    ).toBe(false);
    expectInstructionAccountMeta(
      result.prepared.instructions[3],
      deriveVaultUsdcAta(),
      { isWritable: true }
    );
    expectInstructionAccountMeta(
      result.prepared.instructions[4],
      result.policy.account,
      { isWritable: true }
    );
    expect(result.persistence).toMatchObject({
      mode: "full",
      vaultCollateralCleanupIncluded: false,
      vaultUsdcRemainderRaw: "1",
      walletTransferAmountRaw: "1000002",
      withdrawnAmountRaw: "1000000",
    });
  });

  test("rejects malformed withdraw KTX accounts", async () => {
    mockKaminoWithdrawInstruction({ vaultUsdcAta: walletAddress });
    const client = createSmartAccountVaultsClient({
      connection: {} as never,
      programId,
    });

    await expect(
      client.prepareEarnUsdcWithdraw({
        settingsPda,
        walletAddress,
        feePayer,
        policySigner: backendSigner,
        amountRaw: BigInt(1_000_000),
        mode: "partial",
        yieldRoutingPolicy: {
          account: policyAccount,
          seed: BigInt(7),
        },
      })
    ).rejects.toThrow("unexpected vault USDC account");
  });
});

describe("prepareEarnUsdcAutodeposit", () => {
  afterEach(() => {
    mock.restore();
  });

  test("builds setup policy creation with the backend signer", async () => {
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(settingsPda)) {
        return createSerializedSettingsAccount();
      }
      return null;
    });
    const client = createSmartAccountVaultsClient({
      connection: { getAccountInfo } as never,
      programId,
    });

    const result = await client.prepareEarnUsdcAutodepositSetup({
      settingsPda,
      walletAddress,
      feePayer,
      signer: walletAddress,
      policySigner: backendSigner,
      amountRaw: BigInt(1_000_000),
      nonce: BigInt(42),
    });

    expect(result.stage).toBe("initialize_subscription_authority");
    expect(result.prepared.instructions).toHaveLength(2);
    expectPolicyCreateSigner(result.prepared.instructions[1], backendSigner);
    expect(result.persistence).toMatchObject({
      delegatedSigner: backendSigner.toBase58(),
      subscriptionDelegatee: deriveVault().toBase58(),
      walletAddress: walletAddress.toBase58(),
    });
  });

  test("builds close policy removal with backend signer metadata", async () => {
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(policyAccount)) {
        return createSerializedEarnPolicyAccount();
      }
      return null;
    });
    const client = createSmartAccountVaultsClient({
      connection: { getAccountInfo } as never,
      programId,
    });

    const result = await client.prepareEarnUsdcAutodepositClose({
      settingsPda,
      walletAddress,
      feePayer,
      signer: walletAddress,
      policySigner: backendSigner,
      policy: policyAccount,
      recurringDelegation: new PublicKey(
        "11111111111111111111111111111116"
      ),
    });

    expect(result.prepared.instructions).toHaveLength(2);
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[1]);
    expect(result.persistence).toMatchObject({
      delegatedSigner: backendSigner.toBase58(),
      policyAccount: policyAccount.toBase58(),
      walletAddress: walletAddress.toBase58(),
    });
  });

  test("builds pull execution with the backend policy signer", async () => {
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(policyAccount)) {
        return createSerializedEarnPolicyAccount();
      }
      return null;
    });
    const client = createSmartAccountVaultsClient({
      connection: { getAccountInfo } as never,
      programId,
    });

    const result = await client.prepareEarnUsdcAutodepositPull({
      policy: policyAccount,
      walletAddress,
      feePayer,
      policySigner: backendSigner,
      recurringDelegation: new PublicKey(
        "11111111111111111111111111111116"
      ),
      amountRaw: BigInt(100_000),
    });

    expect(result.prepared.instructions).toHaveLength(1);
    expectInstructionAccountMeta(
      result.prepared.instructions[0],
      backendSigner,
      { isSigner: true }
    );
    expectInstructionAccountMeta(result.prepared.instructions[0], deriveVault(), {
      isSigner: false,
    });
    expect(result.persistence).toMatchObject({
      amountRaw: "100000",
      delegatedSigner: backendSigner.toBase58(),
      policyAccount: policyAccount.toBase58(),
      walletAddress: walletAddress.toBase58(),
    });
  });
});
