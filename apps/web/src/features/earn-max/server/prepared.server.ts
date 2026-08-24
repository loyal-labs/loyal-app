import "server-only";

import {
  EARN_MAX_VAULT_INDEX,
  createEarnMaxPolicyManifest,
  deriveEarnMaxTopology,
} from "@loyal-labs/actions";
import {
  codecs,
  createLoyalSmartAccountsClient,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";

const KLEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const FARMS = new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MARKET_AUTHORITY = new PublicKey("6QbtpY2jDNcncRFmVf343NThnCdaY8gCAsYATPnYQR9g");
const USER_METADATA_SEED = Buffer.from("user_meta");
const INIT_USER_METADATA = [117, 169, 176, 69, 197, 23, 15, 162] as const;
const INIT_OBLIGATION = [251, 10, 231, 76, 27, 11, 159, 96] as const;
const INIT_OBLIGATION_FARM = [136, 63, 15, 186, 211, 152, 168, 164] as const;
const SETUP_RENT_BUFFER_LAMPORTS = 39_532_800;

type Prepared = PreparedLoyalSmartAccountsOperation<string>;

function prepared(input: Omit<Prepared, "lookupTableAccounts" | "requiresConfirmation">): Prepared {
  return {
    ...input,
    lookupTableAccounts: [],
    requiresConfirmation: true,
  };
}

function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN
  )[0];
}

function createAta(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  const account = ata(owner, mint);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: account, isSigner: false, isWritable: true },
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

async function prepareVaultExecution(input: {
  connection: Connection;
  feePayer: PublicKey;
  inner: TransactionInstruction[];
  programId: PublicKey;
  settings: PublicKey;
  vault: PublicKey;
  operation: string;
}): Promise<Prepared> {
  const compiled = codecs.compileToSynchronousMessageAndAccountsV2({
    vaultPda: input.vault,
    members: [input.feePayer],
    instructions: input.inner,
  });
  const client = createLoyalSmartAccountsClient({
    connection: input.connection,
    programId: input.programId,
  });
  const operation = await client.features.execution.prepare.executeTransactionSyncV2({
    feePayer: input.feePayer,
    settingsPda: input.settings,
    accountIndex: EARN_MAX_VAULT_INDEX,
    numSigners: 1,
    instructions: compiled.instructions,
    instruction_accounts: compiled.accounts,
  } as never);
  return { ...operation, operation: input.operation };
}

export async function prepareEarnMaxInstall(input: {
  connection: Connection;
  delegatedSigner: PublicKey;
  feePayer: PublicKey;
  firstPolicySeed?: bigint;
  programId: PublicKey;
  settings: PublicKey;
  matchingPolicyAccounts: ReadonlySet<string>;
}): Promise<Prepared[]> {
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
  return manifest.flatMap((entry, index) =>
    accounts[index] && input.matchingPolicyAccounts.has(entry.policy.toBase58())
      ? []
      : [
          prepared({
            instructions: [accounts[index] ? entry.updateInstruction : entry.instruction],
            operation: `earnMaxInstall:${accounts[index] ? "update" : "create"}:${entry.family}`,
            payer: input.feePayer,
            programId: input.programId,
          }),
        ]
  );
}

function createInitUserMetadata(vault: PublicKey, userMetadata: PublicKey): TransactionInstruction {
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

export async function prepareEarnMaxDeposit(input: {
  amountRaw: bigint;
  connection: Connection;
  feePayer: PublicKey;
  programId: PublicKey;
  settings: PublicKey;
}): Promise<Prepared[]> {
  const topology = deriveEarnMaxTopology(input.settings);
  const walletClaim = ata(input.feePayer, topology.claimMint);
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
  const directSetup: TransactionInstruction[] = [];
  if (!claimInfo) directSetup.push(createAta(input.feePayer, topology.vault, topology.claimMint));
  if (!collateralInfo) directSetup.push(createAta(input.feePayer, topology.vault, topology.collateralMint));

  const innerSetup: TransactionInstruction[] = [];
  if (!metadataInfo) innerSetup.push(createInitUserMetadata(topology.vault, userMetadata));
  if (!obligationInfo) {
    innerSetup.push(
      new TransactionInstruction({
        programId: KLEND,
        keys: [
          { pubkey: topology.vault, isSigner: true, isWritable: false },
          { pubkey: topology.vault, isSigner: true, isWritable: true },
          { pubkey: topology.obligation, isSigner: false, isWritable: true },
          { pubkey: topology.market, isSigner: false, isWritable: false },
          { pubkey: topology.collateralMint, isSigner: false, isWritable: false },
          { pubkey: topology.claimMint, isSigner: false, isWritable: false },
          { pubkey: userMetadata, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([...INIT_OBLIGATION, 1, 0]),
      })
    );
  }
  if (!farmInfo) {
    innerSetup.push(
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
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([...INIT_OBLIGATION_FARM, 1]),
      })
    );
  }

  const operations: Prepared[] = [];
  if (innerSetup.length > 0) {
    const vaultLamports = await input.connection.getBalance(topology.vault, "confirmed");
    const topUp = Math.max(0, SETUP_RENT_BUFFER_LAMPORTS - vaultLamports);
    if (topUp > 0) {
      directSetup.unshift(
        SystemProgram.transfer({
          fromPubkey: input.feePayer,
          toPubkey: topology.vault,
          lamports: topUp,
        })
      );
    }
  }
  if (directSetup.length > 0) {
    operations.push(
      prepared({
        instructions: directSetup,
        operation: "earnMaxCustodySetup",
        payer: input.feePayer,
        programId: input.programId,
      })
    );
  }
  if (innerSetup.length > 0) {
    operations.push(
      await prepareVaultExecution({
        ...input,
        inner: innerSetup,
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
          source: walletClaim,
        }),
      ],
      operation: "earnMaxDeposit",
      payer: input.feePayer,
      programId: TOKEN,
    })
  );
  return operations;
}

export async function prepareEarnMaxClaim(input: {
  amountRaw: bigint;
  connection: Connection;
  feePayer: PublicKey;
  programId: PublicKey;
  settings: PublicKey;
}): Promise<{ destination: PublicKey; operation: Prepared }> {
  const topology = deriveEarnMaxTopology(input.settings);
  const destination = ata(input.feePayer, topology.claimMint);
  const operation = await prepareVaultExecution({
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
  });
  return { destination, operation };
}

export async function prepareEarnMaxClose(input: {
  connection: Connection;
  feePayer: PublicKey;
  policies: readonly PublicKey[];
  programId: PublicKey;
  settings: PublicKey;
}): Promise<Prepared | null> {
  const accounts = await input.connection.getMultipleAccountsInfo([...input.policies], "confirmed");
  const existing = input.policies.filter((_, index) => accounts[index]);
  if (existing.length === 0) return null;
  return createSmartAccountVaultsClient({
    connection: input.connection,
    programId: input.programId,
  }).prepareClosePoliciesSync({
    feePayer: input.feePayer,
    settingsPda: input.settings,
    signers: [input.feePayer],
    policies: existing,
    memo: "Earn MAX close",
  });
}

export function deriveEarnMaxWalletClaimAta(wallet: PublicKey): PublicKey {
  return ata(wallet, deriveEarnMaxTopology(PublicKey.default).claimMint);
}
