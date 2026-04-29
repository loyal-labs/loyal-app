import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { inflateSync } from "node:zlib";

import bs58 from "bs58";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  type AccountInfo,
  type Commitment,
  type GetProgramAccountsFilter,
} from "@solana/web3.js";

const MAINNET_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://solana-rpc.publicnode.com";
const MAINNET_EXPLORER_CLUSTER = "mainnet-beta";

const PRIVATE_TRANSFER_PROGRAM_ID = new PublicKey(
  "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV"
);
const VERIFICATION_PROGRAM_ID = new PublicKey(
  "9yiphKYd4b69tR1ZPP8rNwtMeUwWgjYXaXdEzyNziNhz"
);
const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);
const PERMISSION_PROGRAM_ID = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
);

const CURRENT_DEPOSIT_SEED = Buffer.from("deposit_v2");
const LEGACY_DEPOSIT_SEED = Buffer.from("deposit");
const CURRENT_USERNAME_DEPOSIT_SEED = Buffer.from("username_deposit_v2");
const LEGACY_USERNAME_DEPOSIT_SEED = Buffer.from("username_deposit");
const VAULT_SEED = Buffer.from("vault");
const CURRENT_SESSION_SEED = Buffer.from("tg_session_v2");
const LEGACY_SESSION_SEED = Buffer.from("tg_session");
const PERMISSION_SEED = Buffer.from("permission:");

const AUTHORITY_FLAG = 1 << 0;

const DEPOSIT_DISCRIMINATOR = accountDiscriminator("Deposit");
const USERNAME_DEPOSIT_DISCRIMINATOR = accountDiscriminator("UsernameDeposit");
const VAULT_DISCRIMINATOR = accountDiscriminator("Vault");
const TELEGRAM_SESSION_DISCRIMINATOR = accountDiscriminator("TelegramSession");

const DEFAULT_OUT_PATH = resolve(
  process.cwd(),
  "scripts/output/pda-audit-mainnet.html"
);

type Args = {
  rpcUrl: string;
  outPath: string;
  concurrency: number;
  commitment: Commitment;
};

type SourceOwner =
  | "private_transfer_program"
  | "verification_program"
  | "delegation_program"
  | "permission_program";

type DecodeStatus = "full" | "partial" | "failed";

type RawAccount = {
  address: PublicKey;
  lamports: number;
  owner: PublicKey;
  data: Buffer;
  sourceOwner: SourceOwner;
};

type MintMeta = {
  decimals: number | null;
};

type PermissionSlot = {
  flags: number;
  pubkey: PublicKey;
};

type PermissionDecoded = {
  bump: number;
  permissionedAccount: PublicKey;
  memberCount: number;
  reserved: number;
  slots: PermissionSlot[];
};

type DepositDecoded = {
  user: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
};

type UsernameDepositDecoded =
  | {
      layout: "current-hash";
      usernameHash: Buffer;
      tokenMint: PublicKey;
      amount: bigint;
    }
  | {
      layout: "legacy-string";
      username: string;
      tokenMint: PublicKey;
      amount: bigint;
    };

type SessionDecoded =
  | {
      layout: "current-hash";
      user: PublicKey;
      usernameHash: Buffer;
      validationBytes: Buffer;
      verified: boolean;
      authAt: bigint;
      verifiedAt: bigint | null;
    }
  | {
      layout: "legacy-string";
      user: PublicKey;
      username: string;
      validationBytes: Buffer;
      verified: boolean;
      authAt: bigint;
      verifiedAt: bigint | null;
    };

type IdlDecoded = {
  authority: PublicKey;
  compressedLength: number;
  jsonPreview: string;
};

type DepositAuditRow = {
  kind: "deposit";
  address: PublicKey;
  lamports: number;
  updatedAt: number | null;
  sourceOwner: SourceOwner;
  status: DecodeStatus;
  user: PublicKey | null;
  tokenMint: PublicKey | null;
  amountBase: bigint | null;
  isDelegated: boolean;
};

type UsernameDepositAuditRow = {
  kind: "usernameDeposit";
  address: PublicKey;
  lamports: number;
  updatedAt: number | null;
  sourceOwner: SourceOwner;
  status: DecodeStatus;
  usernameHash: Buffer | null;
  tokenMint: PublicKey | null;
  amountBase: bigint | null;
  isDelegated: boolean;
};

type VaultAuditRow = {
  kind: "vault";
  address: PublicKey;
  lamports: number;
  updatedAt: number | null;
  sourceOwner: SourceOwner;
  status: DecodeStatus;
  tokenMint: PublicKey | null;
  vaultAta: PublicKey | null;
  amountRaw: bigint | null;
  amountUi: string | null;
  isDelegated: boolean;
};

type SessionAuditRow = {
  kind: "telegramSession";
  address: PublicKey;
  lamports: number;
  updatedAt: number | null;
  sourceOwner: SourceOwner;
  status: DecodeStatus;
  user: PublicKey | null;
  usernameHash: Buffer | null;
  verified: boolean | null;
  authAt: bigint | null;
  verifiedAt: bigint | null;
  validationBytes: Buffer | null;
};

type PermissionAuditRow = {
  kind: "depositPermission" | "usernameDepositPermission";
  address: PublicKey;
  lamports: number;
  updatedAt: number | null;
  sourceOwner: SourceOwner;
  status: DecodeStatus;
  permissionedAccount: PublicKey | null;
  authorityMembers: PublicKey[];
  underlyingType: "deposit" | "usernameDeposit" | "unknown";
  underlyingProgramOwner: PublicKey | null;
  isDelegated: boolean;
};

type LegacyAuditRow = {
  address: PublicKey;
  lamports: number;
  updatedAt: number | null;
  sourceOwner: SourceOwner;
  status: DecodeStatus;
  bestEffortSeedMatch: string;
  bestEffortDecodedData: string;
};

type KnownUnderlyingRow =
  | DepositAuditRow
  | UsernameDepositAuditRow;

