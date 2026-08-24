import {
  codecs,
  createLoyalSmartAccountsClient,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts";
import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";

import { clusterConfigFor } from "./cluster.ts";
import {
  createProgramInteractionPolicyInstruction,
  updateProgramInteractionPolicyInstruction,
} from "./internal/squads.ts";
import { LoyalCluster } from "./types.ts";

const SMART_ACCOUNT_SEED = new TextEncoder().encode("smart_account");
const FARM_USER_SEED = new TextEncoder().encode("user");

export const EARN_MAX_MANIFEST_VERSION = "earn-max-v1";
export const EARN_MAX_VAULT_INDEX = 0;

const KLEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const FARMS = new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const MARKET_AUTHORITY = new PublicKey(
  "6QbtpY2jDNcncRFmVf343NThnCdaY8gCAsYATPnYQR9g"
);
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const MARKET = new PublicKey("6WEGfej9B9wjxRs6t4BYpb9iCXd8CpTpJ8fVSNzHCC5y");
const COLLATERAL_RESERVE = new PublicKey(
  "AwCyCPZYJSZ93xcVKNK7jR8e1BHzJXq1D4bReNuh9woY"
);
const DEBT_RESERVE = new PublicKey(
  "Atj6UREVWa7WxbF2EMKNyfmYUY1U1txughe2gjhcPDCo"
);
const COLLATERAL_MINT = new PublicKey(
  "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj"
);
const CLAIM_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
const DEBT_FARM = new PublicKey("87gUNr8LwYJCT25HjPEHnrfBBjwEMAjfqCfnKcJNqy9Y");
const USER_METADATA_SEED = new TextEncoder().encode("user_meta");
const INIT_USER_METADATA = [117, 169, 176, 69, 197, 23, 15, 162] as const;
const INIT_OBLIGATION = [251, 10, 231, 76, 27, 11, 159, 96] as const;
const INIT_OBLIGATION_FARM = [136, 63, 15, 186, 211, 152, 168, 164] as const;
const SETUP_RENT_BUFFER_LAMPORTS = 39_532_800;

const REFRESH_RESERVE = [2, 218, 138, 235, 79, 201, 25, 102] as const;
const REFRESH_OBLIGATION = [33, 132, 147, 228, 151, 192, 72, 89] as const;
const DEPOSIT = [216, 224, 191, 27, 204, 151, 102, 175] as const;
const BORROW = [161, 128, 143, 245, 171, 199, 194, 6] as const;
const REPAY = [116, 174, 213, 76, 180, 53, 210, 144] as const;
const WITHDRAW = [235, 52, 119, 152, 149, 197, 20, 7] as const;
const SHARED_ACCOUNTS_ROUTE = [193, 32, 155, 51, 65, 214, 156, 129] as const;

export type EarnMaxTopology = {
  vault: PublicKey;
  claimCustody: PublicKey;
  collateralCustody: PublicKey;
  obligation: PublicKey;
  debtFarmUser: PublicKey;
  market: PublicKey;
  collateralReserve: PublicKey;
  debtReserve: PublicKey;
  collateralMint: PublicKey;
  claimMint: PublicKey;
  debtFarm: PublicKey;
};

export type EarnMaxPolicyPreparation = {
  family:
    | "deposit"
    | "borrow"
    | "forward_swap"
    | "reverse_swap"
    | "repay"
    | "withdraw";
  seed: bigint;
  policy: PublicKey;
  instruction: TransactionInstruction;
  updateInstruction: TransactionInstruction;
};

function associatedToken(owner: PublicKey, mint: PublicKey): PublicKey {
  const config = clusterConfigFor(LoyalCluster.MainnetBeta);
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN.toBytes(), mint.toBytes()],
    config.associatedTokenProgramId
  )[0];
}

