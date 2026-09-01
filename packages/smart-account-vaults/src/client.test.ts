import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  deriveSubscriptionAuthority,
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
  compilePreparedOperation,
  pda,
  Policy,
  Settings,
} from "@loyal-labs/loyal-smart-accounts-core";
import {
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  decodeApproveCheckedInstruction,
  decodeRevokeInstruction,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
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

import {
  calculateKaminoCollateralAmountForRedeemableLiquidityRaw,
  calculateKaminoRedeemableLiquidityAmountRaw,
  createEarnVaultTokenCleanupInstructions,
  createSmartAccountVaultsClient,
  EARN_WITHDRAW_REQUIRED_ACCOUNT_MISSING_CODE,
  parseKaminoObligationAccount,
  parseKaminoObligationDepositedCollateralAmountRaw,
  parseKaminoObligationDeposits,
} from "./client";
import { combineSmartAccountNativeSolRequirements } from "./native-sol-requirement";

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
const kaminoObligationDiscriminator = Buffer.from([
  168, 206, 141, 106, 88, 76, 172, 167,
]);
const kaminoReserveOffsetBase = 8;
const kaminoReserveOffsets = {
  collateralMintPubkey: kaminoReserveOffsetBase + 2552,
  collateralSupplyVault: kaminoReserveOffsetBase + 2592,
  farmCollateral: kaminoReserveOffsetBase + 56,
  farmDebt: kaminoReserveOffsetBase + 88,
  lendingMarket: kaminoReserveOffsetBase + 24,
  liquidityAvailableAmount: kaminoReserveOffsetBase + 216,
  liquidityMintPubkey: kaminoReserveOffsetBase + 120,
  liquiditySupplyVault: kaminoReserveOffsetBase + 152,
  liquidityTokenProgram: kaminoReserveOffsetBase + 400,
  collateralMintTotalSupply: kaminoReserveOffsetBase + 2584,
} as const;
const kaminoObligationOffsets = {
  depositedAmount: 32,
  deposits: 96,
  lendingMarket: 32,
  owner: 64,
  slotSize: 136,
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
  overrides: {
    // Emits the current 14-account withdraw shape (market at 2, collateral
    // token program at 11, liquidity token program at 12) instead of the
    // legacy order the older fixtures model.
    currentAccountOrder?: boolean;
    duplicateWithdrawInstruction?: boolean;
    executionReserve?: PublicKey;
    instructionAmountRaw?: (requestedLiquidityAmountRaw: bigint) => bigint;
    liquidityMint?: PublicKey;
    liquidityTokenProgram?: PublicKey;
    vaultUsdcAta?: PublicKey;
  } = {}
) {
  const fetchMock = mock(async (_url: unknown, init: RequestInit) => {
    const amountRaw = decimalAmountToRaw(
      JSON.parse((init.body as string) ?? "{}").amount
    );
    const reserveCollateralMint = kaminoReserveCollateralMint;
    const vaultCollateralAta = getAssociatedTokenAddressSync(
      reserveCollateralMint,
      deriveVault(),
      true,
      TOKEN_PROGRAM_ID
    );
    const liquidityMint =
      overrides.liquidityMint ?? STABLECOIN_MINTS[Stablecoin.USDC];
    const liquidityTokenProgram =
      overrides.liquidityTokenProgram ?? TOKEN_PROGRAM_ID;
    const defaultVaultLiquidityAta = overrides.liquidityMint
      ? getAssociatedTokenAddressSync(
          liquidityMint,
          deriveVault(),
          true,
          liquidityTokenProgram
        )
      : deriveVaultUsdcAta();
    const createInstruction = (rawAmount: bigint) => {
      const instructionData = Buffer.alloc(16);
      Buffer.from([235, 52, 119, 152, 149, 197, 20, 7]).copy(
        instructionData,
        0
      );
      instructionData.writeBigUInt64LE(rawAmount, 8);
      if (overrides.currentAccountOrder) {
        return {
          accounts: [
            { address: deriveVault().toBase58(), role: "WRITABLE_SIGNER" },
            { address: "11111111111111111111111111111111", role: "WRITABLE" },
            { address: kaminoMarket.toBase58(), role: "READONLY" },
            { address: "11111111111111111111111111111111", role: "READONLY" },
            {
              address: (overrides.executionReserve ?? kaminoReserve).toBase58(),
              role: "WRITABLE",
            },
            { address: liquidityMint.toBase58(), role: "READONLY" },
            { address: vaultCollateralAta.toBase58(), role: "WRITABLE" },
            { address: reserveCollateralMint.toBase58(), role: "WRITABLE" },
            {
              address: kaminoReserveLiquiditySupply.toBase58(),
              role: "WRITABLE",
            },
            {
              address: (
                overrides.vaultUsdcAta ?? defaultVaultLiquidityAta
              ).toBase58(),
              role: "WRITABLE",
            },
            { address: kaminoProgram.toBase58(), role: "READONLY" },
            { address: TOKEN_PROGRAM_ID.toBase58(), role: "READONLY" },
            { address: liquidityTokenProgram.toBase58(), role: "READONLY" },
            {
              address: "Sysvar1nstructions1111111111111111111111111",
              role: "READONLY",
            },
          ],
          data: instructionData.toString("base64"),
          programAddress: kaminoProgram.toBase58(),
        };
      }
      return {
        accounts: [
          { address: deriveVault().toBase58(), role: "WRITABLE_SIGNER" },
          { address: kaminoMarket.toBase58(), role: "READONLY" },
          {
            address: (overrides.executionReserve ?? kaminoReserve).toBase58(),
            role: "WRITABLE",
          },
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
      };
    };
    return new Response(
      JSON.stringify({
        instructions: overrides.duplicateWithdrawInstruction
          ? [
              createInstruction(
                (overrides.instructionAmountRaw?.(amountRaw) ?? amountRaw) /
                  BigInt(2)
              ),
              createInstruction(
                (overrides.instructionAmountRaw?.(amountRaw) ?? amountRaw) /
                  BigInt(2)
              ),
            ]
          : [
              createInstruction(
                overrides.instructionAmountRaw?.(amountRaw) ?? amountRaw
              ),
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

function deriveWalletUsdcAta() {
  return getAssociatedTokenAddressSync(
    STABLECOIN_MINTS[Stablecoin.USDC],
    walletAddress,
    false,
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

// Sweep policies carry subscriptions-program instruction constraints — the
// on-chain fingerprint the autodeposit setup/close guards verify (ASK-1802).
function createSerializedSweepPolicyAccount(seed = new BN(3)) {
  const [data] = Policy.fromArgs({
    bump: 255,
    expiration: null,
    policyState: {
      __kind: "ProgramInteraction",
      fields: [
        {
          accountIndex: 1,
          instructionsConstraints: [
            {
              programId: SUBSCRIPTIONS_PROGRAM_ID,
              accountConstraints: [],
              dataConstraints: [],
            },
          ],
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
  const data = Buffer.alloc(kaminoReserveOffsets.collateralSupplyVault + 32);
  kaminoReserveDiscriminator.copy(data, 0);
  kaminoMarket.toBuffer().copy(data, kaminoReserveOffsets.lendingMarket);
  PublicKey.default.toBuffer().copy(data, kaminoReserveOffsets.farmCollateral);
  PublicKey.default.toBuffer().copy(data, kaminoReserveOffsets.farmDebt);
  STABLECOIN_MINTS[Stablecoin.USDC]
    .toBuffer()
    .copy(data, kaminoReserveOffsets.liquidityMintPubkey);
  kaminoReserveLiquiditySupply
    .toBuffer()
    .copy(data, kaminoReserveOffsets.liquiditySupplyVault);
  TOKEN_PROGRAM_ID.toBuffer().copy(
    data,
    kaminoReserveOffsets.liquidityTokenProgram
  );
  kaminoReserveCollateralMint
    .toBuffer()
    .copy(data, kaminoReserveOffsets.collateralMintPubkey);
  PublicKey.default
    .toBuffer()
    .copy(data, kaminoReserveOffsets.collateralSupplyVault);
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

function createSerializedKaminoObligationData(args: {
  deposits: Array<{
    amountRaw: bigint;
    reserve: PublicKey;
    slotIndex: number;
  }>;
  lendingMarket?: PublicKey;
  owner?: PublicKey;
}): Buffer {
  const data = Buffer.alloc(
    kaminoObligationOffsets.deposits + kaminoObligationOffsets.slotSize * 8
  );
  kaminoObligationDiscriminator.copy(data, 0);
  (args.lendingMarket ?? kaminoMarket)
    .toBuffer()
    .copy(data, kaminoObligationOffsets.lendingMarket);
  (args.owner ?? deriveVault())
    .toBuffer()
    .copy(data, kaminoObligationOffsets.owner);

  for (const deposit of args.deposits) {
    const offset =
      kaminoObligationOffsets.deposits +
      deposit.slotIndex * kaminoObligationOffsets.slotSize;
    deposit.reserve.toBuffer().copy(data, offset);
    data.writeBigUInt64LE(
      deposit.amountRaw,
      offset + kaminoObligationOffsets.depositedAmount
    );
  }

  return data;
}

function createTokenAccountData(args: {
  amountRaw: bigint;
  delegatedAmountRaw?: bigint;
  delegate?: PublicKey;
  mint?: PublicKey;
  owner?: PublicKey;
}): Buffer {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      amount: args.amountRaw,
      closeAuthority: PublicKey.default,
      closeAuthorityOption: 0,
      delegatedAmount: args.delegatedAmountRaw ?? BigInt(0),
      delegate: args.delegate ?? PublicKey.default,
      delegateOption: args.delegate ? 1 : 0,
      isNative: BigInt(0),
      isNativeOption: 0,
      mint: args.mint ?? STABLECOIN_MINTS[Stablecoin.USDC],
      owner: args.owner ?? deriveVault(),
      state: 1,
    },
    data
  );
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

function expectAutodepositApproveCheckedInstruction(
  instruction: TransactionInstruction | undefined
) {
  expect(instruction?.programId.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
  const decoded = decodeApproveCheckedInstruction(instruction!);
  expect(decoded.keys.account.pubkey.toBase58()).toBe(
    deriveWalletUsdcAta().toBase58()
  );
  expect(decoded.keys.mint.pubkey.toBase58()).toBe(
    STABLECOIN_MINTS[Stablecoin.USDC].toBase58()
  );
  expect(decoded.keys.delegate.pubkey.toBase58()).toBe(
    deriveSubscriptionAuthority(
      walletAddress,
      STABLECOIN_MINTS[Stablecoin.USDC]
    ).toBase58()
  );
  expect(decoded.keys.owner.pubkey.toBase58()).toBe(walletAddress.toBase58());
  expect(decoded.keys.owner.isSigner).toBe(true);
  expect(decoded.data.amount).toBe((BigInt(1) << BigInt(64)) - BigInt(1));
  expect(decoded.data.decimals).toBe(6);
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
  const depositMintConstraint = depositConstraint!.accountConstraints.find(
    (constraint) => constraint.accountIndex === 5
  );
  expect(expectedStableMints).toHaveLength(6);
  expect(depositMintConstraint?.owner).toBeNull();
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

describe("Kamino account parsers", () => {
  test("enumerates positive obligation deposits with the current Klend slot stride", () => {
    const secondReserve = new PublicKey("1111111111111111111111111111111C");
    const data = createSerializedKaminoObligationData({
      deposits: [
        {
          amountRaw: BigInt(22_512_000),
          reserve: kaminoReserve,
          slotIndex: 0,
        },
        {
          amountRaw: BigInt(3_002_000),
          reserve: secondReserve,
          slotIndex: 1,
        },
      ],
    });

    const account = parseKaminoObligationAccount(data);
    expect(account.lendingMarket.toBase58()).toBe(kaminoMarket.toBase58());
    expect(account.owner.toBase58()).toBe(deriveVault().toBase58());
    expect(parseKaminoObligationDeposits(data)).toEqual(account.deposits);
    expect(
      account.deposits.map((deposit) => ({
        amountRaw: deposit.depositedAmountRaw.toString(),
        reserve: deposit.reserve.toBase58(),
        slotIndex: deposit.slotIndex,
      }))
    ).toEqual([
      {
        amountRaw: "22512000",
        reserve: kaminoReserve.toBase58(),
        slotIndex: 0,
      },
      {
        amountRaw: "3002000",
        reserve: secondReserve.toBase58(),
        slotIndex: 1,
      },
    ]);
    expect(
      parseKaminoObligationDepositedCollateralAmountRaw({
        data,
        reserve: secondReserve,
      })
    ).toBe(BigInt(3_002_000));
  });
});

describe("root Settings signer changes", () => {
  test("builds a root AddSigner settings action", async () => {
    const getAccountInfo = mock(async (_address: PublicKey) =>
      createSerializedSettingsAccount()
    );
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo,
        getProgramAccounts: mock(async () => []),
      } as never,
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
    expect(result.policySetupPrepared?.simulationDiagnostics).toEqual({
      includedPolicyAccounts: [result.policy.account.toBase58()],
      kind: "earnPolicyCreateMissingAccount",
      policyAccount: result.policy.account.toBase58(),
      policySeed: "7",
      policyStage: "route",
      programId: programId.toBase58(),
      settingsPda: settingsPda.toBase58(),
    });
    expect(result.policyFinalizePrepared?.simulationDiagnostics).toEqual({
      includedPolicyAccounts: [result.setupPolicy!.account.toBase58()],
      kind: "earnPolicyCreateMissingAccount",
      policyAccount: result.setupPolicy!.account.toBase58(),
      policySeed: "8",
      policyStage: "setup",
      programId: programId.toBase58(),
      settingsPda: settingsPda.toBase58(),
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

  test("reports cold deposit native SOL required for missing setup accounts", async () => {
    mockKaminoDepositInstruction();
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(settingsPda)) {
        return createSerializedSettingsAccount(new BN(6));
      }
      if (address.equals(kaminoReserve)) {
        return createSerializedKaminoReserveAccount({
          collateralSupplyRaw: BigInt(1_000_000),
          liquidityAvailableAmountRaw: BigInt(1_000_000),
        });
      }
      return null;
    });
    const getMultipleAccountsInfo = mock(async (addresses: PublicKey[]) =>
      addresses.map(() => null)
    );
    const getProgramAccounts = mock(async () => []);
    const getMinimumBalanceForRentExemption = mock(
      async (space: number) => space + 1_000
    );
    const getLatestBlockhash = mock(async () => ({
      blockhash: "11111111111111111111111111111111",
    }));
    const getFeeForMessage = mock(async () => ({ value: 99_999 }));
    const getBalance = mock(async () => 0);
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo,
        getBalance,
        getFeeForMessage,
        getLatestBlockhash,
        getMinimumBalanceForRentExemption,
        getMultipleAccountsInfo,
        getProgramAccounts,
      } as never,
      programId,
    });

    const result = await client.prepareEarnUsdcDeposit({
      settingsPda,
      walletAddress,
      feePayer,
      policySigner: backendSigner,
      amountRaw: BigInt(1_000_000),
    });

    const kinds = result.nativeSolRequirement.items.map((item) => item.kind);
    expect(result.nativeSolRequirement.canProceed).toBe(false);
    expect(kinds.filter((kind) => kind === "policy_rent")).toHaveLength(2);
    expect(kinds).toContain("token_account_rent");
    expect(kinds).toContain("kamino_setup_top_up");
    expect(kinds).toContain("transaction_fee");
    expect(getFeeForMessage).not.toHaveBeenCalled();
    expect(getLatestBlockhash).not.toHaveBeenCalled();
    expect(getMinimumBalanceForRentExemption).not.toHaveBeenCalled();
    expect(
      result.nativeSolRequirement.items
        .filter((item) => item.kind === "transaction_fee")
        .map((item) => item.lamports)
    ).toEqual(["5000", "5000", "5000"]);
    expect(BigInt(result.nativeSolRequirement.deficitLamports)).toBe(
      BigInt(result.nativeSolRequirement.requiredLamports)
    );
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
    expect(
      result.nativeSolRequirement.items.some(
        (item) => item.kind === "policy_rent"
      )
    ).toBe(false);
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

  test("returns a native SOL deficit when the payer cannot fund Kamino setup rent", async () => {
    mockKaminoDepositInstruction();
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo: mock(async (address: PublicKey) =>
          address.equals(kaminoReserve)
            ? createSerializedKaminoReserveAccount({
                collateralSupplyRaw: BigInt(1_000_000),
                liquidityAvailableAmountRaw: BigInt(1_000_000),
              })
            : null
        ),
        getBalance: mock(async () => 0),
      } as never,
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
        account: new PublicKey("11111111111111111111111111111117"),
        seed: BigInt(7),
      },
    });

    expect(result.nativeSolRequirement.canProceed).toBe(false);
    expect(result.nativeSolRequirement.items).toContainEqual(
      expect.objectContaining({
        kind: "kamino_setup_top_up",
        lamports: "39532800",
      })
    );
    expect(
      BigInt(result.nativeSolRequirement.deficitLamports) > BigInt(39_532_800)
    ).toBe(true);
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
    expect(result.prepared.simulationDiagnostics).toEqual({
      includedPolicyAccounts: [result.policy.account.toBase58()],
      kind: "earnPolicyCreateMissingAccount",
      policyAccount: result.policy.account.toBase58(),
      policySeed: "7",
      policyStage: "route",
      programId: programId.toBase58(),
      settingsPda: settingsPda.toBase58(),
    });
    expect(result.finalizePrepared?.simulationDiagnostics).toEqual({
      includedPolicyAccounts: [result.setupPolicy.account.toBase58()],
      kind: "earnPolicyCreateMissingAccount",
      policyAccount: result.setupPolicy.account.toBase58(),
      policySeed: "8",
      policyStage: "setup",
      programId: programId.toBase58(),
      settingsPda: settingsPda.toBase58(),
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

  test("prepares separate canonical cross-mint policy shards", async () => {
    const getAccountInfo = mock(async (address: PublicKey) =>
      address.equals(settingsPda)
        ? createSerializedSettingsAccount(new BN(6))
        : null
    );
    const getProgramAccounts = mock(async () => []);
    const rpcRequest = mock(async () => ({ result: [] }));
    const client = createSmartAccountVaultsClient({
      connection: {
        _rpcRequest: rpcRequest,
        getAccountInfo,
        getMultipleAccountsInfo: mock(async () => []),
        getProgramAccounts,
      } as never,
      programId,
    });

    const result = await client.prepareEarnCrossMintSwapPolicies({
      settingsPda,
      walletAddress,
      signer: backendSigner,
      feePayer,
      maxSlippageBps: 100,
      dailySourceMintSpendingCap: BigInt(1_000_000_000),
    });

    expect(result.policies.map((policy) => policy.sourceShard)).toEqual([
      "classic",
      "token_2022",
    ]);
    expect(result.policies.map((policy) => policy.policy.seed)).toEqual([
      BigInt(7),
      BigInt(8),
    ]);
    for (const policy of result.policies) {
      expect(policy.prepared).toBeDefined();
      const create = decodeGeneratedPolicyCreate(
        policy.prepared?.instructions[0]
      );
      expect(create.policyCreationPayload.__kind).toBe("ProgramInteraction");
      if (create.policyCreationPayload.__kind !== "ProgramInteraction") {
        throw new Error("Expected ProgramInteraction policy payload.");
      }
      const [payload] = create.policyCreationPayload.fields;
      expect(payload.accountIndex).toBe(1);
      expect(payload.instructionsConstraints).toHaveLength(2);
      expect(
        payload.instructionsConstraints.map((constraint) =>
          constraint.accountConstraints.map((account) => account.accountIndex)
        )
      ).toEqual([
        [0, 2],
        [1, 5],
      ]);
      expect(payload.spendingLimits).toHaveLength(3);
      expect(
        payload.spendingLimits.map((limit) => limit.timeConstraints.period)
      ).toEqual([
        { __kind: "Daily" },
        { __kind: "Daily" },
        { __kind: "Daily" },
      ]);
      expect(policy.persistence).toMatchObject({
        dailySourceMintSpendingCap: "1000000000",
        delegatedSigner: backendSigner.toBase58(),
        maxSlippageBps: 100,
        settings: settingsPda.toBase58(),
        vaultIndex: 1,
        walletAddress: walletAddress.toBase58(),
      });
    }
    expect(getProgramAccounts).not.toHaveBeenCalled();
    expect(rpcRequest).not.toHaveBeenCalled();
  });

  test("reuses a finalized cross-mint policy with materialized spending usage", async () => {
    const initialClient = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo: mock(async (address: PublicKey) =>
          address.equals(settingsPda)
            ? createSerializedSettingsAccount(new BN(6))
            : null
        ),
        getMultipleAccountsInfo: mock(async () => []),
      } as never,
      programId,
    });
    const initial = await initialClient.prepareEarnCrossMintSwapPolicies({
      settingsPda,
      walletAddress,
      signer: backendSigner,
      feePayer,
      maxSlippageBps: 50,
      dailySourceMintSpendingCap: BigInt(300_000_000),
    });
    const runtimeTimestamp = new BN(1_786_936_896);
    const materializePolicy = (
      preparedPolicy: (typeof initial.policies)[number]
    ) => {
      const create = decodeGeneratedPolicyCreate(
        preparedPolicy.prepared?.instructions[0]
      );
      if (create.policyCreationPayload.__kind !== "ProgramInteraction") {
        throw new Error("Expected ProgramInteraction policy payload.");
      }
      const [payload] = create.policyCreationPayload.fields;
      const runtimeState = {
        __kind: "ProgramInteraction" as const,
        fields: [
          {
            ...payload,
            spendingLimits: [...payload.spendingLimits]
              .reverse()
              .map((limit) => ({
                ...limit,
                quantityConstraints: {
                  ...limit.quantityConstraints,
                  enforceExactQuantity: false,
                  maxPerUse: new BN(0),
                },
                timeConstraints: {
                  ...limit.timeConstraints,
                  accumulateUnused: false,
                  start: runtimeTimestamp,
                },
                usage: {
                  lastReset: runtimeTimestamp,
                  remainingInPeriod: limit.quantityConstraints.maxPerPeriod,
                },
              })),
          },
        ],
      };
      const [, bump] = pda.getPolicyPda({
        policySeed: Number(preparedPolicy.policy.seed),
        programId,
        settingsPda,
      });
      const [data] = Policy.fromArgs({
        bump,
        expiration: null,
        policyState: runtimeState as never,
        rentCollector: feePayer,
        seed: new BN(preparedPolicy.policy.seed.toString()),
        settings: settingsPda,
        signers: create.signers,
        staleTransactionIndex: new BN(0),
        start: runtimeTimestamp,
        threshold: create.threshold,
        timeLock: create.timeLock,
        transactionIndex: new BN(0),
      }).serialize();
      return {
        data,
        executable: false,
        lamports: 1,
        owner: programId,
        rentEpoch: 0,
      };
    };
    const classic = initial.policies[0];
    const token2022 = initial.policies[1];
    const finalizedClassic = materializePolicy(classic);
    const finalizedToken2022 = materializePolicy(token2022);
    const getProgramAccounts = mock(async () => []);
    const rpcRequest = mock(async () => ({ result: [] }));
    const getMultipleAccountsInfo = mock(async () => [finalizedClassic]);
    const resumedClient = createSmartAccountVaultsClient({
      connection: {
        _rpcRequest: rpcRequest,
        getAccountInfo: mock(async (address: PublicKey) =>
          address.equals(settingsPda)
            ? createSerializedSettingsAccount(new BN(7))
            : null
        ),
        getMultipleAccountsInfo,
        getProgramAccounts,
      } as never,
      programId,
    });

    const resumed = await resumedClient.prepareEarnCrossMintSwapPolicies({
      settingsPda,
      walletAddress,
      signer: backendSigner,
      feePayer,
      maxSlippageBps: 50,
      dailySourceMintSpendingCap: BigInt(300_000_000),
      projectedPolicies: [
        {
          account: classic.policy.account,
          lastSeenSlot: BigInt(123),
          seed: classic.policy.seed,
          sourceShard: "classic",
        },
      ],
    });

    expect(
      resumed.policies.map((entry) => ({
        existing: entry.existing,
        seed: entry.policy.seed,
        shard: entry.sourceShard,
      }))
    ).toEqual([
      { existing: true, seed: BigInt(7), shard: "classic" },
      { existing: false, seed: BigInt(8), shard: "token_2022" },
    ]);
    expect(getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    expect(getProgramAccounts).not.toHaveBeenCalled();
    expect(rpcRequest).not.toHaveBeenCalled();

    const completeClient = createSmartAccountVaultsClient({
      connection: {
        _rpcRequest: rpcRequest,
        getAccountInfo: mock(async (address: PublicKey) =>
          address.equals(settingsPda)
            ? createSerializedSettingsAccount(new BN(8))
            : null
        ),
        getMultipleAccountsInfo: mock(async () => [
          finalizedClassic,
          finalizedToken2022,
        ]),
        getProgramAccounts,
      } as never,
      programId,
    });
    const complete = await completeClient.prepareEarnCrossMintSwapPolicies({
      settingsPda,
      walletAddress,
      signer: backendSigner,
      feePayer,
      maxSlippageBps: 50,
      dailySourceMintSpendingCap: BigInt(300_000_000),
      projectedPolicies: [
        {
          account: classic.policy.account,
          seed: classic.policy.seed,
          sourceShard: "classic",
        },
        {
          account: token2022.policy.account,
          seed: token2022.policy.seed,
          sourceShard: "token_2022",
        },
      ],
    });
    expect(complete.policies.every((entry) => entry.existing)).toBe(true);
    expect(complete.policies.every((entry) => !entry.prepared)).toBe(true);

    const staleClient = createSmartAccountVaultsClient({
      connection: {
        _rpcRequest: rpcRequest,
        getAccountInfo: mock(async (address: PublicKey) =>
          address.equals(settingsPda)
            ? createSerializedSettingsAccount(new BN(7))
            : null
        ),
        getMultipleAccountsInfo: mock(async () => [null]),
        getProgramAccounts,
      } as never,
      programId,
    });
    await expect(
      staleClient.prepareEarnCrossMintSwapPolicies({
        settingsPda,
        walletAddress,
        signer: backendSigner,
        feePayer,
        maxSlippageBps: 50,
        dailySourceMintSpendingCap: BigInt(300_000_000),
        projectedPolicies: [
          {
            account: classic.policy.account,
            seed: classic.policy.seed,
            sourceShard: "classic",
          },
        ],
      })
    ).rejects.toThrow("is missing on-chain");
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

  test("[earn-withdraw-exact-output] converts direct-instruction liquidity to collateral exactly once", () => {
    const fractionScale = BigInt(1) << BigInt(60);
    const snapshot = {
      collateralSupplyRaw: BigInt(100_000_000),
      totalLiquiditySupplyScaled: BigInt(105_000_000) * fractionScale,
    };
    const collateralAmountRaw =
      calculateKaminoCollateralAmountForRedeemableLiquidityRaw({
        liquidityAmountRaw: BigInt(100_000_000),
        snapshot,
      });

    expect(collateralAmountRaw).toBe(BigInt(95_238_096));
    expect(
      calculateKaminoRedeemableLiquidityAmountRaw({
        collateralAmountRaw,
        snapshot,
      })
    ).toBeGreaterThanOrEqual(BigInt(100_000_000));
  });

  test("[earn-withdraw-exact-output] preserves partial liquidity intent across a non-1 exchange rate", async () => {
    const requestedLiquidityAmountRaw = BigInt(100_000_000);
    const collateralInstructionAmountRaw = BigInt(95_238_096);
    const fetchMock = mockKaminoWithdrawInstruction({
      instructionAmountRaw: () => collateralInstructionAmountRaw,
    });
    const simulateTransaction = mock(async () => ({
      value: {
        accounts: [
          {
            data: [
              createSimulatedTokenAccountData(requestedLiquidityAmountRaw),
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
        getAccountInfo: mock(async (account: PublicKey) =>
          account.equals(kaminoReserve)
            ? createSerializedKaminoReserveAccount({
                collateralSupplyRaw: BigInt(100_000_000),
                liquidityAvailableAmountRaw: BigInt(105_000_000),
              })
            : null
        ),
        getLatestBlockhash: mock(async () => ({
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 1,
        })),
        getTokenAccountBalance: mock(async () => ({
          context: { slot: 1 },
          value: {
            amount: "0",
            decimals: 6,
            uiAmount: 0,
            uiAmountString: "0",
          },
        })),
        simulateTransaction,
      } as never,
      programId,
    });
    const result = await client.prepareEarnUsdcWithdraw({
      settingsPda,
      walletAddress,
      feePayer,
      policySigner: backendSigner,
      amountRaw: requestedLiquidityAmountRaw,
      mode: "partial",
      yieldRoutingPolicy: {
        account: policyAccount,
        seed: BigInt(7),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchCall = fetchMock.mock.calls[0] as unknown as [
      unknown,
      RequestInit
    ];
    expect(JSON.parse((fetchCall[1].body as string) ?? "{}").amount).toBe(
      "100"
    );
    expect(simulateTransaction).toHaveBeenCalledTimes(1);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );
    expect(
      result.prepared.instructions.some((instruction) =>
        instruction.programId.equals(programId)
      )
    ).toBe(true);
    expect(result.policy.withdrawInstructionConstraintIndex).toBe(0);
    expect("policyUpdatePrepared" in result).toBe(false);
    expect(result.policy.sameMintInstructionConstraintIndexes).toEqual([0, 1]);
    expect(result.mode).toBe("partial");
    expect(result.amountRaw).toBe(requestedLiquidityAmountRaw);
    expect(result.persistence).toMatchObject({
      mode: "partial",
      delegatedSigner: backendSigner.toBase58(),
      kaminoWithdrawAmountRaw: collateralInstructionAmountRaw.toString(),
      policyId: "7",
      policySeed: "7",
      requestedWithdrawAmountRaw: requestedLiquidityAmountRaw.toString(),
      walletTransferAmountRaw: requestedLiquidityAmountRaw.toString(),
      withdrawnAmountRaw: requestedLiquidityAmountRaw.toString(),
      vaultIndex: 1,
    });
  });

  test("[earn-withdraw-exact-output] dynamically increases KTX collateral after a rounded-down simulation", async () => {
    const requestedLiquidityAmountRaw = BigInt(100_000_000);
    const requiredCollateralAmountRaw = BigInt(95_238_096);
    const fetchMock = mockKaminoWithdrawInstruction({
      instructionAmountRaw: () => requiredCollateralAmountRaw - BigInt(6),
    });
    let simulationCount = 0;
    const simulateTransaction = mock(async () => {
      simulationCount += 1;
      return {
        value: {
          accounts: [
            {
              data: [
                createSimulatedTokenAccountData(
                  simulationCount === 1
                    ? requestedLiquidityAmountRaw - BigInt(6)
                    : requestedLiquidityAmountRaw + BigInt(1)
                ),
                "base64",
              ],
            },
          ],
          err: null,
          logs: [],
        },
      };
    });
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo: mock(async (account: PublicKey) =>
          account.equals(kaminoReserve)
            ? createSerializedKaminoReserveAccount({
                collateralSupplyRaw: BigInt(100_000_000),
                liquidityAvailableAmountRaw: BigInt(105_000_000),
              })
            : null
        ),
        getLatestBlockhash: mock(async () => ({
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 1,
        })),
        getTokenAccountBalance: mock(async () => ({
          context: { slot: 1 },
          value: {
            amount: "0",
            decimals: 6,
            uiAmount: 0,
            uiAmountString: "0",
          },
        })),
        simulateTransaction,
      } as never,
      programId,
    });

    const result = await client.prepareEarnUsdcWithdraw({
      settingsPda,
      walletAddress,
      feePayer,
      policySigner: backendSigner,
      amountRaw: requestedLiquidityAmountRaw,
      mode: "partial",
      yieldRoutingPolicy: {
        account: policyAccount,
        seed: BigInt(7),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(simulateTransaction).toHaveBeenCalledTimes(2);
    expect(result.persistence).toMatchObject({
      kaminoWithdrawAmountRaw: (
        requiredCollateralAmountRaw + BigInt(1)
      ).toString(),
      requestedWithdrawAmountRaw: requestedLiquidityAmountRaw.toString(),
      walletTransferAmountRaw: requestedLiquidityAmountRaw.toString(),
      withdrawnAmountRaw: requestedLiquidityAmountRaw.toString(),
    });
  });

  test("[earn-withdraw-exact-output] rejects an underfilled partial simulation with a typed error", async () => {
    const requestedLiquidityAmountRaw = BigInt(100_000_000);
    mockKaminoWithdrawInstruction({
      instructionAmountRaw: () => BigInt(95_238_096),
    });
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo: mock(async (account: PublicKey) =>
          account.equals(kaminoReserve)
            ? createSerializedKaminoReserveAccount({
                collateralSupplyRaw: BigInt(100_000_000),
                liquidityAvailableAmountRaw: BigInt(105_000_000),
              })
            : null
        ),
        getLatestBlockhash: mock(async () => ({
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 1,
        })),
        getTokenAccountBalance: mock(async () => ({
          context: { slot: 1 },
          value: {
            amount: "0",
            decimals: 6,
            uiAmount: 0,
            uiAmountString: "0",
          },
        })),
        simulateTransaction: mock(async () => ({
          value: {
            accounts: [
              {
                data: [
                  createSimulatedTokenAccountData(BigInt(95_150_000)),
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

    await expect(
      client.prepareEarnUsdcWithdraw({
        settingsPda,
        walletAddress,
        feePayer,
        policySigner: backendSigner,
        amountRaw: requestedLiquidityAmountRaw,
        mode: "partial",
        yieldRoutingPolicy: {
          account: policyAccount,
          seed: BigInt(7),
        },
      })
    ).rejects.toMatchObject({
      code: "earn_withdraw_underfilled",
      message:
        "Kamino withdrawal simulation produced less liquidity than requested.",
      name: "EarnWithdrawUnderfilledError",
    });
  });

  test("[earn-withdraw-exact-output] bounds simulation-guided rounding adjustments", async () => {
    const requestedLiquidityAmountRaw = BigInt(100_000_000);
    const fetchMock = mockKaminoWithdrawInstruction({
      instructionAmountRaw: () => BigInt(95_238_095),
    });
    const simulateTransaction = mock(async () => ({
      value: {
        accounts: [
          {
            data: [
              createSimulatedTokenAccountData(BigInt(95_238_095)),
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
        getAccountInfo: mock(async (account: PublicKey) =>
          account.equals(kaminoReserve)
            ? createSerializedKaminoReserveAccount({
                collateralSupplyRaw: BigInt(100_000_000),
                liquidityAvailableAmountRaw: BigInt(105_000_000),
              })
            : null
        ),
        getLatestBlockhash: mock(async () => ({
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 1,
        })),
        getTokenAccountBalance: mock(async () => ({
          context: { slot: 1 },
          value: {
            amount: "0",
            decimals: 6,
            uiAmount: 0,
            uiAmountString: "0",
          },
        })),
        simulateTransaction,
      } as never,
      programId,
    });

    await expect(
      client.prepareEarnUsdcWithdraw({
        settingsPda,
        walletAddress,
        feePayer,
        policySigner: backendSigner,
        amountRaw: requestedLiquidityAmountRaw,
        mode: "partial",
        yieldRoutingPolicy: {
          account: policyAccount,
          seed: BigInt(7),
        },
      })
    ).rejects.toMatchObject({ code: "earn_withdraw_underfilled" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(simulateTransaction).toHaveBeenCalledTimes(3);
  });

  test("[earn-withdraw-account-drift] retries AccountNotFound once and returns a typed error", async () => {
    mockKaminoWithdrawInstruction({
      instructionAmountRaw: () => BigInt(95_150_000),
    });
    const getLatestBlockhash = mock(async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 1,
    }));
    const simulateTransaction = mock(async () => ({
      value: {
        accounts: null,
        err: "AccountNotFound",
        logs: [],
      },
    }));
    const client = createSmartAccountVaultsClient({
      connection: {
        getLatestBlockhash,
        getTokenAccountBalance: mock(async () => ({
          context: { slot: 1 },
          value: {
            amount: "0",
            decimals: 6,
            uiAmount: 0,
            uiAmountString: "0",
          },
        })),
        simulateTransaction,
      } as never,
      programId,
    });

    await expect(
      client.prepareEarnUsdcWithdraw({
        settingsPda,
        walletAddress,
        feePayer,
        policySigner: backendSigner,
        amountRaw: BigInt(100_000_000),
        mode: "partial",
        yieldRoutingPolicy: {
          account: policyAccount,
          seed: BigInt(7),
        },
      })
    ).rejects.toMatchObject({
      accountRole: "transaction_account",
      code: EARN_WITHDRAW_REQUIRED_ACCOUNT_MISSING_CODE,
    });
    expect(getLatestBlockhash).toHaveBeenCalledTimes(2);
    expect(simulateTransaction).toHaveBeenCalledTimes(2);
  });

  test("accepts Kamino execution reserve drift inside the Earn envelope", async () => {
    const executionReserve = new PublicKey(
      "So11111111111111111111111111111111111111112"
    );
    mockKaminoWithdrawInstruction({ executionReserve });
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

    expect(result.withdrawSteps).toHaveLength(1);
    expect(result.withdrawSteps[0]?.accountingReserve?.reserve.toBase58()).toBe(
      kaminoReserve.toBase58()
    );
    expect(result.withdrawSteps[0]?.executionReserve?.reserve.toBase58()).toBe(
      executionReserve.toBase58()
    );
    expect(result.withdrawSteps[0]?.persistence).toMatchObject({
      accountingReserve: kaminoReserve.toBase58(),
      executionReserve: executionReserve.toBase58(),
      targetReserve: kaminoReserve.toBase58(),
    });
  });

  test("batches multiple Kamino withdraw instructions into one approval when they fit", async () => {
    mockKaminoWithdrawInstruction({ duplicateWithdrawInstruction: true });
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
            owner: deriveVault(),
          }),
          executable: false,
          lamports: 1,
          owner: TOKEN_PROGRAM_ID,
          rentEpoch: 0,
        };
      }
      if (account.equals(autodepositPolicyAccount)) {
        return createSerializedSweepPolicyAccount();
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

    expect(result.withdrawSteps).toHaveLength(1);
    expect(result.withdrawSteps[0]?.reserveWithdrawals).toHaveLength(2);
    expect(result.withdrawSteps[0]?.persistence).toMatchObject({
      isFinalStep: true,
      vaultCollateralCleanupIncluded: true,
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
      if (account.equals(autodepositPolicyAccount)) {
        return createSerializedSweepPolicyAccount();
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

    expect(result.prepared.instructions).toHaveLength(3);
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
    ).toEqual([programId.toBase58(), programId.toBase58()]);
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[1]);
    expectInstructionAccountMeta(
      result.prepared.instructions[1],
      vaultCollateralAta,
      { isWritable: true }
    );
    expectInstructionAccountMeta(
      result.prepared.instructions[1],
      deriveVaultUsdcAta(),
      { isWritable: true }
    );
    expectInstructionAccountMeta(
      result.prepared.instructions[1],
      walletAddress,
      {
        isWritable: true,
      }
    );
    expectInstructionAccountMeta(
      result.prepared.instructions[1],
      deriveVault(),
      {
        isWritable: true,
      }
    );
    expectInstructionAccountMeta(
      result.prepared.instructions[2],
      result.policy.account,
      { isWritable: true }
    );
    expect(result.mode).toBe("full");
    expect(result.targetReserve?.obligation.toBase58()).toBe(
      deriveKaminoVanillaObligation(
        result.vault.pubkey,
        result.targetReserve!.market
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

  test("[earn-withdraw-exact-output] sends full redeemable liquidity to KTX and sweeps actual output", async () => {
    const collateralInstructionAmountRaw = BigInt(388_709_978);
    const fetchMock = mockKaminoWithdrawInstruction({
      instructionAmountRaw: () => collateralInstructionAmountRaw,
    });
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
              createSimulatedTokenAccountData(
                kaminoRedeemableAmountRaw + vaultUsdcRemainderRaw
              ),
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
      "404.324177"
    );
    expect(result.persistence).toMatchObject({
      mode: "full",
      kaminoWithdrawAmountRaw: collateralInstructionAmountRaw.toString(),
      requestedWithdrawAmountRaw: "480000000",
      vaultUsdcRemainderRaw: vaultUsdcRemainderRaw.toString(),
      walletTransferAmountRaw: "480000716",
      withdrawnAmountRaw: "480000716",
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
      if (account.equals(autodepositPolicyAccount)) {
        return createSerializedSweepPolicyAccount();
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
    expect(
      result.prepared.instructions
        .slice(0, 3)
        .map((instruction) => instruction.programId.toBase58())
    ).toEqual([
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    ]);
    expect(
      result.prepared.instructions
        .slice(3)
        .map((instruction) => instruction.programId.toBase58())
    ).toEqual([programId.toBase58(), programId.toBase58()]);
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
      vaultCollateralCleanupIncluded: true,
      vaultUsdcRemainderRaw: "1",
      walletTransferAmountRaw: "1000002",
      withdrawnAmountRaw: "1000002",
    });
    expect(result.persistence.reserveWithdrawals?.[0]).toMatchObject({
      accountingReserve: kaminoReserve.toBase58(),
      executionReserve: kaminoReserve.toBase58(),
      liquidityMint: STABLECOIN_MINTS[Stablecoin.USDC].toBase58(),
      reserve: kaminoReserve.toBase58(),
    });
  });

  test("splits autodeposit teardown from idle full withdraw cleanup", async () => {
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo: mock(async (account: PublicKey) =>
          account.equals(autodepositPolicyAccount)
            ? createSerializedSweepPolicyAccount()
            : createSerializedEarnPolicyAccount()
        ),
        getLatestBlockhash: mock(async () => ({
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 1,
        })),
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
      source: {
        type: "idle",
        id: "idle-usdc",
        amountRaw: BigInt(1_000_000),
        mint: STABLECOIN_MINTS[Stablecoin.USDC],
        tokenAccount: deriveVaultUsdcAta(),
        tokenProgramId: TOKEN_PROGRAM_ID,
      },
      yieldRoutingPolicy: {
        account: policyAccount,
        seed: BigInt(7),
      },
    });

    expect(result.autodepositClosePrepared?.prepared.instructions).toHaveLength(
      2
    );
    expect(
      result.autodepositClosePrepared?.prepared.instructions[0]?.programId.toBase58()
    ).toBe(SUBSCRIPTIONS_PROGRAM_ID.toBase58());
    expect(
      result.autodepositClosePrepared?.prepared.instructions[1]?.programId.toBase58()
    ).toBe(programId.toBase58());
    expect(result.withdrawSteps).toHaveLength(1);
    expect(result.targetReserve).toBeNull();
    expect(result.withdrawSteps[0]?.accountingReserve).toBeNull();
    expect(result.withdrawSteps[0]?.executionReserve).toBeNull();
    expect(result.withdrawSteps[0]?.persistence.autodepositClose).toMatchObject(
      {
        cluster: "mainnet-beta",
        delegatedSigner: backendSigner.toBase58(),
        policyAccount: autodepositPolicyAccount.toBase58(),
        recurringDelegation: recurringDelegation.toBase58(),
        settings: settingsPda.toBase58(),
        vaultIndex: 1,
        walletAddress: walletAddress.toBase58(),
      }
    );
    expect(result.persistence.autodepositClose).toMatchObject({
      policyAccount: autodepositPolicyAccount.toBase58(),
      recurringDelegation: recurringDelegation.toBase58(),
      settings: settingsPda.toBase58(),
    });
    expect(result.persistence).toMatchObject({
      mode: "full",
      sourceType: "idle",
      vaultCollateralCleanupIncluded: false,
      vaultUsdcRemainderRaw: "0",
      walletTransferAmountRaw: "1000000",
      withdrawnAmountRaw: "1000000",
    });
  });

  test("multi-program Earn cleanup pins both token-program reads to the withdrawal slot", async () => {
    const getTokenAccountsByOwner = mock(async () => ({
      context: { slot: 101 },
      value: [],
    }));
    const client = createSmartAccountVaultsClient({
      connection: { getTokenAccountsByOwner } as never,
      programId,
    });

    await client.fetchEarnVaultRefundSnapshot({
      minContextSlot: 101,
      settingsPda,
    });

    expect(getTokenAccountsByOwner).toHaveBeenCalledTimes(2);
    const calls = getTokenAccountsByOwner.mock.calls as unknown as [
      PublicKey,
      unknown,
      unknown
    ][];
    expect(calls[0]?.[2]).toEqual({
      commitment: "confirmed",
      minContextSlot: 101,
    });
    expect(calls[1]?.[2]).toEqual({
      commitment: "confirmed",
      minContextSlot: 101,
    });
    expect(calls[0]?.[1]).toEqual({ programId: TOKEN_PROGRAM_ID });
    expect(calls[1]?.[1]).toEqual({ programId: TOKEN_2022_PROGRAM_ID });
  });

  test("multi-program Earn cleanup transfers and closes with each account's program", () => {
    const usdtMint = STABLECOIN_MINTS[Stablecoin.USDT];
    const cashMint = STABLECOIN_MINTS[Stablecoin.CASH];
    const usdtAta = getAssociatedTokenAddressSync(
      usdtMint,
      deriveVault(),
      true,
      TOKEN_PROGRAM_ID
    );
    const cashAta = getAssociatedTokenAddressSync(
      cashMint,
      deriveVault(),
      true,
      TOKEN_2022_PROGRAM_ID
    );
    const result = createEarnVaultTokenCleanupInstructions({
      feePayer,
      tokenAccounts: [
        {
          address: usdtAta,
          amountRaw: BigInt(7),
          decimals: 6,
          mint: usdtMint,
          tokenProgramId: TOKEN_PROGRAM_ID,
        },
        {
          address: cashAta,
          amountRaw: BigInt(9),
          decimals: 6,
          mint: cashMint,
          tokenProgramId: TOKEN_2022_PROGRAM_ID,
        },
      ],
      usdcMint: STABLECOIN_MINTS[Stablecoin.USDC],
      vaultPda: deriveVault(),
      walletAddress,
    });

    expect(result.walletAtaInstructions).toHaveLength(2);
    expect(
      result.tokenInstructions.map((instruction) =>
        instruction.programId.toBase58()
      )
    ).toEqual([
      TOKEN_PROGRAM_ID.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
      TOKEN_2022_PROGRAM_ID.toBase58(),
      TOKEN_2022_PROGRAM_ID.toBase58(),
    ]);
    expect(
      decodeTransferCheckedInstruction(
        result.tokenInstructions[0]!,
        TOKEN_PROGRAM_ID
      ).data.amount
    ).toBe(BigInt(7));
    expect(
      decodeTransferCheckedInstruction(
        result.tokenInstructions[2]!,
        TOKEN_2022_PROGRAM_ID
      ).data.amount
    ).toBe(BigInt(9));
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
    expect(result.prepared.instructions).toHaveLength(3);
    expectInstructionAccountMeta(
      result.prepared.instructions[2],
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

  // Regression (2026-08-13): the current withdraw shape carries the classic
  // collateral token program at slot 11 and the liquidity mint's program at
  // slot 12. Reading the liquidity program from slot 11 only passed while
  // every mint was classic SPL — it rejected all Token-2022 withdrawals.
  test("accepts the Token-2022 liquidity program at its current-order slot", async () => {
    const usdgMint = STABLECOIN_MINTS[Stablecoin.USDG];
    mockKaminoWithdrawInstruction({
      currentAccountOrder: true,
      liquidityMint: usdgMint,
      liquidityTokenProgram: TOKEN_2022_PROGRAM_ID,
    });
    const client = createSmartAccountVaultsClient({
      connection: {} as never,
      programId,
    });

    const error = await client
      .prepareEarnUsdcWithdraw({
        settingsPda,
        walletAddress,
        feePayer,
        policySigner: backendSigner,
        amountRaw: BigInt(1_000_000),
        mode: "partial",
        target: {
          liquidityMint: usdgMint,
          liquidityTokenProgram: TOKEN_2022_PROGRAM_ID,
          market: kaminoMarket,
          reserve: kaminoReserve,
          reserveCollateralMint: kaminoReserveCollateralMint,
          reserveLiquiditySupply: kaminoReserveLiquiditySupply,
        },
        yieldRoutingPolicy: {
          account: policyAccount,
          seed: BigInt(7),
        },
      })
      .then(
        () => null,
        (thrown) =>
          thrown instanceof Error ? thrown : new Error(String(thrown))
      );

    // Both token-program slots must validate; any remaining failure is a
    // downstream mock gap, never the token-program assertion.
    expect(error?.message ?? "").not.toContain(
      "unexpected liquidity token program"
    );
    expect(error?.message ?? "").not.toContain(
      "unexpected collateral token program"
    );
  });
});

describe("prepareEarnUsdcAutodeposit", () => {
  afterEach(() => {
    mock.restore();
  });

  test("cold start initializes only the subscription authority", async () => {
    const getAccountInfo = mock(async () => null);
    const getMinimumBalanceForRentExemption = mock(
      async (space: number) => space + 1_000
    );
    const getBalance = mock(async () => 0);
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo,
        getBalance,
        getMinimumBalanceForRentExemption,
      } as never,
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
    expect(() =>
      compilePreparedOperation({
        prepared: result.prepared,
        blockhash: "11111111111111111111111111111111",
      }).serialize()
    ).not.toThrow();
    expect(result.persistence).toMatchObject({
      delegatedSigner: backendSigner.toBase58(),
      policyAccount: result.policy.account?.toBase58(),
      policySeed: "1",
      subscriptionDelegatee: deriveVault().toBase58(),
      subscriptionAuthorityInitialization: "required",
      walletAddress: walletAddress.toBase58(),
    });
    expect(getAccountInfo).toHaveBeenCalledTimes(1);
    expect(getMinimumBalanceForRentExemption).not.toHaveBeenCalled();
    expect(getBalance).not.toHaveBeenCalled();
    expect(result.nativeSolRequirement.canProceed).toBe(true);
    expect(result.nativeSolRequirement.balanceSource).toBe(
      "assumed_sufficient"
    );
    expect(result.nativeSolRequirement.items).toContainEqual(
      expect.objectContaining({
        kind: "subscription_authority_rent",
        lamports: "1628640",
      })
    );
  });

  test("warm follow-up creates the policy in a separate transaction", async () => {
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
      connection: {
        getAccountInfo,
        getBalance: mock(async () => 0),
        getMinimumBalanceForRentExemption: mock(
          async (space: number) => space + 1_000
        ),
      } as never,
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

    expect(result.stage).toBe("create_policy");
    expect(result.prepared.instructions).toHaveLength(1);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      programId.toBase58()
    );
    expectPolicyCreateSigner(result.prepared.instructions[0], backendSigner);
    expect(() =>
      compilePreparedOperation({
        prepared: result.prepared,
        blockhash: "11111111111111111111111111111111",
      }).serialize()
    ).not.toThrow();
    expect(result.persistence).toMatchObject({
      policyAccount: result.policy.account?.toBase58(),
      policySeed: "1",
      subscriptionAuthorityInitialization: "exists",
    });
    expect(result.nativeSolRequirement.canProceed).toBe(true);
    expect(result.nativeSolRequirement.items).toContainEqual(
      expect.objectContaining({
        kind: "policy_rent",
        stage: "create_policy",
      })
    );
  });

  test("batch setup aggregates policy and recurring delegation requirements", async () => {
    const subscriptionAuthority = deriveSubscriptionAuthority(
      walletAddress,
      STABLECOIN_MINTS[Stablecoin.USDC]
    );
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(settingsPda)) {
        return createSerializedSettingsAccount();
      }
      if (address.equals(subscriptionAuthority)) {
        return createSerializedSubscriptionAuthorityAccount(BigInt(7));
      }
      return null;
    });
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo,
        getBalance: mock(async () => 1_500),
        getMinimumBalanceForRentExemption: mock(
          async (space: number) => space + 1_000
        ),
      } as never,
      programId,
    });

    const setups = await client.prepareEarnUsdcAutodepositSetupBatch({
      settingsPda,
      walletAddress,
      feePayer,
      signer: walletAddress,
      policySigner: backendSigner,
      amountRaw: BigInt(1_000_000),
      nonce: BigInt(42),
    });

    expect(setups.map((setup) => setup.stage)).toEqual([
      "create_policy",
      "create_recurring_delegation",
    ]);
    const combined = combineSmartAccountNativeSolRequirements(
      setups.map((setup) => setup.nativeSolRequirement)
    );
    expect(combined?.canProceed).toBe(true);
    expect(combined?.balanceSource).toBe("assumed_sufficient");
    expect(
      BigInt(combined?.requiredLamports ?? "0") >
        BigInt(setups[0]!.nativeSolRequirement.requiredLamports)
    ).toBe(true);
    expect(combined?.items.map((item) => item.kind)).toContain(
      "recurring_delegation_rent"
    );
  });

  test("batch setup reuses first-stage account evidence for the recurring delegation", async () => {
    const originalDateNow = Date.now;
    Date.now = () => 1_780_000_000_000;
    const subscriptionAuthority = deriveSubscriptionAuthority(
      walletAddress,
      STABLECOIN_MINTS[Stablecoin.USDC]
    );
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(settingsPda)) {
        return createSerializedSettingsAccount();
      }
      if (address.equals(subscriptionAuthority)) {
        return createSerializedSubscriptionAuthorityAccount(BigInt(7));
      }
      return null;
    });
    const getMultipleAccountsInfo = mock(async (addresses: PublicKey[]) =>
      addresses.map(() => null)
    );
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo,
        getBalance: mock(async () => 0),
        getMinimumBalanceForRentExemption: mock(
          async (space: number) => space + 1_000
        ),
        getMultipleAccountsInfo,
      } as never,
      programId,
    });

    let setups: Awaited<
      ReturnType<typeof client.prepareEarnUsdcAutodepositSetupBatch>
    >;
    try {
      setups = await client.prepareEarnUsdcAutodepositSetupBatch({
        settingsPda,
        walletAddress,
        feePayer,
        signer: walletAddress,
        policySigner: backendSigner,
        amountRaw: BigInt(1_000_000),
        nonce: BigInt(42),
      });
    } finally {
      Date.now = originalDateNow;
    }

    expect(setups.map((setup) => setup.stage)).toEqual([
      "create_policy",
      "create_recurring_delegation",
    ]);
    expect(setups[0]!.subscription.startTimestamp).toBe(BigInt(1_780_000_000));
    expect(setups[1]!.subscription.startTimestamp).toBe(BigInt(1_780_000_030));
    // Settings + subscription authority. Policy/delegation/vault/wallet ATA
    // state is batched below.
    expect(getAccountInfo).toHaveBeenCalledTimes(2);
    expect(getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    const firstProbe = getMultipleAccountsInfo.mock.calls[0]?.[0] as
      | PublicKey[]
      | undefined;
    expect(firstProbe?.map((address) => address.toBase58())).toEqual([
      setups[0]!.policy.account!.toBase58(),
      setups[0]!.subscription.recurringDelegation.toBase58(),
      deriveVaultUsdcAta().toBase58(),
      deriveWalletUsdcAta().toBase58(),
    ]);
  });

  test("staged policy follow-up refreshes immediate start without the batch buffer", async () => {
    const originalDateNow = Date.now;
    Date.now = () => 1_780_000_000_000;
    const subscriptionAuthority = deriveSubscriptionAuthority(
      walletAddress,
      STABLECOIN_MINTS[Stablecoin.USDC]
    );
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(settingsPda)) {
        return createSerializedSettingsAccount();
      }
      if (address.equals(subscriptionAuthority)) {
        return createSerializedSubscriptionAuthorityAccount(BigInt(7));
      }
      return null;
    });
    const getMultipleAccountsInfo = mock(async (addresses: PublicKey[]) =>
      addresses.map(() => null)
    );
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo,
        getBalance: mock(async () => 0),
        getMinimumBalanceForRentExemption: mock(
          async (space: number) => space + 1_000
        ),
        getMultipleAccountsInfo,
      } as never,
      programId,
    });

    try {
      const firstSetup = await client.prepareEarnUsdcAutodepositSetup({
        settingsPda,
        walletAddress,
        feePayer,
        signer: walletAddress,
        policySigner: backendSigner,
        amountRaw: BigInt(1_000_000),
        nonce: BigInt(42),
      });
      Date.now = () => 1_780_000_012_000;

      const setups =
        await client.prepareEarnUsdcAutodepositSetupBatchFromPrepared({
          settingsPda,
          walletAddress,
          feePayer,
          signer: walletAddress,
          policySigner: backendSigner,
          amountRaw: BigInt(1_000_000),
          nonce: firstSetup.subscription.nonce,
          policySeed: firstSetup.policy.seed ?? undefined,
          preparedSetup: firstSetup,
          refreshImmediateStartTimestamp: true,
        });

      expect(setups[1]?.stage).toBe("create_recurring_delegation");
      expect(setups[1]?.subscription.startTimestamp).toBe(
        BigInt(1_780_000_012)
      );
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("existing policy with missing delegation creates the recurring delegation", async () => {
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
        return createSerializedSweepPolicyAccount();
      }
      return null;
    });
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo,
        getBalance: mock(async () => 0),
        getMinimumBalanceForRentExemption: mock(
          async (space: number) => space + 1_000
        ),
      } as never,
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
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );
    expectAutodepositApproveCheckedInstruction(result.prepared.instructions[1]);
    expect(result.prepared.instructions[2]?.programId.toBase58()).toBe(
      SUBSCRIPTIONS_PROGRAM_ID.toBase58()
    );
    expect(() =>
      compilePreparedOperation({
        prepared: result.prepared,
        blockhash: "11111111111111111111111111111111",
      }).serialize()
    ).not.toThrow();
    expect(result.nativeSolRequirement.canProceed).toBe(true);
    expect(result.nativeSolRequirement.items).toContainEqual(
      expect.objectContaining({
        kind: "recurring_delegation_rent",
        lamports: "2359440",
      })
    );
    expect(result.nativeSolRequirement.items).toContainEqual(
      expect.objectContaining({
        kind: "token_account_rent",
        lamports: "2039280",
      })
    );
  });

  test("existing delegation with missing policy prepares only the policy stage", async () => {
    const subscriptionAuthority = deriveSubscriptionAuthority(
      walletAddress,
      STABLECOIN_MINTS[Stablecoin.USDC]
    );
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(settingsPda)) {
        return createSerializedSettingsAccount();
      }
      if (address.equals(subscriptionAuthority)) {
        return createSerializedSubscriptionAuthorityAccount(BigInt(7));
      }
      return null;
    });
    const getMultipleAccountsInfo = mock(async (addresses: PublicKey[]) =>
      addresses.map((_, index) =>
        index === 1 ? createSerializedRecurringDelegationAccount() : null
      )
    );
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo,
        getBalance: mock(async () => 0),
        getMinimumBalanceForRentExemption: mock(
          async (space: number) => space + 1_000
        ),
        getMultipleAccountsInfo,
      } as never,
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

    expect(result.stage).toBe("create_policy");
    expect(result.accountEvidence).toMatchObject({
      policyExists: false,
      recurringDelegationExists: true,
    });
    expect(result.prepared.instructions).toHaveLength(1);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      programId.toBase58()
    );
  });

  test("batches vault ATA existence with the policy and delegation probe", async () => {
    const subscriptionAuthority = deriveSubscriptionAuthority(
      walletAddress,
      STABLECOIN_MINTS[Stablecoin.USDC]
    );
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(settingsPda)) {
        return createSerializedSettingsAccount();
      }
      if (address.equals(subscriptionAuthority)) {
        return createSerializedSubscriptionAuthorityAccount(BigInt(7));
      }
      return null;
    });
    const getMultipleAccountsInfo = mock(async (addresses: PublicKey[]) =>
      addresses.map((_, index) =>
        index === 0 ? createSerializedSweepPolicyAccount() : null
      )
    );
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo,
        getBalance: mock(async () => 0),
        getMinimumBalanceForRentExemption: mock(
          async (space: number) => space + 1_000
        ),
        getMultipleAccountsInfo,
      } as never,
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
    expect(getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    const probe = getMultipleAccountsInfo.mock.calls[0]?.[0] as
      | PublicKey[]
      | undefined;
    expect(probe?.map((address) => address.toBase58())).toEqual([
      result.policy.account!.toBase58(),
      result.subscription.recurringDelegation.toBase58(),
      deriveVaultUsdcAta().toBase58(),
      deriveWalletUsdcAta().toBase58(),
    ]);
  });

  test("repairs setup when policy and recurring delegation exist without token approval", async () => {
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
        return createSerializedSweepPolicyAccount();
      }
      if (nonSettingsLookupCount === 3) {
        return createSerializedRecurringDelegationAccount();
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

    expect(result.stage).toBe("approve_token_delegate");
    expect(result.prepared.instructions).toHaveLength(1);
    expectAutodepositApproveCheckedInstruction(result.prepared.instructions[0]);
  });

  test("repairs setup when policy and recurring delegation exist with a foreign token approval", async () => {
    const foreignDelegate = new PublicKey("1111111111111111111111111111111C");
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
        return createSerializedSweepPolicyAccount();
      }
      if (nonSettingsLookupCount === 3) {
        return createSerializedRecurringDelegationAccount();
      }
      if (nonSettingsLookupCount === 5) {
        return {
          data: createTokenAccountData({
            amountRaw: BigInt(1_000_000),
            delegatedAmountRaw: BigInt(1),
            delegate: foreignDelegate,
            owner: walletAddress,
          }),
          executable: false,
          lamports: 1,
          owner: TOKEN_PROGRAM_ID,
          rentEpoch: 0,
        };
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

    expect(result.stage).toBe("approve_token_delegate");
    expect(result.prepared.instructions).toHaveLength(1);
    expectAutodepositApproveCheckedInstruction(result.prepared.instructions[0]);
  });

  test("rejects setup when policy, recurring delegation, and token approval already exist", async () => {
    const subscriptionAuthority = deriveSubscriptionAuthority(
      walletAddress,
      STABLECOIN_MINTS[Stablecoin.USDC]
    );
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
        return createSerializedSweepPolicyAccount();
      }
      if (nonSettingsLookupCount === 3) {
        return createSerializedRecurringDelegationAccount();
      }
      if (nonSettingsLookupCount === 5) {
        return {
          data: createTokenAccountData({
            amountRaw: BigInt(1_000_000),
            delegatedAmountRaw: BigInt(1_000_000),
            delegate: subscriptionAuthority,
            owner: walletAddress,
          }),
          executable: false,
          lamports: 1,
          owner: TOKEN_PROGRAM_ID,
          rentEpoch: 0,
        };
      }
      return null;
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

  test("repairs setup when expected token approval is below the period amount", async () => {
    const subscriptionAuthority = deriveSubscriptionAuthority(
      walletAddress,
      STABLECOIN_MINTS[Stablecoin.USDC]
    );
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
        return createSerializedSweepPolicyAccount();
      }
      if (nonSettingsLookupCount === 3) {
        return createSerializedRecurringDelegationAccount();
      }
      if (nonSettingsLookupCount === 5) {
        return {
          data: createTokenAccountData({
            amountRaw: BigInt(1_000_000),
            delegatedAmountRaw: BigInt(1),
            delegate: subscriptionAuthority,
            owner: walletAddress,
          }),
          executable: false,
          lamports: 1,
          owner: TOKEN_PROGRAM_ID,
          rentEpoch: 0,
        };
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

    expect(result.stage).toBe("approve_token_delegate");
    expect(result.prepared.instructions).toHaveLength(1);
    expectAutodepositApproveCheckedInstruction(result.prepared.instructions[0]);
  });

  test("builds close policy removal with backend signer metadata", async () => {
    const recurringDelegation = new PublicKey(
      "11111111111111111111111111111116"
    );
    const subscriptionAuthority = deriveSubscriptionAuthority(
      walletAddress,
      STABLECOIN_MINTS[Stablecoin.USDC]
    );
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(policyAccount)) {
        return createSerializedSweepPolicyAccount();
      }
      if (address.equals(recurringDelegation)) {
        return createSerializedRecurringDelegationAccount();
      }
      if (address.equals(deriveWalletUsdcAta())) {
        return {
          data: createTokenAccountData({
            amountRaw: BigInt(1_000_000),
            delegatedAmountRaw: BigInt(1),
            delegate: subscriptionAuthority,
            owner: walletAddress,
          }),
          executable: false,
          lamports: 1,
          owner: TOKEN_PROGRAM_ID,
          rentEpoch: 0,
        };
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
      recurringDelegation,
    });

    expect(result.prepared.instructions).toHaveLength(3);
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[1]);
    const revoke = decodeRevokeInstruction(result.prepared.instructions[2]!);
    expect(revoke.keys.account.pubkey.toBase58()).toBe(
      deriveWalletUsdcAta().toBase58()
    );
    expect(revoke.keys.owner.pubkey.toBase58()).toBe(walletAddress.toBase58());
    expect(revoke.keys.owner.isSigner).toBe(true);
    expect(result.persistence).toMatchObject({
      delegatedSigner: backendSigner.toBase58(),
      policyAccount: policyAccount.toBase58(),
      walletAddress: walletAddress.toBase58(),
    });
  });

  test("preserves a foreign wallet token delegate during autodeposit close", async () => {
    const recurringDelegation = new PublicKey(
      "11111111111111111111111111111116"
    );
    const foreignDelegate = new PublicKey("1111111111111111111111111111111C");
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(policyAccount)) {
        return createSerializedSweepPolicyAccount();
      }
      if (address.equals(recurringDelegation)) {
        return createSerializedRecurringDelegationAccount();
      }
      if (address.equals(deriveWalletUsdcAta())) {
        return {
          data: createTokenAccountData({
            amountRaw: BigInt(1_000_000),
            delegatedAmountRaw: BigInt(1),
            delegate: foreignDelegate,
            owner: walletAddress,
          }),
          executable: false,
          lamports: 1,
          owner: TOKEN_PROGRAM_ID,
          rentEpoch: 0,
        };
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
      recurringDelegation,
    });

    expect(result.prepared.instructions).toHaveLength(2);
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[1]);
  });

  test("omits the delegation revoke when the delegation was never created", async () => {
    const getAccountInfo = mock(async (address: PublicKey) => {
      if (address.equals(policyAccount)) {
        return createSerializedSweepPolicyAccount();
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

    // A setup abandoned before its delegation stage: revoking the nonexistent
    // delegation would fail simulation and strand the close, so only the
    // policy-close instruction remains.
    expect(result.prepared.instructions).toHaveLength(1);
    expectSyncExecutionUsesSettingsConsensus(result.prepared.instructions[0]);
  });

  // ASK-1802 regression: a seed collision can leave the autodeposit row
  // pointing at the wallet's live Earn ROUTE policy; closing it stranded a
  // user's Earn funds behind `missing_earn_policy`.
  test("refuses to close a policy that is not an Autodeposit sweep policy", async () => {
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

    await expect(
      client.prepareEarnUsdcAutodepositClose({
        settingsPda,
        walletAddress,
        feePayer,
        signer: walletAddress,
        policySigner: backendSigner,
        policy: policyAccount,
        recurringDelegation: new PublicKey("11111111111111111111111111111116"),
      })
    ).rejects.toThrow(
      "Refusing to close a policy that is not an Autodeposit sweep policy."
    );
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