type PermissionUnderlyingInfo = {
  address: PublicKey;
  kind: "deposit" | "usernameDeposit";
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const connection = new Connection(args.rpcUrl, {
    commitment: args.commitment,
    disableRetryOnRateLimit: false,
  });

  const privateTransferProgramAccounts = await fetchProgramAccounts(
    connection,
    PRIVATE_TRANSFER_PROGRAM_ID,
    "private_transfer_program"
  );
  const verificationProgramAccounts = await fetchProgramAccounts(
    connection,
    VERIFICATION_PROGRAM_ID,
    "verification_program"
  );
  const delegatedDepositAccounts = await fetchProgramAccounts(
    connection,
    DELEGATION_PROGRAM_ID,
    "delegation_program",
    [{ memcmp: { offset: 0, bytes: bs58.encode(DEPOSIT_DISCRIMINATOR) } }]
  );
  const delegatedUsernameDepositAccounts = await fetchProgramAccounts(
    connection,
    DELEGATION_PROGRAM_ID,
    "delegation_program",
    [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(USERNAME_DEPOSIT_DISCRIMINATOR),
        },
      },
    ]
  );
  const delegatedVaultAccounts = await fetchProgramAccounts(
    connection,
    DELEGATION_PROGRAM_ID,
    "delegation_program",
    [{ memcmp: { offset: 0, bytes: bs58.encode(VAULT_DISCRIMINATOR) } }]
  );

  const depositRows: DepositAuditRow[] = [];
  const usernameDepositRows: UsernameDepositAuditRow[] = [];
  const vaultCandidates: RawAccount[] = [];
  const sessionRows: SessionAuditRow[] = [];
  const legacyRows: LegacyAuditRow[] = [];
  const permissionUnderlyingRows: PermissionUnderlyingInfo[] = [];

  const allPrivateTransferAccounts = [
    ...privateTransferProgramAccounts,
    ...delegatedDepositAccounts,
    ...delegatedUsernameDepositAccounts,
    ...delegatedVaultAccounts,
  ];

  for (const account of allPrivateTransferAccounts) {
    if (startsWith(account.data, DEPOSIT_DISCRIMINATOR)) {
      const decoded = tryParseDeposit(account.data);
      if (!decoded) {
        legacyRows.push({
          address: account.address,
          lamports: account.lamports,
          updatedAt: null,
          sourceOwner: account.sourceOwner,
          status: "failed",
          bestEffortSeedMatch: "deposit (decode failed)",
          bestEffortDecodedData: `owner=${account.owner.toBase58()} len=${account.data.length}`,
        });
        continue;
      }

      const currentAddress = findProgramAddress(
        [CURRENT_DEPOSIT_SEED, decoded.user.toBuffer(), decoded.tokenMint.toBuffer()],
        PRIVATE_TRANSFER_PROGRAM_ID
      );
      const legacyAddress = findProgramAddress(
        [LEGACY_DEPOSIT_SEED, decoded.user.toBuffer(), decoded.tokenMint.toBuffer()],
        PRIVATE_TRANSFER_PROGRAM_ID
      );

      if (currentAddress.equals(account.address)) {
        depositRows.push({
          kind: "deposit",
          address: account.address,
          lamports: account.lamports,
          updatedAt: null,
          sourceOwner: account.sourceOwner,
          status: "full",
          user: decoded.user,
          tokenMint: decoded.tokenMint,
          amountBase: decoded.amount,
          isDelegated: account.sourceOwner === "delegation_program",
        });
        permissionUnderlyingRows.push({
          address: account.address,
          kind: "deposit",
        });
        continue;
      }

      if (legacyAddress.equals(account.address)) {
        permissionUnderlyingRows.push({
          address: account.address,
          kind: "deposit",
        });
        legacyRows.push({
          address: account.address,
          lamports: account.lamports,
          updatedAt: null,
          sourceOwner: account.sourceOwner,
          status: "partial",
          bestEffortSeedMatch: "deposit",
          bestEffortDecodedData: `Deposit { user=${decoded.user.toBase58()}, token=${decoded.tokenMint.toBase58()}, amountBase=${decoded.amount.toString()}, delegated=${String(account.sourceOwner === "delegation_program")} }`,
        });
      }

      continue;
    }

    if (startsWith(account.data, USERNAME_DEPOSIT_DISCRIMINATOR)) {
      const currentDecoded = tryParseCurrentUsernameDeposit(account.data);
      if (currentDecoded?.layout === "current-hash") {
        const currentAddress = findProgramAddress(
          [
            CURRENT_USERNAME_DEPOSIT_SEED,
            currentDecoded.usernameHash,
            currentDecoded.tokenMint.toBuffer(),
          ],
          PRIVATE_TRANSFER_PROGRAM_ID
        );

        if (currentAddress.equals(account.address)) {
          usernameDepositRows.push({
            kind: "usernameDeposit",
            address: account.address,
            lamports: account.lamports,
            updatedAt: null,
            sourceOwner: account.sourceOwner,
            status: "full",
            usernameHash: currentDecoded.usernameHash,
            tokenMint: currentDecoded.tokenMint,
            amountBase: currentDecoded.amount,
            isDelegated: account.sourceOwner === "delegation_program",
          });
          permissionUnderlyingRows.push({
            address: account.address,
            kind: "usernameDeposit",
          });
          continue;
        }
      }

      const legacyDecoded = tryParseLegacyUsernameDeposit(account.data);
      if (legacyDecoded?.layout === "legacy-string") {
        const legacyAddress = findProgramAddress(
          [
            LEGACY_USERNAME_DEPOSIT_SEED,
            Buffer.from(legacyDecoded.username),
            legacyDecoded.tokenMint.toBuffer(),
          ],
          PRIVATE_TRANSFER_PROGRAM_ID
        );

        if (legacyAddress.equals(account.address)) {
          permissionUnderlyingRows.push({
            address: account.address,
            kind: "usernameDeposit",
          });
          legacyRows.push({
            address: account.address,
            lamports: account.lamports,
            updatedAt: null,
            sourceOwner: account.sourceOwner,
            status: "partial",
            bestEffortSeedMatch: "username_deposit",
            bestEffortDecodedData: `UsernameDeposit { username=${legacyDecoded.username}, token=${legacyDecoded.tokenMint.toBase58()}, amountBase=${legacyDecoded.amount.toString()}, delegated=${String(account.sourceOwner === "delegation_program")} }`,
          });
          continue;
        }
      }

      legacyRows.push({
        address: account.address,
        lamports: account.lamports,
        updatedAt: null,
        sourceOwner: account.sourceOwner,
        status: "failed",
        bestEffortSeedMatch: "username_deposit (?)",
        bestEffortDecodedData: `owner=${account.owner.toBase58()} len=${account.data.length} disc=${account.data.subarray(0, 8).toString("hex")}`,
      });
      continue;
    }

    if (startsWith(account.data, VAULT_DISCRIMINATOR)) {
      vaultCandidates.push(account);
    }
  }

  for (const account of verificationProgramAccounts) {
    if (startsWith(account.data, TELEGRAM_SESSION_DISCRIMINATOR)) {
      const currentDecoded = tryParseCurrentSession(account.data);
      if (currentDecoded?.layout === "current-hash") {
        const currentAddress = findProgramAddress(
          [CURRENT_SESSION_SEED, currentDecoded.user.toBuffer()],
          VERIFICATION_PROGRAM_ID
        );
        if (currentAddress.equals(account.address)) {
          sessionRows.push({
            kind: "telegramSession",
            address: account.address,
            lamports: account.lamports,
            updatedAt: null,
            sourceOwner: account.sourceOwner,
            status: "full",
            user: currentDecoded.user,
            usernameHash: currentDecoded.usernameHash,
            verified: currentDecoded.verified,
            authAt: currentDecoded.authAt,
            verifiedAt: currentDecoded.verifiedAt,
            validationBytes: currentDecoded.validationBytes,
          });
          continue;
        }
      }

      const legacyDecoded = tryParseLegacySession(account.data);
      if (legacyDecoded?.layout === "legacy-string") {
        const legacyAddress = findProgramAddress(
          [LEGACY_SESSION_SEED, legacyDecoded.user.toBuffer()],
          VERIFICATION_PROGRAM_ID
        );
        if (legacyAddress.equals(account.address)) {
          legacyRows.push({
            address: account.address,
            lamports: account.lamports,
            updatedAt: null,
            sourceOwner: account.sourceOwner,
            status: "partial",
            bestEffortSeedMatch: "tg_session",
            bestEffortDecodedData: `TelegramSession { user=${legacyDecoded.user.toBase58()}, username=${legacyDecoded.username}, verified=${String(legacyDecoded.verified)}, authAt=${legacyDecoded.authAt.toString()}, verifiedAt=${legacyDecoded.verifiedAt?.toString() ?? "null"}, validationBytes=${legacyDecoded.validationBytes.length} bytes }`,
          });
          continue;
        }
      }

      const fallbackCurrentUser = tryReadPubkey(account.data, 8);
      legacyRows.push({
        address: account.address,
        lamports: account.lamports,
        updatedAt: null,
        sourceOwner: account.sourceOwner,
        status: "partial",
        bestEffortSeedMatch: fallbackCurrentUser
          ? "unmatched session-like PDA"
          : "session decode failed",
        bestEffortDecodedData: fallbackCurrentUser
          ? `candidateUser=${fallbackCurrentUser.toBase58()} len=${account.data.length}`
          : `disc=${account.data.subarray(0, 8).toString("hex")} len=${account.data.length}`,
      });
      continue;
    }

    const anchorIdlAddress = await findAnchorIdlAddress(VERIFICATION_PROGRAM_ID);
    if (anchorIdlAddress.equals(account.address)) {
      const idlDecoded = tryParseAnchorIdlAccount(account.data);
      legacyRows.push({
        address: account.address,
        lamports: account.lamports,
        updatedAt: null,
        sourceOwner: account.sourceOwner,
        status: idlDecoded ? "partial" : "failed",
        bestEffortSeedMatch: "anchor:idl",
        bestEffortDecodedData: idlDecoded
          ? `Anchor IDL { authority=${idlDecoded.authority.toBase58()}, compressedBytes=${idlDecoded.compressedLength}, preview=${idlDecoded.jsonPreview} }`
          : `disc=${account.data.subarray(0, 8).toString("hex")} len=${account.data.length}`,
      });
      continue;
    }

    legacyRows.push({
      address: account.address,
      lamports: account.lamports,
      updatedAt: null,
      sourceOwner: account.sourceOwner,
      status: "failed",
      bestEffortSeedMatch: "unknown verification PDA",
      bestEffortDecodedData: `disc=${account.data.subarray(0, 8).toString("hex")} len=${account.data.length}`,
    });
  }

  const knownUnderlyingRows: KnownUnderlyingRow[] = [
    ...depositRows,
    ...usernameDepositRows,
  ];
  const currentUnderlyingByAddress = new Map(
    knownUnderlyingRows.map((row) => [row.address.toBase58(), row] as const)
  );
  const permissionUnderlyingByAddress = new Map(
    permissionUnderlyingRows.map((row) => [row.address.toBase58(), row] as const)
  );

  const permissionProgramAccounts = await fetchProgramAccounts(
    connection,
    PERMISSION_PROGRAM_ID,
    "permission_program"
  );
  const delegatedPermissionCandidates = await fetchProgramAccounts(
    connection,
    DELEGATION_PROGRAM_ID,
    "delegation_program",
    [{ dataSize: 567 }]
  );

  const permissionRows: PermissionAuditRow[] = [];
  const seenPermissionAddresses = new Set<string>();

  const permissionRawAccounts = [
    ...permissionProgramAccounts,
    ...delegatedPermissionCandidates,
  ];

  for (const account of permissionRawAccounts) {
    const decoded = tryParsePermissionAccount(account.data);
    if (!decoded) {
      continue;
    }

    const permissionUnderlying = permissionUnderlyingByAddress.get(
      decoded.permissionedAccount.toBase58()
    );
    if (!permissionUnderlying) {
      continue;
    }
    const currentUnderlying = currentUnderlyingByAddress.get(
      decoded.permissionedAccount.toBase58()
    );

    const addressKey = account.address.toBase58();
    if (seenPermissionAddresses.has(addressKey)) {
      continue;
    }
    seenPermissionAddresses.add(addressKey);

    const authorityMembers = decoded.slots
      .filter(
        (slot) =>
          (slot.flags & AUTHORITY_FLAG) !== 0 &&
          !slot.pubkey.equals(PublicKey.default) &&
          !slot.pubkey.equals(PRIVATE_TRANSFER_PROGRAM_ID)
      )
      .map((slot) => slot.pubkey);

    permissionRows.push({
      kind:
        permissionUnderlying.kind === "deposit"
          ? "depositPermission"
          : "usernameDepositPermission",
      address: account.address,
      lamports: account.lamports,
      updatedAt: null,
      sourceOwner: account.sourceOwner,
      status: authorityMembers.length > 0 ? "full" : "partial",
      permissionedAccount: decoded.permissionedAccount,
      authorityMembers,
      underlyingType:
        permissionUnderlying.kind === "deposit" ? "deposit" : "usernameDeposit",
      underlyingProgramOwner:
        currentUnderlying?.kind === "deposit" ||
        currentUnderlying?.kind === "usernameDeposit"
          ? PRIVATE_TRANSFER_PROGRAM_ID
          : null,
      isDelegated: account.sourceOwner === "delegation_program",
    });
  }

  const uniqueMints = new Map<string, PublicKey>();
  for (const row of [...depositRows, ...usernameDepositRows]) {
    if (row.tokenMint) {
      uniqueMints.set(row.tokenMint.toBase58(), row.tokenMint);
    }
  }

  const mintMetaByAddress = await fetchMintMetadata(
    connection,
    Array.from(uniqueMints.values())
  );

  const vaultRows = await buildVaultRows(
    connection,
    vaultCandidates,
    Array.from(uniqueMints.values()),
    mintMetaByAddress
  );

  const updatedAtTargets = new Map<string, PublicKey[]>();
  for (const row of depositRows) {
    updatedAtTargets.set(row.address.toBase58(), [row.address]);
  }
  for (const row of usernameDepositRows) {
    updatedAtTargets.set(row.address.toBase58(), [row.address]);
  }
  for (const row of sessionRows) {
    updatedAtTargets.set(row.address.toBase58(), [row.address]);
  }
  for (const row of permissionRows) {
    updatedAtTargets.set(row.address.toBase58(), [row.address]);
  }
  for (const row of legacyRows) {
    updatedAtTargets.set(row.address.toBase58(), [row.address]);
  }
  for (const row of vaultRows) {
    updatedAtTargets.set(
      row.address.toBase58(),
      row.vaultAta ? [row.vaultAta, row.address] : [row.address]
    );
  }

  const updatedAtByKey = await fetchUpdatedAtMap(
    connection,
    Array.from(updatedAtTargets.entries()),
    args.concurrency
  );

  for (const row of depositRows) {
    row.updatedAt = updatedAtByKey.get(row.address.toBase58()) ?? null;
  }
  for (const row of usernameDepositRows) {
    row.updatedAt = updatedAtByKey.get(row.address.toBase58()) ?? null;
  }
  for (const row of sessionRows) {
    row.updatedAt = updatedAtByKey.get(row.address.toBase58()) ?? null;
  }
  for (const row of permissionRows) {
    row.updatedAt = updatedAtByKey.get(row.address.toBase58()) ?? null;
  }
  for (const row of legacyRows) {
    row.updatedAt = updatedAtByKey.get(row.address.toBase58()) ?? null;
  }
  for (const row of vaultRows) {
    row.updatedAt = updatedAtByKey.get(row.address.toBase58()) ?? null;
  }

  sortByUpdatedAt(depositRows);
  sortByUpdatedAt(usernameDepositRows);
  sortByUpdatedAt(vaultRows);
  sortByUpdatedAt(sessionRows);
  sortByUpdatedAt(permissionRows);
  sortByUpdatedAt(legacyRows);

  const html = renderHtml({
    generatedAt: new Date(),
    rpcUrl: args.rpcUrl,
    depositRows,
    usernameDepositRows,
    vaultRows,
    sessionRows,
    permissionRows,
    legacyRows,
    mintMetaByAddress,
  });

  mkdirSync(dirname(args.outPath), { recursive: true });
  writeFileSync(args.outPath, html, "utf8");

  console.log(
    JSON.stringify(
      {
        outPath: args.outPath,
        deposits: depositRows.length,
        depositPermissions: permissionRows.filter(
          (row) => row.kind === "depositPermission"
        ).length,
        usernameDeposits: usernameDepositRows.length,
        usernameDepositPermissions: permissionRows.filter(
          (row) => row.kind === "usernameDepositPermission"
        ).length,
        vaults: vaultRows.length,
        telegramSessions: sessionRows.length,
        legacy: legacyRows.length,
      },
      null,
      2
    )
  );
}