export function deriveEarnMaxTopology(settings: PublicKey): EarnMaxTopology {
  const config = clusterConfigFor(LoyalCluster.MainnetBeta);
  const vault = PublicKey.findProgramAddressSync(
    [
      SMART_ACCOUNT_SEED,
      settings.toBytes(),
      SMART_ACCOUNT_SEED,
      Uint8Array.of(EARN_MAX_VAULT_INDEX),
    ],
    config.squadsSmartAccountProgramId
  )[0];
  const obligation = PublicKey.findProgramAddressSync(
    [
      Uint8Array.of(1),
      Uint8Array.of(0),
      vault.toBytes(),
      MARKET.toBytes(),
      COLLATERAL_MINT.toBytes(),
      CLAIM_MINT.toBytes(),
    ],
    KLEND
  )[0];
  const debtFarmUser = PublicKey.findProgramAddressSync(
    [FARM_USER_SEED, DEBT_FARM.toBytes(), obligation.toBytes()],
    FARMS
  )[0];
  return {
    vault,
    claimCustody: associatedToken(vault, CLAIM_MINT),
    collateralCustody: associatedToken(vault, COLLATERAL_MINT),
    obligation,
    debtFarmUser,
    market: MARKET,
    collateralReserve: COLLATERAL_RESERVE,
    debtReserve: DEBT_RESERVE,
    collateralMint: COLLATERAL_MINT,
    claimMint: CLAIM_MINT,
    debtFarm: DEBT_FARM,
  };
}

function sliceEquals(value: readonly number[]) {
  return {
    dataOffset: BigInt(0),
    dataValue: { type: "u8Slice" as const, value },
    operator: "equals" as const,
  };
}

function pubkey(accountIndex: number, ...pubkeys: PublicKey[]) {
  return { accountIndex, kind: { type: "pubkey" as const, pubkeys } };
}

