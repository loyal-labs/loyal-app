import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  getRiskBasketMarketsForCluster,
  getStablecoinMintsForCluster,
  KAMINO_VANILLA_OBLIGATION_ID,
  KAMINO_VANILLA_OBLIGATION_TAG,
  LoyalCluster,
  RiskBasket,
  STABLECOIN_MINTS,
  Stablecoin,
  SUBSCRIPTIONS_PROGRAM_ID,
} from "@loyal-labs/actions";
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
import {
  type AddressLookupTableAccount,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";

import { createSmartAccountVaultsClient } from "./client";

const programId = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const settingsPda = new PublicKey("11111111111111111111111111111112");
const walletAddress = new PublicKey("11111111111111111111111111111113");
const feePayer = walletAddress;
const backendSigner = new PublicKey("11111111111111111111111111111119");
const policyAccount = new PublicKey("11111111111111111111111111111117");
const setupPolicyAccount = new PublicKey("11111111111111111111111111111118");
const autodepositPolicyAccount = new PublicKey(
  "1111111111111111111111111111111A"
);
const recurringDelegation = new PublicKey("1111111111111111111111111111111B");
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
const PACKET_DATA_SIZE = 1232;

function deriveKaminoVanillaObligation(
  vault: PublicKey,
  lendingMarket: PublicKey,
  lendProgramId = kaminoProgram
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Uint8Array.of(KAMINO_VANILLA_OBLIGATION_TAG),
      Uint8Array.of(KAMINO_VANILLA_OBLIGATION_ID),
      vault.toBytes(),
      lendingMarket.toBytes(),
      PublicKey.default.toBytes(),
      PublicKey.default.toBytes(),
    ],
    lendProgramId
  )[0];
}

function decimalAmountToRaw(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  return (
    BigInt(whole || "0") * BigInt(1_000_000) +
    BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0")
  );
}

function serializedPreparedLength(prepared: {
  instructions: readonly TransactionInstruction[];
  lookupTableAccounts?: readonly AddressLookupTableAccount[];
}) {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [...prepared.instructions],
    }).compileToV0Message([...(prepared.lookupTableAccounts ?? [])])
  ).serialize().length;
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
            data: Buffer.from([117, 169, 176, 69, 197, 23, 15, 162]).toString(
              "base64"
            ),
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
              216, 224, 191, 27, 204, 151, 102, 175, 64, 66, 15, 0, 0, 0, 0, 0,
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
    Buffer.from([235, 52, 119, 152, 149, 197, 20, 7]).copy(instructionData, 0);
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

function createSerializedSubscriptionAuthorityAccount(initId = BigInt(1)) {
  const data = Buffer.alloc(106);
  data.writeBigInt64LE(initId, 98);

  return {
    data,
    executable: false,
    lamports: 1,
    owner: SUBSCRIPTIONS_PROGRAM_ID,
    rentEpoch: 0,
  };
}

