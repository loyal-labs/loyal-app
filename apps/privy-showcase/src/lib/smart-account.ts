import {
  accounts,
  codecs,
  createLoyalSmartAccountsClient,
  pda,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts";
import {
  freezePreparedOperation,
} from "@loyal-labs/loyal-smart-accounts-core";
import { Buffer } from "buffer";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { SQUADS_PROGRAM_ID } from "./constants";

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);
const CREATION_APPROVAL_MEMO =
  "Privy Loyal demo: create sponsored smart account";
// The deployed Settings layout has one variable-width COption before signers.
// Its canonical encodings therefore place the first signer at 92 (None) or
// 124 (Some). Do not add a dataSize filter: accounts may be overallocated.
const CANONICAL_SETTINGS_SIGNER_OFFSETS = [92, 124] as const;

export type PreparedSmartAccountCreation = {
  accountIndex: bigint;
  settings: PublicKey;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
};

export type ExistingSmartAccount = {
  accountIndex: bigint;
  settings: PublicKey;
  transactionIndex: bigint;
};

function decodeExactSmartAccount(args: {
  data: Buffer;
  owner: PublicKey;
  pubkey: PublicKey;
  wallet: PublicKey;
}): ExistingSmartAccount | null {
  if (!args.owner.equals(SQUADS_PROGRAM_ID)) return null;
  let settings: ReturnType<typeof accounts.Settings.deserialize>[0];
  try {
    [settings] = accounts.Settings.deserialize(args.data);
  } catch {
    return null;
  }
  const exactRoot =
    settings.threshold === 1 &&
    settings.timeLock === 0 &&
    settings.signers.length === 1 &&
    settings.signers[0]?.key.equals(args.wallet) === true &&
    settings.signers[0].permissions.mask === 0b111;
  if (!exactRoot) return null;
  return {
    accountIndex: BigInt(settings.seed.toString()),
    settings: args.pubkey,
    transactionIndex: BigInt(settings.transactionIndex.toString()),
  };
}

export async function loadExistingSmartAccount(args: {
  connection: Connection;
  settings: PublicKey;
  wallet: PublicKey;
}): Promise<ExistingSmartAccount | null> {
  const account = await args.connection.getAccountInfo(args.settings, "confirmed");
  if (!account) return null;
  return decodeExactSmartAccount({
    data: account.data,
    owner: account.owner,
    pubkey: args.settings,
    wallet: args.wallet,
  });
}

export function assertCreatedSettingsBoundary(args: {
  wallet: PublicKey;
  threshold: number;
  timeLock: number;
  signers: Array<{ key: PublicKey; permissionMask: number }>;
}): void {
  if (args.threshold !== 1)
    throw new Error("Created Settings threshold is not 1.");
  if (args.timeLock !== 0)
    throw new Error("Created Settings timelock is not zero.");
  if (args.signers.length !== 1)
    throw new Error("Created Settings must contain exactly one root signer.");
  const [signer] = args.signers;
  if (!signer?.key.equals(args.wallet))
    throw new Error("Created Settings root signer is not the Privy wallet.");
  if ((signer.permissionMask & 0b111) !== 0b111)
    throw new Error("Created Settings signer permissions are incomplete.");
}

export async function findExistingSmartAccount(args: {
  connection: Connection;
  wallet: PublicKey;
}): Promise<ExistingSmartAccount | null> {
  const rowGroups = await Promise.all(
    CANONICAL_SETTINGS_SIGNER_OFFSETS.map((signerOffset) =>
      args.connection.getProgramAccounts(SQUADS_PROGRAM_ID, {
        commitment: "confirmed",
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: bs58.encode(Uint8Array.from(accounts.settingsDiscriminator)),
            },
          },
          {
            memcmp: {
              offset: signerOffset,
              bytes: args.wallet.toBase58(),
            },
          },
        ],
      })
    )
  );
  const rows = [
    ...new Map(
      rowGroups
        .flat()
        .map((row) => [row.pubkey.toBase58(), row] as const)
    ).values(),
  ];
  const matches: ExistingSmartAccount[] = [];

  for (const row of rows) {
    const match = decodeExactSmartAccount({
      data: row.account.data,
      owner: row.account.owner,
      pubkey: row.pubkey,
      wallet: args.wallet,
    });
    if (match) matches.push(match);
  }

  // Repeated demo attempts may have created more than one valid account. Reuse
  // the newest one deterministically instead of offering to create yet another.
  matches.sort((a, b) =>
    a.accountIndex === b.accountIndex
      ? b.settings.toBase58().localeCompare(a.settings.toBase58())
      : a.accountIndex > b.accountIndex
        ? -1
        : 1
  );
  return matches[0] ?? null;
}

export async function prepareSmartAccountCreation(args: {
  connection: Connection;
  sponsor: PublicKey;
  wallet: PublicKey;
}): Promise<PreparedSmartAccountCreation> {
  const client = createLoyalSmartAccountsClient({
    connection: args.connection,
    programId: SQUADS_PROGRAM_ID,
  });
  const programConfigPda = pda.getProgramConfigPda({
    programId: SQUADS_PROGRAM_ID,
  })[0];
  const programConfig = await client.programConfig.queries.fetchProgramConfig(
    programConfigPda,
    "confirmed"
  );
  const accountIndex = BigInt(programConfig.smartAccountIndex.toString()) + 1n;
  const settings = pda.getSettingsPda({
    accountIndex,
    programId: SQUADS_PROGRAM_ID,
  })[0];
  const prepared = await client.features.smartAccounts.prepare.create({
    programId: SQUADS_PROGRAM_ID,
    treasury: programConfig.treasury,
    creator: args.sponsor,
    settings,
    settingsAuthority: null,
    threshold: 1,
    signers: [{ key: args.wallet, permissions: codecs.Permissions.all() }],
    timeLock: 0,
    rentCollector: null,
    memo: "Loyal Privy Earn demo",
  });
  const approval = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: args.wallet, isSigner: true, isWritable: false }],
    data: Buffer.from(CREATION_APPROVAL_MEMO, "utf8"),
  });
  return {
    accountIndex,
    settings,
    prepared: freezePreparedOperation({
      ...prepared,
      payer: args.sponsor,
      instructions: [...prepared.instructions, approval],
    }),
  };
}