export function createEarnMaxPolicyManifest(input: {
  authority: PublicKey;
  delegatedSigner: PublicKey;
  firstPolicySeed: bigint;
  settings: PublicKey;
}): readonly EarnMaxPolicyPreparation[] {
  const config = clusterConfigFor(LoyalCluster.MainnetBeta);
  const topology = deriveEarnMaxTopology(input.settings);
  const refreshReserve = {
    programId: KLEND,
    accountConstraints: [pubkey(0, COLLATERAL_RESERVE, DEBT_RESERVE)],
    dataConstraints: [sliceEquals(REFRESH_RESERVE)],
  };
  const refreshObligation = {
    programId: KLEND,
    accountConstraints: [pubkey(1, topology.obligation)],
    dataConstraints: [sliceEquals(REFRESH_OBLIGATION)],
  };
  const policy = (
    family: EarnMaxPolicyPreparation["family"],
    seed: bigint,
    finalConstraint: Parameters<
      typeof createProgramInteractionPolicyInstruction
    >[2][number]
  ): EarnMaxPolicyPreparation => {
    const instruction = createProgramInteractionPolicyInstruction(
      config,
      {
        settings: input.settings,
        authority: input.authority,
        delegatedSigner: input.delegatedSigner,
        accountIndex: EARN_MAX_VAULT_INDEX,
        vault: topology.vault,
      },
      family.includes("swap")
        ? [finalConstraint]
        : [refreshReserve, refreshObligation, finalConstraint],
      seed,
      [],
      "legacy"
    );
    const policy = instruction.keys[5]!.pubkey;
    return {
      family,
      seed,
      policy,
      instruction,
      updateInstruction: updateProgramInteractionPolicyInstruction(
        config,
        {
          settings: input.settings,
          authority: input.authority,
          delegatedSigner: input.delegatedSigner,
          accountIndex: EARN_MAX_VAULT_INDEX,
          vault: topology.vault,
        },
        family.includes("swap")
          ? [finalConstraint]
          : [refreshReserve, refreshObligation, finalConstraint],
        policy
      ),
    };
  };

  return [
    policy("deposit", input.firstPolicySeed, {
      programId: KLEND,
      accountConstraints: [
        pubkey(0, topology.vault),
        pubkey(1, topology.obligation),
        pubkey(4, COLLATERAL_RESERVE),
        pubkey(9, topology.collateralCustody),
        pubkey(11, TOKEN),
        pubkey(12, TOKEN),
        pubkey(14, KLEND),
        pubkey(15, KLEND),
      ],
      dataConstraints: [sliceEquals(DEPOSIT)],
    }),
    policy("repay", input.firstPolicySeed + BigInt(1), {
      programId: KLEND,
      accountConstraints: [
        pubkey(0, topology.vault),
        pubkey(1, topology.obligation),
        pubkey(3, DEBT_RESERVE),
        pubkey(6, topology.claimCustody),
        pubkey(7, TOKEN),
        pubkey(9, topology.debtFarmUser),
        pubkey(10, DEBT_FARM),
        pubkey(12, FARMS),
      ],
      dataConstraints: [sliceEquals(REPAY)],
    }),
    policy("borrow", input.firstPolicySeed + BigInt(2), {
      programId: KLEND,
      accountConstraints: [
        pubkey(0, topology.vault),
        pubkey(1, topology.obligation),
        pubkey(4, DEBT_RESERVE),
        pubkey(8, topology.claimCustody),
        pubkey(10, TOKEN),
        pubkey(12, topology.debtFarmUser),
        pubkey(13, DEBT_FARM),
        pubkey(14, FARMS),
      ],
      dataConstraints: [sliceEquals(BORROW)],
    }),
    policy("forward_swap", input.firstPolicySeed + BigInt(3), {
      programId: config.jupiterV6ProgramId,
      accountConstraints: [
        pubkey(0, TOKEN),
        pubkey(2, topology.vault),
        pubkey(3, topology.claimCustody),
        pubkey(6, topology.collateralCustody),
        pubkey(7, CLAIM_MINT),
        pubkey(8, COLLATERAL_MINT),
        pubkey(9, config.jupiterV6ProgramId),
        pubkey(10, config.jupiterV6ProgramId),
      ],
      dataConstraints: [sliceEquals(SHARED_ACCOUNTS_ROUTE)],
    }),
    policy("withdraw", input.firstPolicySeed + BigInt(4), {
      programId: KLEND,
      accountConstraints: [
        pubkey(0, topology.vault),
        pubkey(1, topology.obligation),
        pubkey(4, COLLATERAL_RESERVE),
        pubkey(9, topology.collateralCustody),
        pubkey(11, TOKEN),
        pubkey(12, TOKEN),
        pubkey(14, KLEND),
        pubkey(15, KLEND),
      ],
      dataConstraints: [sliceEquals(WITHDRAW)],
    }),
    policy("reverse_swap", input.firstPolicySeed + BigInt(5), {
      programId: config.jupiterV6ProgramId,
      accountConstraints: [
        pubkey(0, TOKEN),
        pubkey(2, topology.vault),
        pubkey(3, topology.collateralCustody),
        pubkey(6, topology.claimCustody),
        pubkey(7, COLLATERAL_MINT),
        pubkey(8, CLAIM_MINT),
        pubkey(9, config.jupiterV6ProgramId),
        pubkey(10, config.jupiterV6ProgramId),
      ],
      dataConstraints: [sliceEquals(SHARED_ACCOUNTS_ROUTE)],
    }),
  ];
}

export type EarnMaxClientOperation =
  PreparedLoyalSmartAccountsOperation<string>;

function prepared(
  input: Omit<
    EarnMaxClientOperation,
    "lookupTableAccounts" | "requiresConfirmation"
  >
): EarnMaxClientOperation {
  return { ...input, lookupTableAccounts: [], requiresConfirmation: true };
}