function parseArgs(argv: string[]): Args {
  let rpcUrl = MAINNET_RPC_URL;
  let outPath = DEFAULT_OUT_PATH;
  let concurrency = 4;
  let commitment: Commitment = "confirmed";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if ((arg === "--rpc-url" || arg === "-r") && next) {
      rpcUrl = next;
      index += 1;
      continue;
    }

    if ((arg === "--out" || arg === "-o") && next) {
      outPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (arg === "--concurrency" && next) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--concurrency must be a positive integer");
      }
      concurrency = parsed;
      index += 1;
      continue;
    }

    if (arg === "--commitment" && next) {
      if (next !== "processed" && next !== "confirmed" && next !== "finalized") {
        throw new Error("--commitment must be processed, confirmed, or finalized");
      }
      commitment = next;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: bun scripts/generate-pda-audit.ts [options]

Options:
  --rpc-url, -r <url>       Solana RPC URL (default: repo Helius mainnet)
  --out, -o <path>          Output HTML file (default: scripts/output/pda-audit-mainnet.html)
  --concurrency <n>         Parallel signature/account fetches (default: 8)
  --commitment <level>      processed | confirmed | finalized (default: confirmed)
  --help, -h                Show this help
`);
      process.exit(0);
    }
  }

  return { rpcUrl, outPath, concurrency, commitment };
}

function accountDiscriminator(name: string): Buffer {
  return createHash("sha256")
    .update(`account:${name}`)
    .digest()
    .subarray(0, 8);
}

function startsWith(data: Buffer, prefix: Buffer) {
  return data.length >= prefix.length && data.subarray(0, prefix.length).equals(prefix);
}

function readU32LE(data: Buffer, offset: number): number {
  if (offset + 4 > data.length) {
    throw new Error("short u32");
  }
  return data.readUInt32LE(offset);
}

function readU64LE(data: Buffer, offset: number): bigint {
  if (offset + 8 > data.length) {
    throw new Error("short u64");
  }
  return data.readBigUInt64LE(offset);
}

function tryReadPubkey(data: Buffer, offset: number): PublicKey | null {
  if (offset + 32 > data.length) {
    return null;
  }

  try {
    return new PublicKey(data.subarray(offset, offset + 32));
  } catch {
    return null;
  }
}

async function fetchProgramAccounts(
  connection: Connection,
  programId: PublicKey,
  sourceOwner: SourceOwner,
  filters?: GetProgramAccountsFilter[]
): Promise<RawAccount[]> {
  const response = await withRetry(() =>
    connection.getProgramAccounts(programId, filters ? { filters } : undefined)
  );

  return response.map((account) => ({
    address: account.pubkey,
    lamports: account.account.lamports,
    owner: account.account.owner,
    data: Buffer.from(account.account.data),
    sourceOwner,
  }));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 5,
  baseDelayMs = 400
): Promise<T> {
  let error: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (caught) {
      error = caught;
      if (attempt === attempts - 1) {
        break;
      }

      await sleep(baseDelayMs * 2 ** attempt);
    }
  }

  throw error;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index] as T, index);
      }
    }
  );

  await Promise.all(runners);
  return results;
}

function findProgramAddress(seeds: Buffer[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function tryParseDeposit(data: Buffer): DepositDecoded | null {
  try {
    if (data.length < 80) {
      return null;
    }

    return {
      user: new PublicKey(data.subarray(8, 40)),
      tokenMint: new PublicKey(data.subarray(40, 72)),
      amount: readU64LE(data, 72),
    };
  } catch {
    return null;
  }
}

function tryParseCurrentUsernameDeposit(data: Buffer): UsernameDepositDecoded | null {
  try {
    if (data.length < 80) {
      return null;
    }

    return {
      layout: "current-hash",
      usernameHash: Buffer.from(data.subarray(8, 40)),
      tokenMint: new PublicKey(data.subarray(40, 72)),
      amount: readU64LE(data, 72),
    };
  } catch {
    return null;
  }
}

function tryParseLegacyUsernameDeposit(data: Buffer): UsernameDepositDecoded | null {
  try {
    if (data.length < 57) {
      return null;
    }

    const usernameLength = readU32LE(data, 8);
    if (usernameLength < 1 || usernameLength > 64) {
      return null;
    }

    const usernameStart = 12;
    const usernameEnd = usernameStart + usernameLength;
    if (usernameEnd + 40 > data.length) {
      return null;
    }

    const username = data.subarray(usernameStart, usernameEnd).toString("utf8");
    if (!username || /[\u0000-\u001f]/.test(username)) {
      return null;
    }

    const tokenMint = new PublicKey(data.subarray(usernameEnd, usernameEnd + 32));
    const amount = readU64LE(data, usernameEnd + 32);

    return {
      layout: "legacy-string",
      username,
      tokenMint,
      amount,
    };
  } catch {
    return null;
  }
}

function tryParseCurrentSession(data: Buffer): SessionDecoded | null {
  try {
    let offset = 8;
    const user = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const usernameHash = Buffer.from(data.subarray(offset, offset + 32));
    offset += 32;

    const validationLength = readU32LE(data, offset);
    offset += 4;
    if (validationLength < 0 || offset + validationLength + 10 > data.length) {
      return null;
    }

    const validationBytes = Buffer.from(data.subarray(offset, offset + validationLength));
    offset += validationLength;

    const verifiedByte = data[offset];
    if (verifiedByte !== 0 && verifiedByte !== 1) {
      return null;
    }
    const verified = verifiedByte === 1;
    offset += 1;

    const authAt = readU64LE(data, offset);
    offset += 8;

    const option = data[offset];
    offset += 1;
    let verifiedAt: bigint | null = null;
    if (option === 1) {
      verifiedAt = readU64LE(data, offset);
    } else if (option !== 0) {
      return null;
    }

    return {
      layout: "current-hash",
      user,
      usernameHash,
      validationBytes,
      verified,
      authAt,
      verifiedAt,
    };
  } catch {
    return null;
  }
}

function tryParseLegacySession(data: Buffer): SessionDecoded | null {
  try {
    let offset = 8;
    const user = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const usernameLength = readU32LE(data, offset);
    offset += 4;
    if (usernameLength < 1 || usernameLength > 128) {
      return null;
    }
    if (offset + usernameLength + 13 > data.length) {
      return null;
    }

    const username = data.subarray(offset, offset + usernameLength).toString("utf8");
    if (!username || /[\u0000-\u001f]/.test(username)) {
      return null;
    }
    offset += usernameLength;

    const validationLength = readU32LE(data, offset);
    offset += 4;
    if (validationLength < 0 || offset + validationLength + 10 > data.length) {
      return null;
    }

    const validationBytes = Buffer.from(data.subarray(offset, offset + validationLength));
    offset += validationLength;

    const verifiedByte = data[offset];
    if (verifiedByte !== 0 && verifiedByte !== 1) {
      return null;
    }
    const verified = verifiedByte === 1;
    offset += 1;

    const authAt = readU64LE(data, offset);
    offset += 8;

    const option = data[offset];
    offset += 1;
    let verifiedAt: bigint | null = null;
    if (option === 1) {
      verifiedAt = readU64LE(data, offset);
    } else if (option !== 0) {
      return null;
    }

    return {
      layout: "legacy-string",
      user,
      username,
      validationBytes,
      verified,
      authAt,
      verifiedAt,
    };
  } catch {
    return null;
  }
}

function tryParsePermissionAccount(data: Buffer): PermissionDecoded | null {
  try {
    if (data.length < 39) {
      return null;
    }

    const bump = data[1];
    const permissionedAccount = new PublicKey(data.subarray(2, 34));
    const reserved = data[34] ?? 0;
    const memberCount = readU32LE(data, 35);

    const slots: PermissionSlot[] = [];
    let offset = 39;
    while (offset + 33 <= data.length) {
      const flags = data[offset] ?? 0;
      const pubkey = new PublicKey(data.subarray(offset + 1, offset + 33));
      slots.push({ flags, pubkey });
      offset += 33;
    }

    return {
      bump,
      permissionedAccount,
      memberCount,
      reserved,
      slots,
    };
  } catch {
    return null;
  }
}

function tryParseAnchorIdlAccount(data: Buffer): IdlDecoded | null {
  try {
    if (data.length < 44) {
      return null;
    }

    const authority = new PublicKey(data.subarray(8, 40));
    const compressedLength = readU32LE(data, 40);
    const compressedEnd = 44 + compressedLength;
    if (compressedEnd > data.length) {
      return null;
    }

    const compressed = data.subarray(44, compressedEnd);
    const inflated = inflateSync(compressed);
    const preview = inflated.toString("utf8").slice(0, 160).replace(/\s+/g, " ");

    return {
      authority,
      compressedLength,
      jsonPreview: preview,
    };
  } catch {
    return null;
  }
}

async function findAnchorIdlAddress(programId: PublicKey): Promise<PublicKey> {
  const [base] = PublicKey.findProgramAddressSync([], programId);
  return PublicKey.createWithSeed(base, "anchor:idl", programId);
}

async function fetchMintMetadata(
  connection: Connection,
  mints: PublicKey[]
): Promise<Map<string, MintMeta>> {
  const results = await mapWithConcurrency(mints, 8, async (mint) => {
    const info = await withRetry(() => connection.getAccountInfo(mint));
    if (!info || info.data.length < 45) {
      return [mint.toBase58(), { decimals: null }] as const;
    }

    return [mint.toBase58(), { decimals: info.data[44] ?? null }] as const;
  });

  return new Map(results);
}

async function buildVaultRows(
  connection: Connection,
  vaultAccounts: RawAccount[],
  candidateMints: PublicKey[],
  mintMetaByAddress: Map<string, MintMeta>
): Promise<VaultAuditRow[]> {
  const rows: VaultAuditRow[] = [];

  for (const account of vaultAccounts) {
    let tokenMint: PublicKey | null = null;

    for (const mint of candidateMints) {
      const expected = findProgramAddress([VAULT_SEED, mint.toBuffer()], PRIVATE_TRANSFER_PROGRAM_ID);
      if (expected.equals(account.address)) {
        tokenMint = mint;
        break;
      }
    }

    let vaultAta: PublicKey | null = null;
    let amountRaw: bigint | null = null;
    let amountUi: string | null = null;
    let status: DecodeStatus = tokenMint ? "full" : "partial";

    if (tokenMint) {
      vaultAta = getAssociatedTokenAddressSync(tokenMint, account.address, true);
      const tokenAccountInfo = await withRetry(() => connection.getAccountInfo(vaultAta));
      if (tokenAccountInfo && tokenAccountInfo.data.length >= 72) {
        amountRaw = readU64LE(Buffer.from(tokenAccountInfo.data), 64);
        amountUi = formatUiAmount(
          amountRaw,
          mintMetaByAddress.get(tokenMint.toBase58())?.decimals ?? null
        );
      }
    }

    rows.push({
      kind: "vault",
      address: account.address,
      lamports: account.lamports,
      updatedAt: null,
      sourceOwner: account.sourceOwner,
      status,
      tokenMint,
      vaultAta,
      amountRaw,
      amountUi,
      isDelegated: account.sourceOwner === "delegation_program",
    });
  }

  return rows;
}

async function fetchUpdatedAtMap(
  connection: Connection,
  targets: Array<[string, PublicKey[]]>,
  concurrency: number
): Promise<Map<string, number | null>> {
  const results = await mapWithConcurrency(targets, concurrency, async ([key, addresses]) => {
    let latest: number | null = null;
    for (const address of addresses) {
      const signatures = await withRetry(() =>
        connection.getSignaturesForAddress(address, { limit: 1 })
      );
      const blockTime = signatures[0]?.blockTime ?? null;
      if (blockTime !== null && (latest === null || blockTime > latest)) {
        latest = blockTime;
      }
    }

    return [key, latest] as const;
  });

  return new Map(results);
}

function sortByUpdatedAt<T extends { updatedAt: number | null; address: PublicKey }>(
  rows: T[]
) {
  rows.sort((left, right) => {
    const leftTime = left.updatedAt ?? -1;
    const rightTime = right.updatedAt ?? -1;
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return left.address.toBase58().localeCompare(right.address.toBase58());
  });
}

function formatTimestamp(timestamp: number | null) {
  if (!timestamp) {
    return "Unknown";
  }

  return `${new Date(timestamp * 1000).toISOString().replace(".000Z", "Z")}`;
}

function formatRentSol(lamports: number) {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}

function formatUiAmount(amount: bigint | null, decimals: number | null) {
  if (amount === null) {
    return "Unknown";
  }
  if (decimals === null) {
    return amount.toString();
  }

  const negative = amount < 0n;
  const absValue = negative ? -amount : amount;
  const divisor = 10n ** BigInt(decimals);
  const whole = absValue / divisor;
  const fraction = absValue % divisor;

  if (fraction === 0n) {
    return `${negative ? "-" : ""}${whole.toString()}`;
  }

  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}.${fractionText}`;
}

