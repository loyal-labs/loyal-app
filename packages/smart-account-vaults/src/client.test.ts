import { afterEach, describe, expect, mock, test } from "bun:test";
import { STABLECOIN_MINTS, Stablecoin } from "@loyal/actions";
import { Policy, Settings } from "@loyal-labs/loyal-smart-accounts-core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

import { createSmartAccountVaultsClient } from "./client";

const programId = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const settingsPda = new PublicKey("11111111111111111111111111111112");
const walletAddress = new PublicKey("11111111111111111111111111111113");
const feePayer = walletAddress;
const kaminoProgram = new PublicKey(
  "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd"
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
const kaminoCollateralAta = new PublicKey("11111111111111111111111111111116");
const originalFetch = globalThis.fetch;

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
              242, 35, 198, 137, 82, 225, 242, 182, 64, 66, 15, 0, 0, 0, 0, 0,
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
  const fetchMock = mock(async () => {
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
            data: Buffer.from([
              235, 52, 119, 152, 149, 197, 20, 7, 64, 66, 15, 0, 0, 0, 0, 0,
            ]).toString("base64"),
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

function createSerializedEarnPolicyAccount() {
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
    seed: new BN(1),
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

function createSerializedSettingsAccount() {
  const [data] = Settings.fromArgs({
    accountUtilization: 0,
    archivalAuthority: null,
    archivableAfter: new BN(0),
    bump: 255,
    policySeed: null,
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

describe("prepareEarnUsdcDeposit", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("builds the one-transaction earn deposit flow in order", async () => {
    const fetchMock = mockKaminoDepositInstruction();
    const client = createSmartAccountVaultsClient({
      connection: {} as never,
      programId,
    });
    const result = await client.prepareEarnUsdcDeposit({
      settingsPda,
      walletAddress,
      feePayer,
      amountRaw: BigInt(1_000_000),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.prepared.instructions).toHaveLength(4);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );

    const transfer = decodeTransferCheckedInstruction(
      result.prepared.instructions[1]!,
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

    expect(result.prepared.instructions[2]?.programId.toBase58()).toBe(
      programId.toBase58()
    );
    expect(result.prepared.instructions[3]?.programId.toBase58()).toBe(
      programId.toBase58()
    );
    expect(result.policy.seed).toBe(BigInt(1));
    expect(result.policy.sameMintInstructionConstraintIndexes).toEqual([0, 1]);
    expect(result.vault.accountIndex).toBe(1);
    expect(result.vault.pubkey.toBase58()).toBe(deriveVault().toBase58());
    expect(result.targetReserve.reserve.toBase58()).toBe(
      kaminoReserve.toBase58()
    );
    expect(result.persistence).toMatchObject({
      cluster: "mainnet-beta",
      policyId: "1",
      policyInitialization: "create",
      policySeed: "1",
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
      amountRaw: BigInt(500_000),
      initializeYieldRoutingPolicy: false,
    });

    expect(result.prepared.instructions).toHaveLength(3);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );

    const transfer = decodeTransferCheckedInstruction(
      result.prepared.instructions[1]!,
      TOKEN_PROGRAM_ID
    );
    expect(transfer.data.amount.toString()).toBe("500000");
    expect(result.prepared.instructions[2]?.programId.toBase58()).toBe(
      programId.toBase58()
    );
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
    const policyAccount = new PublicKey("11111111111111111111111111111117");

    const result = await client.prepareEarnUsdcDeposit({
      settingsPda,
      walletAddress,
      feePayer,
      amountRaw: BigInt(500_000),
      initializeYieldRoutingPolicy: false,
      yieldRoutingPolicy: {
        account: policyAccount,
        seed: BigInt(7),
      },
    });

    expect(getProgramAccounts).not.toHaveBeenCalled();
    expect(result.policy.account.toBase58()).toBe(policyAccount.toBase58());
    expect(result.policy.seed).toBe(BigInt(7));
    expect(result.persistence).toMatchObject({
      policyAccount: policyAccount.toBase58(),
      policyInitialization: "reuse",
      policySeed: "7",
    });
  });

  test("builds standalone earn routing policy setup metadata", async () => {
    const getAccountInfo = mock(async (_address: PublicKey) =>
      createSerializedSettingsAccount()
    );
    const client = createSmartAccountVaultsClient({
      connection: { getAccountInfo } as never,
      programId,
    });

    const result = await client.prepareEarnUsdcYieldRoutingPolicy({
      settingsPda,
      signer: walletAddress,
      feePayer,
    });

    expect(result.prepared.instructions).toHaveLength(1);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      programId.toBase58()
    );
    expect(result.policy.seed).toBe(BigInt(1));
    expect(result.vault).toMatchObject({
      accountIndex: 1,
    });
    expect(result.vault.pubkey.toBase58()).toBe(deriveVault().toBase58());
    expect(result.targetReserve.reserve.toBase58()).toBe(
      kaminoReserve.toBase58()
    );
    expect(result.persistence).toMatchObject({
      cluster: "mainnet-beta",
      liquidityMint: STABLECOIN_MINTS[Stablecoin.USDC].toBase58(),
      policyAccount: result.policy.account.toBase58(),
      policyId: "1",
      policySeed: "1",
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
      amountRaw: BigInt(1_000_000),
      mode: "partial",
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
      policyId: "1",
      policySeed: "1",
      withdrawnAmountRaw: "1000000",
      vaultIndex: 1,
    });
  });

  test("builds the full withdraw flow with policy cleanup", async () => {
    mockKaminoWithdrawInstruction();
    const client = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo: mock(async () => createSerializedEarnPolicyAccount()),
      } as never,
      programId,
    });

    const result = await client.prepareEarnUsdcWithdraw({
      settingsPda,
      walletAddress,
      feePayer,
      amountRaw: BigInt(1_000_000),
      mode: "full",
    });

    expect(result.prepared.instructions).toHaveLength(4);
    expect(result.prepared.instructions[0]?.programId.toBase58()).toBe(
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    );
    expect(result.prepared.instructions.slice(1).map((instruction) =>
      instruction.programId.toBase58()
    )).toEqual([
      programId.toBase58(),
      programId.toBase58(),
      programId.toBase58(),
    ]);
    expect(result.mode).toBe("full");
    expect(result.persistence).toMatchObject({
      mode: "full",
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
        amountRaw: BigInt(1_000_000),
        mode: "partial",
      })
    ).rejects.toThrow("unexpected vault USDC account");
  });
});