function createAssociatedTokenAccount(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      {
        pubkey: associatedToken(owner, mint),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function transferChecked(input: {
  amountRaw: bigint;
  destination: PublicKey;
  mint: PublicKey;
  owner: PublicKey;
  source: PublicKey;
}): TransactionInstruction {
  if (
    input.amountRaw <= BigInt(0) ||
    input.amountRaw > BigInt("18446744073709551615")
  ) {
    throw new Error("Earn MAX token amount must fit in u64 and be positive.");
  }
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(input.amountRaw);
  return new TransactionInstruction({
    programId: TOKEN,
    keys: [
      { pubkey: input.source, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: true, isWritable: true },
    ],
    data: Buffer.concat([Buffer.from([12]), amount, Buffer.from([6])]),
  });
}

async function buildVaultExecution(input: {
  connection: Connection;
  feePayer: PublicKey;
  inner: TransactionInstruction[];
  programId: PublicKey;
  settings: PublicKey;
  vault: PublicKey;
  operation: string;
}): Promise<EarnMaxClientOperation> {
  const compiled = codecs.compileToSynchronousMessageAndAccountsV2({
    vaultPda: input.vault,
    members: [input.feePayer],
    instructions: input.inner,
  });
  const operation = await createLoyalSmartAccountsClient({
    connection: input.connection,
    programId: input.programId,
  }).features.execution.prepare.executeTransactionSyncV2({
    feePayer: input.feePayer,
    settingsPda: input.settings,
    accountIndex: EARN_MAX_VAULT_INDEX,
    numSigners: 1,
    instructions: compiled.instructions,
    instruction_accounts: compiled.accounts,
  } as never);
  return { ...operation, operation: input.operation };
}

export async function buildEarnMaxInstallInstructions(input: {
  connection: Connection;
  delegatedSigner: PublicKey;
  feePayer: PublicKey;
  firstPolicySeed?: bigint;
  programId: PublicKey;
  settings: PublicKey;
  matchingPolicyAccounts?: ReadonlySet<string>;
}): Promise<EarnMaxClientOperation[]> {
  const client = createLoyalSmartAccountsClient({
    connection: input.connection,
    programId: input.programId,
  });
  const firstPolicySeed =
    input.firstPolicySeed ??
    BigInt(
      (
        await client.smartAccounts.queries.fetchSettings(input.settings)
      ).policySeed?.toString() ?? "0"
    ) + BigInt(1);
  const manifest = createEarnMaxPolicyManifest({
    authority: input.feePayer,
    delegatedSigner: input.delegatedSigner,
    firstPolicySeed,
    settings: input.settings,
  });
  const accounts = await input.connection.getMultipleAccountsInfo(
    manifest.map((entry) => entry.policy),
    "confirmed"
  );
  const matching = input.matchingPolicyAccounts ?? new Set<string>();
  return manifest.flatMap((entry, index) =>
    accounts[index] && matching.has(entry.policy.toBase58())
      ? []
      : [
          prepared({
            instructions: [
              accounts[index] ? entry.updateInstruction : entry.instruction,
            ],
            operation: `earnMaxInstall:${
              accounts[index] ? "update" : "create"
            }:${entry.family}`,
            payer: input.feePayer,
            programId: input.programId,
          }),
        ]
  );
}

function initUserMetadata(vault: PublicKey, userMetadata: PublicKey) {
  return new TransactionInstruction({
    programId: KLEND,
    keys: [
      { pubkey: vault, isSigner: true, isWritable: false },
      { pubkey: vault, isSigner: true, isWritable: true },
      { pubkey: userMetadata, isSigner: false, isWritable: true },
      { pubkey: KLEND, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([...INIT_USER_METADATA, ...PublicKey.default.toBytes()]),
  });
}

export async function buildEarnMaxDepositInstructions(input: {
  amountRaw: bigint;
  connection: Connection;
  feePayer: PublicKey;
  programId: PublicKey;
  settings: PublicKey;
}): Promise<EarnMaxClientOperation[]> {
  const topology = deriveEarnMaxTopology(input.settings);
  const userMetadata = PublicKey.findProgramAddressSync(
    [USER_METADATA_SEED, topology.vault.toBytes()],
    KLEND
  )[0];
  const [claimInfo, collateralInfo, metadataInfo, obligationInfo, farmInfo] =
    await input.connection.getMultipleAccountsInfo(
      [
        topology.claimCustody,
        topology.collateralCustody,
        userMetadata,
        topology.obligation,
        topology.debtFarmUser,
      ],
      "confirmed"
    );
  const direct: TransactionInstruction[] = [];
  if (!claimInfo)
    direct.push(
      createAssociatedTokenAccount(
        input.feePayer,
        topology.vault,
        topology.claimMint
      )
    );
  if (!collateralInfo)
    direct.push(
      createAssociatedTokenAccount(
        input.feePayer,
        topology.vault,
        topology.collateralMint
      )
    );
  const inner: TransactionInstruction[] = [];
  if (!metadataInfo) inner.push(initUserMetadata(topology.vault, userMetadata));
  if (!obligationInfo) {
    inner.push(
      new TransactionInstruction({
        programId: KLEND,
        keys: [
          { pubkey: topology.vault, isSigner: true, isWritable: false },
          { pubkey: topology.vault, isSigner: true, isWritable: true },
          { pubkey: topology.obligation, isSigner: false, isWritable: true },
          { pubkey: topology.market, isSigner: false, isWritable: false },
          {
            pubkey: topology.collateralMint,
            isSigner: false,
            isWritable: false,
          },
          { pubkey: topology.claimMint, isSigner: false, isWritable: false },
          { pubkey: userMetadata, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data: Buffer.from([...INIT_OBLIGATION, 1, 0]),
      })
    );
  }
  if (!farmInfo) {
    inner.push(
      new TransactionInstruction({
        programId: KLEND,
        keys: [
          { pubkey: topology.vault, isSigner: true, isWritable: true },
          { pubkey: topology.vault, isSigner: false, isWritable: false },
          { pubkey: topology.obligation, isSigner: false, isWritable: true },
          { pubkey: MARKET_AUTHORITY, isSigner: false, isWritable: false },
          { pubkey: topology.debtReserve, isSigner: false, isWritable: true },
          { pubkey: topology.debtFarm, isSigner: false, isWritable: true },
          { pubkey: topology.debtFarmUser, isSigner: false, isWritable: true },
          { pubkey: topology.market, isSigner: false, isWritable: false },
          { pubkey: FARMS, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data: Buffer.from([...INIT_OBLIGATION_FARM, 1]),
      })
    );
  }
  const operations: EarnMaxClientOperation[] = [];
  if (inner.length > 0) {
    const vaultLamports = await input.connection.getBalance(
      topology.vault,
      "confirmed"
    );
    const topUp = Math.max(0, SETUP_RENT_BUFFER_LAMPORTS - vaultLamports);
    if (topUp > 0) {
      direct.unshift(
        SystemProgram.transfer({
          fromPubkey: input.feePayer,
          toPubkey: topology.vault,
          lamports: topUp,
        })
      );
    }
  }
  if (direct.length > 0) {
    operations.push(
      prepared({
        instructions: direct,
        operation: "earnMaxCustodySetup",
        payer: input.feePayer,
        programId: input.programId,
      })
    );
  }
  if (inner.length > 0) {
    operations.push(
      await buildVaultExecution({
        ...input,
        inner,
        vault: topology.vault,
        operation: "earnMaxObligationSetup",
      })
    );
  }
  operations.push(
    prepared({
      instructions: [
        transferChecked({
          amountRaw: input.amountRaw,
          destination: topology.claimCustody,
          mint: topology.claimMint,
          owner: input.feePayer,
          source: associatedToken(input.feePayer, topology.claimMint),
        }),
      ],
      operation: "earnMaxDeposit",
      payer: input.feePayer,
      programId: TOKEN,
    })
  );
  return operations;
}

function requestId(value: string): string {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) {
    throw new Error("Earn MAX request id must be 8-64 URL-safe characters.");
  }
  return value;
}

function earnMaxIntent(
  vault: PublicKey,
  value: string
): TransactionInstruction {
  if (Buffer.byteLength(value) > 180)
    throw new Error("Earn MAX intent is too large.");
  return new TransactionInstruction({
    programId: MEMO,
    keys: [{ pubkey: vault, isSigner: true, isWritable: false }],
    data: Buffer.from(value, "utf8"),
  });
}

export async function buildEarnMaxWithdrawalRequestInstructions(input: {
  amountRaw: bigint | "max";
  connection: Connection;
  destination: PublicKey;
  feePayer: PublicKey;
  programId: PublicKey;
  requestId: string;
  settings: PublicKey;
}): Promise<EarnMaxClientOperation> {
  const topology = deriveEarnMaxTopology(input.settings);
  const amount = input.amountRaw === "max" ? "max" : input.amountRaw.toString();
  if (input.amountRaw !== "max" && input.amountRaw <= BigInt(0)) {
    throw new Error("Earn MAX withdrawal amount must be positive.");
  }
  return buildVaultExecution({
    ...input,
    vault: topology.vault,
    operation: "earnMaxWithdrawalRequest",
    inner: [
      earnMaxIntent(
        topology.vault,
        `loyal:earn-max:v1:withdraw:${requestId(
          input.requestId
        )}:${amount}:${input.destination.toBase58()}`
      ),
    ],
  });
}

export async function buildEarnMaxWithdrawalCancelInstructions(input: {
  connection: Connection;
  feePayer: PublicKey;
  programId: PublicKey;
  requestId: string;
  settings: PublicKey;
}): Promise<EarnMaxClientOperation> {
  const topology = deriveEarnMaxTopology(input.settings);
  return buildVaultExecution({
    ...input,
    vault: topology.vault,
    operation: "earnMaxWithdrawalCancel",
    inner: [
      earnMaxIntent(
        topology.vault,
        `loyal:earn-max:v1:cancel:${requestId(input.requestId)}`
      ),
    ],
  });
}

export async function buildEarnMaxClaimInstructions(input: {
  amountRaw: bigint;
  connection: Connection;
  feePayer: PublicKey;
  programId: PublicKey;
  settings: PublicKey;
}): Promise<{ destination: PublicKey; operation: EarnMaxClientOperation }> {
  const topology = deriveEarnMaxTopology(input.settings);
  const destination = associatedToken(input.feePayer, topology.claimMint);
  return {
    destination,
    operation: await buildVaultExecution({
      ...input,
      vault: topology.vault,
      operation: "earnMaxClaim",
      inner: [
        transferChecked({
          amountRaw: input.amountRaw,
          destination,
          mint: topology.claimMint,
          owner: topology.vault,
          source: topology.claimCustody,
        }),
      ],
    }),
  };
}

export async function buildEarnMaxCloseInstructions(input: {
  connection: Connection;
  feePayer: PublicKey;
  policies: readonly PublicKey[];
  programId: PublicKey;
  settings: PublicKey;
}): Promise<EarnMaxClientOperation | null> {
  const accounts = await input.connection.getMultipleAccountsInfo(
    [...input.policies],
    "confirmed"
  );
  const existing = input.policies.filter((_, index) => accounts[index]);
  if (existing.length === 0) return null;
  return createLoyalSmartAccountsClient({
    connection: input.connection,
    programId: input.programId,
  }).features.execution.prepare.executeSettingsTransactionSync({
    feePayer: input.feePayer,
    settingsPda: input.settings,
    signers: [input.feePayer],
    actions: existing.map((policy) => ({ __kind: "PolicyRemove", policy })),
    memo: "Earn MAX close",
    remainingAccounts: existing.map((pubkey) => ({
      pubkey,
      isSigner: false,
      isWritable: true,
    })),
  } as never);
}

export function deriveEarnMaxWalletClaimAta(wallet: PublicKey): PublicKey {
  return associatedToken(wallet, CLAIM_MINT);
}