function explorerUrl(address: string) {
  return `https://explorer.solana.com/address/${address}?cluster=${MAINNET_EXPLORER_CLUSTER}`;
}

function shortAddress(address: string, left = 4, right = 4) {
  if (address.length <= left + right + 1) {
    return address;
  }
  return `${address.slice(0, left)}...${address.slice(-right)}`;
}

function statusClass(status: DecodeStatus) {
  if (status === "full") {
    return "row-ok";
  }
  if (status === "partial") {
    return "row-partial";
  }
  return "row-failed";
}

function statusLabel(status: DecodeStatus) {
  if (status === "full") {
    return "Decoded";
  }
  if (status === "partial") {
    return "Best effort";
  }
  return "Failed";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAddressCell(address: PublicKey) {
  const base58 = address.toBase58();
  const link = explorerUrl(base58);
  return `<a class="mono" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(
    shortAddress(base58, 6, 6)
  )}</a>`;
}

function renderLinkedAddress(address: PublicKey | null) {
  if (!address) {
    return `<span class="muted">Unknown</span>`;
  }
  return renderAddressCell(address);
}

function renderPlainAddress(address: PublicKey | null) {
  if (!address) {
    return `<span class="muted">Unknown</span>`;
  }
  const base58 = address.toBase58();
  return `<a class="mono" href="${escapeHtml(
    explorerUrl(base58)
  )}" target="_blank" rel="noreferrer">${escapeHtml(base58)}</a>`;
}

function renderBytesPreview(bytes: Buffer | null) {
  if (!bytes) {
    return `<span class="muted">Unknown</span>`;
  }

  const printable = bytes.toString("utf8").replace(/[^\x20-\x7e\r\n\t]/g, " ");
  const compact = printable.replace(/\s+/g, " ").trim();
  const preview = compact.length > 96 ? `${compact.slice(0, 96)}...` : compact;
  const hexPreview = bytes.toString("hex").slice(0, 96);

  return `<details><summary>${bytes.length} bytes</summary><pre>${escapeHtml(
    preview || hexPreview
  )}</pre></details>`;
}

function renderTextDetails(summary: string, body: string) {
  return `<details><summary>${escapeHtml(summary)}</summary><pre>${escapeHtml(
    body
  )}</pre></details>`;
}

function renderHtml(params: {
  generatedAt: Date;
  rpcUrl: string;
  depositRows: DepositAuditRow[];
  usernameDepositRows: UsernameDepositAuditRow[];
  vaultRows: VaultAuditRow[];
  sessionRows: SessionAuditRow[];
  permissionRows: PermissionAuditRow[];
  legacyRows: LegacyAuditRow[];
  mintMetaByAddress: Map<string, MintMeta>;
}) {
  const {
    generatedAt,
    rpcUrl,
    depositRows,
    usernameDepositRows,
    vaultRows,
    sessionRows,
    permissionRows,
    legacyRows,
  } = params;

  const depositPermissionRows = permissionRows.filter(
    (row) => row.kind === "depositPermission"
  );
  const usernamePermissionRows = permissionRows.filter(
    (row) => row.kind === "usernameDepositPermission"
  );

  const depositTable = renderTable(
    "Deposits",
    [
      "Updated At",
      "User",
      "Token",
      "Amount Base",
      "Is Delegated",
      "Rent SOL",
      "Address",
    ],
    depositRows.map(
      (row) => `<tr class="${statusClass(row.status)}">
        <td>${renderTimestampCell(row.updatedAt, row.status)}</td>
        <td>${renderLinkedAddress(row.user)}</td>
        <td>${renderLinkedAddress(row.tokenMint)}</td>
        <td class="mono">${row.amountBase?.toString() ?? "Unknown"}</td>
        <td>${renderBoolBadge(row.isDelegated)}</td>
        <td class="mono">${formatRentSol(row.lamports)}</td>
        <td>${renderAddressCell(row.address)}</td>
      </tr>`
    )
  );

  const depositPermissionTable = renderTable(
    "Deposit Permissions",
    [
      "Updated At",
      "Authority",
      "Is Delegated",
      "Rent SOL",
      "Address",
    ],
    depositPermissionRows.map(
      (row) => `<tr class="${statusClass(row.status)}">
        <td>${renderTimestampCell(row.updatedAt, row.status)}</td>
        <td>${
          row.authorityMembers.length > 0
            ? row.authorityMembers.map((authority) => renderLinkedAddress(authority)).join("<br>")
            : `<span class="muted">Unknown</span>`
        }</td>
        <td>${renderBoolBadge(row.isDelegated)}</td>
        <td class="mono">${formatRentSol(row.lamports)}</td>
        <td>${renderAddressCell(row.address)}</td>
      </tr>`
    )
  );

  const usernameDepositTable = renderTable(
    "Username Deposits",
    [
      "Updated At",
      "Username Hash",
      "Token",
      "Amount Base",
      "Is Delegated",
      "Rent SOL",
      "Address",
    ],
    usernameDepositRows.map(
      (row) => `<tr class="${statusClass(row.status)}">
        <td>${renderTimestampCell(row.updatedAt, row.status)}</td>
        <td class="mono">${row.usernameHash ? escapeHtml(row.usernameHash.toString("hex")) : "Unknown"}</td>
        <td>${renderLinkedAddress(row.tokenMint)}</td>
        <td class="mono">${row.amountBase?.toString() ?? "Unknown"}</td>
        <td>${renderBoolBadge(row.isDelegated)}</td>
        <td class="mono">${formatRentSol(row.lamports)}</td>
        <td>${renderAddressCell(row.address)}</td>
      </tr>`
    )
  );

  const usernamePermissionTable = renderTable(
    "Username Deposit Permissions",
    [
      "Updated At",
      "Authority",
      "Is Delegated",
      "Rent SOL",
      "Address",
    ],
    usernamePermissionRows.map(
      (row) => `<tr class="${statusClass(row.status)}">
        <td>${renderTimestampCell(row.updatedAt, row.status)}</td>
        <td>${
          row.authorityMembers.length > 0
            ? row.authorityMembers.map((authority) => renderLinkedAddress(authority)).join("<br>")
            : `<span class="muted">Unknown</span>`
        }</td>
        <td>${renderBoolBadge(row.isDelegated)}</td>
        <td class="mono">${formatRentSol(row.lamports)}</td>
        <td>${renderAddressCell(row.address)}</td>
      </tr>`
    )
  );

  const vaultTable = renderTable(
    "Vaults",
    ["Updated At", "Token", "Amount", "Vault ATA", "Rent SOL", "Address"],
    vaultRows.map(
      (row) => `<tr class="${statusClass(row.status)}">
        <td>${renderTimestampCell(row.updatedAt, row.status)}</td>
        <td>${renderLinkedAddress(row.tokenMint)}</td>
        <td class="mono">${
          row.amountUi && row.amountRaw !== null
            ? `${escapeHtml(row.amountUi)} (${escapeHtml(row.amountRaw.toString())} base)`
            : "Unknown"
        }</td>
        <td>${renderLinkedAddress(row.vaultAta)}</td>
        <td class="mono">${formatRentSol(row.lamports)}</td>
        <td>${renderAddressCell(row.address)}</td>
      </tr>`
    )
  );

  const sessionTable = renderTable(
    "TelegramSessions",
    [
      "Updated At",
      "User",
      "Username Hash",
      "Verified",
      "Auth At",
      "Verified At",
      "Validation Bytes",
      "Rent SOL",
      "Address",
    ],
    sessionRows.map(
      (row) => `<tr class="${statusClass(row.status)}">
        <td>${renderTimestampCell(row.updatedAt, row.status)}</td>
        <td>${renderLinkedAddress(row.user)}</td>
        <td class="mono">${row.usernameHash ? escapeHtml(row.usernameHash.toString("hex")) : "Unknown"}</td>
        <td>${row.verified === null ? `<span class="muted">Unknown</span>` : renderBoolBadge(row.verified)}</td>
        <td class="mono">${formatMaybeBigintTimestamp(row.authAt)}</td>
        <td class="mono">${formatMaybeBigintTimestamp(row.verifiedAt)}</td>
        <td>${renderBytesPreview(row.validationBytes)}</td>
        <td class="mono">${formatRentSol(row.lamports)}</td>
        <td>${renderAddressCell(row.address)}</td>
      </tr>`
    )
  );

  const legacyTable = renderTable(
    "Not decoded PDAs (legacy seed)",
    [
      "Updated At",
      "Best effort seed match",
      "Best effort decoded data",
      "Rent SOL",
      "Address",
    ],
    legacyRows.map(
      (row) => `<tr class="${statusClass(row.status)}">
        <td>${renderTimestampCell(row.updatedAt, row.status)}</td>
        <td>${escapeHtml(row.bestEffortSeedMatch)}</td>
        <td>${renderTextDetails(statusLabel(row.status), row.bestEffortDecodedData)}</td>
        <td class="mono">${formatRentSol(row.lamports)}</td>
        <td>${renderAddressCell(row.address)}</td>
      </tr>`
    )
  );

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mainnet PDA Audit</title>
    <style>
      :root {
        --bg: #f7f4ed;
        --surface: #fffdf9;
        --text: #1e1a17;
        --muted: #786d63;
        --border: #d9d0c4;
        --ok-bg: #eef9ef;
        --ok-border: #8bc58f;
        --partial-bg: #fff5df;
        --partial-border: #d7a654;
        --failed-bg: #fff0ee;
        --failed-border: #d57970;
        --accent: #29407d;
        --badge-text: #271d14;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
        background:
          radial-gradient(circle at top left, #efe7d8 0, transparent 28%),
          radial-gradient(circle at top right, #ece4fb 0, transparent 24%),
          var(--bg);
        color: var(--text);
      }
      main {
        width: min(1480px, calc(100vw - 32px));
        margin: 32px auto 56px;
      }
      h1,
      h2 {
        margin: 0;
        line-height: 1.05;
      }
      h1 {
        font-size: clamp(2.2rem, 4vw, 4rem);
        letter-spacing: -0.03em;
      }
      h2 {
        font-size: 1.5rem;
        margin-bottom: 14px;
      }
      p {
        margin: 0;
      }
      .hero,
      .section {
        background: color-mix(in srgb, var(--surface) 92%, white 8%);
        border: 1px solid var(--border);
        border-radius: 24px;
        box-shadow: 0 18px 60px rgba(34, 28, 24, 0.08);
      }
      .hero {
        padding: 28px;
        display: grid;
        gap: 20px;
      }
      .hero-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      }
      .hero-card {
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(40, 32, 28, 0.08);
      }
      .hero-card .label {
        display: block;
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
        margin-bottom: 6px;
      }
      .hero-card .value {
        font-size: 1.55rem;
        font-weight: 700;
        font-family: "Menlo", "SFMono-Regular", "Liberation Mono", monospace;
      }
      .lede {
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.6;
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.72);
        font-size: 0.88rem;
        color: var(--muted);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 0.8rem;
        font-weight: 700;
        white-space: nowrap;
        border: 1px solid transparent;
        color: var(--badge-text);
      }
      .badge-ok {
        background: var(--ok-bg);
        border-color: var(--ok-border);
      }
      .badge-partial {
        background: var(--partial-bg);
        border-color: var(--partial-border);
      }
      .badge-failed {
        background: var(--failed-bg);
        border-color: var(--failed-border);
      }
      .badge-true {
        background: #edf4ff;
        border-color: #82a5dd;
      }
      .badge-false {
        background: #f3f0ea;
        border-color: #cdbdaa;
      }
      .section {
        margin-top: 20px;
        padding: 20px;
      }
      .table-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 980px;
      }
      th,
      td {
        text-align: left;
        padding: 12px 10px;
        border-top: 1px solid var(--border);
        vertical-align: top;
        font-size: 0.95rem;
      }
      th {
        font-size: 0.77rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
        border-top: 0;
      }
      tr.row-ok td {
        background: color-mix(in srgb, var(--ok-bg) 30%, white 70%);
      }
      tr.row-partial td {
        background: color-mix(in srgb, var(--partial-bg) 36%, white 64%);
      }
      tr.row-failed td {
        background: color-mix(in srgb, var(--failed-bg) 40%, white 60%);
      }
      .mono,
      pre,
      code,
      summary {
        font-family: "Menlo", "SFMono-Regular", "Liberation Mono", monospace;
      }
      .muted {
        color: var(--muted);
      }
      a {
        color: var(--accent);
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      details summary {
        cursor: pointer;
        color: var(--accent);
      }
      pre {
        margin: 10px 0 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.83rem;
        line-height: 1.4;
      }
      @media (max-width: 768px) {
        main {
          width: min(100vw - 16px, 1480px);
          margin: 12px auto 28px;
        }
        .hero,
        .section {
          border-radius: 18px;
          padding: 16px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div>
          <h1>Mainnet PDA Audit</h1>
          <p class="lede">
            Current-seed PDAs stay in their typed tables. Program-owned PDAs that do not match the
            current seeds are routed into the legacy fallback table with the best decode the script can
            recover. Permission tables include MagicBlock ACL PDAs found under both the ACL program
            and the delegation program.
          </p>
        </div>
        <div class="hero-grid">
          <div class="hero-card"><span class="label">Deposits</span><span class="value">${depositRows.length}</span></div>
          <div class="hero-card"><span class="label">Deposit Permissions</span><span class="value">${depositPermissionRows.length}</span></div>
          <div class="hero-card"><span class="label">Username Deposits</span><span class="value">${usernameDepositRows.length}</span></div>
          <div class="hero-card"><span class="label">Username Permissions</span><span class="value">${usernamePermissionRows.length}</span></div>
          <div class="hero-card"><span class="label">Vaults</span><span class="value">${vaultRows.length}</span></div>
          <div class="hero-card"><span class="label">TelegramSessions</span><span class="value">${sessionRows.length}</span></div>
          <div class="hero-card"><span class="label">Legacy / Other</span><span class="value">${legacyRows.length}</span></div>
        </div>
        <div class="legend">
          <span class="legend-item"><span class="badge badge-ok">Decoded</span> Current layout decoded cleanly</span>
          <span class="legend-item"><span class="badge badge-partial">Best effort</span> Legacy or partially reconstructed</span>
          <span class="legend-item"><span class="badge badge-failed">Failed</span> Address kept, decode incomplete</span>
        </div>
        <p class="lede">
          Generated at ${escapeHtml(generatedAt.toISOString())} using ${escapeHtml(
            rpcUrl
          )}.
        </p>
      </section>
      <section class="section">${depositTable}</section>
      <section class="section">${depositPermissionTable}</section>
      <section class="section">${usernameDepositTable}</section>
      <section class="section">${usernamePermissionTable}</section>
      <section class="section">${vaultTable}</section>
      <section class="section">${sessionTable}</section>
      <section class="section">${legacyTable}</section>
    </main>
  </body>
</html>`;
}

function renderTable(title: string, headings: string[], rows: string[]) {
  return `<h2>${escapeHtml(title)}</h2>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>${headings.map((heading) => `<th>${escapeHtml(heading)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows.length > 0 ? rows.join("\n") : `<tr><td colspan="${headings.length}" class="muted">No rows</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

function renderBoolBadge(value: boolean) {
  return `<span class="badge ${value ? "badge-true" : "badge-false"}">${
    value ? "Yes" : "No"
  }</span>`;
}

function renderTimestampCell(updatedAt: number | null, status: DecodeStatus) {
  return `${formatTimestamp(updatedAt)}<br /><span class="badge ${
    status === "full"
      ? "badge-ok"
      : status === "partial"
        ? "badge-partial"
        : "badge-failed"
  }">${statusLabel(status)}</span>`;
}

function formatMaybeBigintTimestamp(value: bigint | null) {
  if (value === null) {
    return "Unknown";
  }

  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) {
    return value.toString();
  }
  return formatTimestamp(asNumber);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