function createSerializedRecurringDelegationAccount() {
  return {
    data: Buffer.alloc(211),
    executable: false,
    lamports: 1,
    owner: SUBSCRIPTIONS_PROGRAM_ID,
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
  const [decoded] = generated.executeSettingsTransactionSyncStruct.deserialize(
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

function decodeGeneratedPolicyCreate(
  instruction:
    | {
        data: Buffer | Uint8Array;
      }
    | undefined
) {
  expect(instruction).toBeDefined();
  const [decoded] = generated.executeSettingsTransactionSyncStruct.deserialize(
    Buffer.from(instruction!.data)
  );
  const policyCreate = decoded.args.actions.find(
    (action) => action.__kind === "PolicyCreate"
  );
  expect(policyCreate?.__kind).toBe("PolicyCreate");
  if (!policyCreate || policyCreate.__kind !== "PolicyCreate") {
    throw new Error("Expected a PolicyCreate action.");
  }
  return policyCreate;
}

function decodeGeneratedSettingsActions(
  instruction:
    | {
        data: Buffer | Uint8Array;
      }
    | undefined
) {
  expect(instruction).toBeDefined();
  const [decoded] = generated.executeSettingsTransactionSyncStruct.deserialize(
    Buffer.from(instruction!.data)
  );
  return decoded.args.actions;
}

function generatedPubkeyConstraintValues(
  constraints: generated.AccountConstraint[],
  accountIndex: number
) {
  const constraint = constraints.find(
    (candidate) => candidate.accountIndex === accountIndex
  );
  expect(constraint?.accountConstraint.__kind).toBe("Pubkey");
  if (!constraint || constraint.accountConstraint.__kind !== "Pubkey") {
    throw new Error(`Expected pubkey account constraint ${accountIndex}.`);
  }
  return constraint.accountConstraint.fields[0].map((pubkey) =>
    pubkey.toBase58()
  );
}

function expectEarnRoutePolicyPayloadUsesSafeUniverse(
  payload: generated.PolicyCreationPayload,
  expectedStableMints = getStablecoinMintsForCluster(
    LoyalCluster.MainnetBeta
  ).map((mint) => mint.toBase58())
) {
  expect(payload.__kind).toBe("ProgramInteraction");
  if (payload.__kind !== "ProgramInteraction") {
    throw new Error("Expected ProgramInteraction policy payload.");
  }
  const [field] = payload.fields;
  expect(field.accountIndex).toBe(1);
  expect(field.instructionsConstraints).toHaveLength(2);

  const expectedMarkets = getRiskBasketMarketsForCluster(
    LoyalCluster.MainnetBeta,
    RiskBasket.Safe
  ).map((market) => market.toBase58());

  const [withdrawConstraint, depositConstraint] = field.instructionsConstraints;
  expect(
    generatedPubkeyConstraintValues(withdrawConstraint!.accountConstraints, 2)
  ).toEqual(expectedMarkets);
  expect(
    withdrawConstraint!.accountConstraints.some(
      (constraint) => constraint.accountIndex === 1
    )
  ).toBe(false);
  expect(
    generatedPubkeyConstraintValues(depositConstraint!.accountConstraints, 2)
  ).toEqual(expectedMarkets);
  expect(
    generatedPubkeyConstraintValues(depositConstraint!.accountConstraints, 5)
  ).toEqual(expectedStableMints);
}

function expectEarnSetupPolicyPayloadUsesSafeUniverse(
  payload: generated.PolicyCreationPayload
) {
  expect(payload.__kind).toBe("ProgramInteraction");
  if (payload.__kind !== "ProgramInteraction") {
    throw new Error("Expected ProgramInteraction policy payload.");
  }
  const [field] = payload.fields;
  expect(field.accountIndex).toBe(1);
  expect(field.instructionsConstraints).toHaveLength(1);

  const expectedMarkets = getRiskBasketMarketsForCluster(
    LoyalCluster.MainnetBeta,
    RiskBasket.Safe
  ).map((market) => market.toBase58());
  const [initObligationConstraint] = field.instructionsConstraints;
  expect(
    generatedPubkeyConstraintValues(
      initObligationConstraint!.accountConstraints,
      3
    )
  ).toEqual(expectedMarkets);
}

function expectEarnRoutePolicyCreateUsesSafeUniverse(
  instruction:
    | {
        data: Buffer | Uint8Array;
      }
    | undefined,
  expectedStableMints?: string[]
) {
  const policyCreate = decodeGeneratedPolicyCreate(instruction);
  expectEarnRoutePolicyPayloadUsesSafeUniverse(
    policyCreate.policyCreationPayload,
    expectedStableMints
  );
}

function expectEarnSetupPolicyCreateUsesSafeUniverse(
  instruction:
    | {
        data: Buffer | Uint8Array;
      }
    | undefined
) {
  const policyCreate = decodeGeneratedPolicyCreate(instruction);
  expectEarnSetupPolicyPayloadUsesSafeUniverse(
    policyCreate.policyCreationPayload
  );
}

function expectEarnPolicyInitializationUsesSafeUniverse(args: {
  finalizePrepared?: {
    instructions: readonly TransactionInstruction[];
    lookupTableAccounts?: readonly AddressLookupTableAccount[];
  } | null;
  setupPrepared:
    | {
        instructions: readonly TransactionInstruction[];
        lookupTableAccounts?: readonly AddressLookupTableAccount[];
      }
    | null
    | undefined;
}) {
  expect(args.setupPrepared).toBeTruthy();
  expect(args.setupPrepared?.instructions).toHaveLength(1);
  expect(
    serializedPreparedLength({
      instructions: args.setupPrepared!.instructions,
      lookupTableAccounts: args.setupPrepared!.lookupTableAccounts,
    })
  ).toBeLessThanOrEqual(PACKET_DATA_SIZE);

  if (args.finalizePrepared) {
    expectEarnRoutePolicyCreateUsesSafeUniverse(
      args.setupPrepared!.instructions[0]
    );
    expect(args.finalizePrepared.instructions).toHaveLength(1);
    expectEarnSetupPolicyCreateUsesSafeUniverse(
      args.finalizePrepared.instructions[0]
    );
    expect(
      serializedPreparedLength({
        instructions: args.finalizePrepared.instructions,
        lookupTableAccounts: args.finalizePrepared.lookupTableAccounts,
      })
    ).toBeLessThanOrEqual(PACKET_DATA_SIZE);
  } else {
    expectEarnRoutePolicyCreateUsesSafeUniverse(
      args.setupPrepared!.instructions[0]
    );
  }
}

describe("root Settings signer changes", () => {
  test("builds a root AddSigner settings action", async () => {
    const getAccountInfo = mock(async (_address: PublicKey) =>
      createSerializedSettingsAccount()
    );
    const client = createSmartAccountVaultsClient({
      connection: { getAccountInfo } as never,
      programId,
    });

    const result = await client.prepareAddRootSigner({
      creator: walletAddress,
      feePayer,
      settingsPda,
      signer: backendSigner,
    });

    expect(result.prepared.instructions).toHaveLength(1);
    expect(result.transactionIndex).toBe(BigInt(1));
    const actions = decodeGeneratedSettingsActions(
      result.prepared.instructions[0]
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.__kind).toBe("AddSigner");
    if (actions[0]?.__kind !== "AddSigner") {
      throw new Error("Expected AddSigner action.");
    }
    expect(actions[0].newSigner.key.toBase58()).toBe(backendSigner.toBase58());
    expect(actions[0].newSigner.permissions.mask).toBe(7);
  });

  test("builds a root RemoveSigner settings action", async () => {
    const getAccountInfo = mock(async (_address: PublicKey) =>
      createSerializedSettingsAccount()
    );
    const client = createSmartAccountVaultsClient({
      connection: { getAccountInfo } as never,
      programId,
    });

    const result = await client.prepareRemoveRootSigner({
      creator: walletAddress,
      feePayer,
      settingsPda,
      signer: backendSigner,
    });

    expect(result.prepared.instructions).toHaveLength(1);
    expect(result.transactionIndex).toBe(BigInt(1));
    const actions = decodeGeneratedSettingsActions(
      result.prepared.instructions[0]
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.__kind).toBe("RemoveSigner");
    if (actions[0]?.__kind !== "RemoveSigner") {
      throw new Error("Expected RemoveSigner action.");
    }
    expect(actions[0].oldSigner.toBase58()).toBe(backendSigner.toBase58());
  });
});

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
    expectEarnPolicyInitializationUsesSafeUniverse({
      finalizePrepared: result.policyFinalizePrepared,
      setupPrepared: result.policySetupPrepared,
    });
    expectInstructionAccountMeta(
      result.policySetupPrepared?.instructions[0],
      result.policy.account,
      { isSigner: false, isWritable: true }
    );
    expectInstructionAccountMeta(
      result.policyFinalizePrepared?.instructions[0],
      result.setupPolicy!.account,
      { isSigner: false, isWritable: true }
    );
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

    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[3]);
    expectIncludesKaminoSetupAccount(result.prepared.instructions[3]);
    expect(result.policy.seed).toBe(BigInt(7));
    expect(result.policy.sameMintInstructionConstraintIndexes).toEqual([0, 1]);
    expect(result.setupPolicy?.seed).toBe(BigInt(8));
    expect(result.setupPolicy?.initObligationInstructionConstraintIndex).toBe(
      0
    );
    expect(result.vault.accountIndex).toBe(1);
    expect(result.vault.collateralAta?.toBase58()).toBe(
      kaminoCollateralAta.toBase58()
    );
    expect(result.vault.pubkey.toBase58()).toBe(deriveVault().toBase58());
    expect(result.targetReserve.reserve.toBase58()).toBe(
      kaminoReserve.toBase58()
    );
    expect(result.targetReserve.obligation.toBase58()).toBe(
      deriveKaminoVanillaObligation(
        result.vault.pubkey,
        result.targetReserve.market
      ).toBase58()
    );
    expect(result.persistence).toMatchObject({
      cluster: "mainnet-beta",
      delegatedSigner: backendSigner.toBase58(),
      policyId: "7",
      policyInitialization: "create",
      policySeed: "7",
      principalAmountRaw: "1000000",
      riskProfile: RiskBasket.Safe,
      stableMints: getStablecoinMintsForCluster(LoyalCluster.MainnetBeta).map(
        (mint) => mint.toBase58()
      ),
      kaminoMarkets: getRiskBasketMarketsForCluster(
        LoyalCluster.MainnetBeta,
        RiskBasket.Safe
      ).map((market) => market.toBase58()),
      vaultIndex: 1,
    });
    expect(result.persistence).toMatchObject({
      setupPolicyId: "8",
      setupPolicySeed: "8",
      setupPolicyAccount: result.setupPolicy?.account.toBase58(),
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
        setupPolicy: {
          account: setupPolicyAccount,
          seed: BigInt(8),
        },
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
      setupPolicySeed: "8",
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
    expectEarnPolicyInitializationUsesSafeUniverse({
      finalizePrepared: result.finalizePrepared,
      setupPrepared: result.prepared,
    });
    expect(result.policy.seed).toBe(BigInt(7));
    expect(result.vault).toMatchObject({
      accountIndex: 1,
    });
    expect(result.vault.pubkey.toBase58()).toBe(deriveVault().toBase58());
    expect(result.targetReserve.reserve.toBase58()).toBe(
      kaminoReserve.toBase58()
    );
    expect(result.targetReserve.obligation.toBase58()).toBe(
      deriveKaminoVanillaObligation(
        result.vault.pubkey,
        result.targetReserve.market
      ).toBase58()
    );
    expect(result.persistence).toMatchObject({
      cluster: "mainnet-beta",
      delegatedSigner: backendSigner.toBase58(),
      liquidityMint: STABLECOIN_MINTS[Stablecoin.USDC].toBase58(),
      riskProfile: RiskBasket.Safe,
      routeModes: ["same_mint_kamino"],
      policyAccount: result.policy.account.toBase58(),
      policyId: "7",
      policySeed: "7",
      settings: settingsPda.toBase58(),
      stableMints: getStablecoinMintsForCluster(LoyalCluster.MainnetBeta).map(
        (mint) => mint.toBase58()
      ),
      kaminoMarkets: getRiskBasketMarketsForCluster(
        LoyalCluster.MainnetBeta,
        RiskBasket.Safe
      ).map((market) => market.toBase58()),
      targetReserve: kaminoReserve.toBase58(),
      universePreset: "canonical_stable_kamino",
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
    expect("policyUpdatePrepared" in result).toBe(false);
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
            data: [
              createSimulatedTokenAccountData(BigInt(1_000_002)),
              "base64",
            ],
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
    const simulateOptions = (
      simulateTransaction.mock.calls[0] as unknown[]
    )?.[1];
    expect(simulateOptions).toMatchObject({
      replaceRecentBlockhash: true,
      sigVerify: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fetchCalls = fetchMock.mock.calls as unknown as Array<
      [unknown, RequestInit]
    >;
    expect(JSON.parse((fetchCalls[0]?.[1].body as string) ?? "{}").amount).toBe(
      "1"
    );
    expect(JSON.parse((fetchCalls[1]?.[1].body as string) ?? "{}").amount).toBe(
      "1.000001"
    );
    expect(getTokenAccountBalance).toHaveBeenCalledTimes(2);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );
    expect(
      result.prepared.instructions
        .slice(1)
        .map((instruction) => instruction.programId.toBase58())
    ).toEqual([
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
    expectInstructionAccountMeta(
      result.prepared.instructions[3],
      walletAddress,
      {
        isWritable: true,
      }
    );
    expectInstructionAccountMeta(
      result.prepared.instructions[3],
      deriveVault(),
      {
        isWritable: true,
      }
    );
    expectInstructionAccountMeta(
      result.prepared.instructions[4],
      result.policy.account,
      { isWritable: true }
    );
    expect(result.mode).toBe("full");
    expect(result.targetReserve.obligation.toBase58()).toBe(
      deriveKaminoVanillaObligation(
        result.vault.pubkey,
        result.targetReserve.market
      ).toBase58()
    );
    expect(result.persistence).toMatchObject({
      mode: "full",
      kaminoWithdrawAmountRaw: "1000001",
      vaultCollateralCleanupIncluded: true,
      vaultUsdcRemainderRaw: "1",
      walletTransferAmountRaw: "1000002",
      withdrawnAmountRaw: "1000000",
    });
  });

  test("includes idle vault USDC when full withdraw simulation only returns redeemed Kamino liquidity", async () => {
    const fetchMock = mockKaminoWithdrawInstruction();
    const vaultCollateralAta = getAssociatedTokenAddressSync(
      kaminoReserveCollateralMint,
      deriveVault(),
      true,
      TOKEN_PROGRAM_ID
    );
    const kaminoRedeemableAmountRaw = BigInt(404_324_176);
    const vaultUsdcRemainderRaw = BigInt(75_676_540);
    const getTokenAccountBalance = mock(async (account: PublicKey) => {
      if (account.equals(vaultCollateralAta)) {
        return {
          context: { slot: 1 },
          value: {
            amount: "388709978",
            decimals: 6,
            uiAmount: 388.709978,
            uiAmountString: "388.709978",
          },
        };
      }
      expect(account.toBase58()).toBe(deriveVaultUsdcAta().toBase58());
      return {
        context: { slot: 1 },
        value: {
          amount: vaultUsdcRemainderRaw.toString(),
          decimals: 6,
          uiAmount: 75.67654,
          uiAmountString: "75.676540",
        },
      };
    });
    const getAccountInfo = mock(async (account: PublicKey) => {
      if (account.equals(kaminoReserve)) {
        return createSerializedKaminoReserveAccount({
          collateralSupplyRaw: BigInt(388_709_978),
          liquidityAvailableAmountRaw: kaminoRedeemableAmountRaw + BigInt(1),
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
            data: [
              createSimulatedTokenAccountData(kaminoRedeemableAmountRaw),
              "base64",
            ],
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
      amountRaw: BigInt(480_000_000),
      mode: "full",
      yieldRoutingPolicy: {
        account: policyAccount,
        seed: BigInt(7),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fetchCalls = fetchMock.mock.calls as unknown as Array<
      [unknown, RequestInit]
    >;
    expect(JSON.parse((fetchCalls[0]?.[1].body as string) ?? "{}").amount).toBe(
      "480"
    );
    expect(JSON.parse((fetchCalls[1]?.[1].body as string) ?? "{}").amount).toBe(
      "404.324176"
    );
    expect(result.persistence).toMatchObject({
      mode: "full",
      kaminoWithdrawAmountRaw: kaminoRedeemableAmountRaw.toString(),
      vaultUsdcRemainderRaw: vaultUsdcRemainderRaw.toString(),
      walletTransferAmountRaw: "480000716",
      withdrawnAmountRaw: "480000000",
    });
  });

  test("splits autodeposit teardown from full withdraws", async () => {
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
            data: [
              createSimulatedTokenAccountData(BigInt(1_000_002)),
              "base64",
            ],
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
      autodepositClose: {
        policy: autodepositPolicyAccount,
        recurringDelegation,
      },
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.autodepositClosePrepared?.prepared.instructions).toHaveLength(
      2
    );
    expect(
      result.autodepositClosePrepared?.prepared.instructions[0]?.programId.toBase58()
    ).toBe(SUBSCRIPTIONS_PROGRAM_ID.toBase58());
    expect(
      result.autodepositClosePrepared?.prepared.instructions[1]?.programId.toBase58()
    ).toBe(programId.toBase58());
    expectInstructionAccountMeta(
      result.autodepositClosePrepared!.prepared.instructions[1],
      autodepositPolicyAccount,
      { isWritable: true }
    );
    expect("policyUpdatePrepared" in result).toBe(false);
    expect(result.prepared.instructions).toHaveLength(5);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );
    expect(result.prepared.instructions[1]?.programId.toBase58()).toBe(
      programId.toBase58()
    );
    expect(
      result.prepared.instructions
        .slice(1)
        .map((instruction) => instruction.programId.toBase58())
    ).toEqual([
      programId.toBase58(),
      programId.toBase58(),
      programId.toBase58(),
      programId.toBase58(),
    ]);
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[1]);
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[2]);
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[3]);
    expectInstructionAccountMeta(
      result.prepared.instructions[4],
      result.policy.account,
      { isWritable: true }
    );
    expect(result.persistence.autodepositClose).toMatchObject({
      cluster: "mainnet-beta",
      delegatedSigner: backendSigner.toBase58(),
      policyAccount: autodepositPolicyAccount.toBase58(),
      recurringDelegation: recurringDelegation.toBase58(),
      settings: settingsPda.toBase58(),
      vaultIndex: 1,
      walletAddress: walletAddress.toBase58(),
    });
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

    expect("policyUpdatePrepared" in result).toBe(false);
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

  test("cold start initializes only the subscription authority", async () => {
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
    expect(result.prepared.instructions).toHaveLength(1);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      SUBSCRIPTIONS_PROGRAM_ID.toBase58()
    );
    expect(result.persistence).toMatchObject({
      delegatedSigner: backendSigner.toBase58(),
      policyAccount: result.policy.account?.toBase58(),
      policySeed: "1",
      subscriptionDelegatee: deriveVault().toBase58(),
      subscriptionAuthorityInitialization: "required",
      walletAddress: walletAddress.toBase58(),
    });
  });

  test("warm follow-up creates the policy and recurring delegation together", async () => {
    let nonSettingsLookupCount = 0;
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(settingsPda)) {
        return createSerializedSettingsAccount();
      }
      nonSettingsLookupCount += 1;
      if (nonSettingsLookupCount === 1) {
        return createSerializedSubscriptionAuthorityAccount(BigInt(7));
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

    expect(result.stage).toBe("create_recurring_delegation");
    expect(result.prepared.instructions).toHaveLength(3);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      programId.toBase58()
    );
    expectPolicyCreateSigner(result.prepared.instructions[0], backendSigner);
    expect(result.prepared.instructions[1]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );
    expect(result.prepared.instructions[2]?.programId.toBase58()).toBe(
      SUBSCRIPTIONS_PROGRAM_ID.toBase58()
    );
    expect(result.persistence).toMatchObject({
      policyAccount: result.policy.account?.toBase58(),
      policySeed: "1",
      subscriptionAuthorityInitialization: "exists",
    });
  });

  test("existing policy with missing delegation skips duplicate policy creation", async () => {
    let nonSettingsLookupCount = 0;
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(settingsPda)) {
        return createSerializedSettingsAccount();
      }
      nonSettingsLookupCount += 1;
      if (nonSettingsLookupCount === 1) {
        return createSerializedSubscriptionAuthorityAccount(BigInt(7));
      }
      if (nonSettingsLookupCount === 2) {
        return createSerializedEarnPolicyAccount();
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

    expect(result.stage).toBe("create_recurring_delegation");
    expect(result.prepared.instructions).toHaveLength(2);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );
    expect(result.prepared.instructions[1]?.programId.toBase58()).toBe(
      SUBSCRIPTIONS_PROGRAM_ID.toBase58()
    );
  });

  test("rejects setup when policy and recurring delegation already exist", async () => {
    let nonSettingsLookupCount = 0;
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(settingsPda)) {
        return createSerializedSettingsAccount();
      }
      nonSettingsLookupCount += 1;
      if (nonSettingsLookupCount === 1) {
        return createSerializedSubscriptionAuthorityAccount(BigInt(7));
      }
      if (nonSettingsLookupCount === 2) {
        return createSerializedEarnPolicyAccount();
      }
      return createSerializedRecurringDelegationAccount();
    });
    const client = createSmartAccountVaultsClient({
      connection: { getAccountInfo } as never,
      programId,
    });

    await expect(
      client.prepareEarnUsdcAutodepositSetup({
        settingsPda,
        walletAddress,
        feePayer,
        signer: walletAddress,
        policySigner: backendSigner,
        amountRaw: BigInt(1_000_000),
        nonce: BigInt(42),
      })
    ).rejects.toThrow(
      "Autodeposit policy and recurring delegation already exist."
    );
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
      recurringDelegation: new PublicKey("11111111111111111111111111111116"),
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
      recurringDelegation: new PublicKey("11111111111111111111111111111116"),
      amountRaw: BigInt(100_000),
    });

    expect(result.prepared.instructions).toHaveLength(1);
    expectInstructionAccountMeta(
      result.prepared.instructions[0],
      backendSigner,
      { isSigner: true }
    );
    expectInstructionAccountMeta(
      result.prepared.instructions[0],
      deriveVault(),
      {
        isSigner: false,
      }
    );
    expect(result.persistence).toMatchObject({
      amountRaw: "100000",
      delegatedSigner: backendSigner.toBase58(),
      policyAccount: policyAccount.toBase58(),
      walletAddress: walletAddress.toBase58(),
    });
  });
});
