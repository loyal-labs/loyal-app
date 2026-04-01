import { writeFileSync } from "node:fs";

import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey(
  "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV"
);
const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);
const PER_MAINNET = "https://mainnet-tee.magicblock.app";
const PER_DEVNET = "https://tee.magicblock.app";
const ROUTER_MAINNET = "https://router.magicblock.app";
const ROUTER_DEVNET = "https://devnet-router.magicblock.app";
const ER_VALIDATOR_MAINNET = "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo";
const ER_VALIDATOR_DEVNET = "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA";
const DEPOSIT_DISCRIMINATOR = Uint8Array.from([
  148, 146, 121, 66, 207, 173, 21, 227,
]);
const USERNAME_DEPOSIT_DISCRIMINATOR = Uint8Array.from([
  242, 23, 53, 35, 55, 192, 177, 246,
]);

type ParsedArgs = {
  rpcUrl: string;
  perRpcUrl: string;
  routerUrl: string;
  programId: PublicKey;
  delegationProgramId: PublicKey;
  outPath?: string;
  concurrency: number;
};

type AccountKind = "deposit" | "username_deposit";

type ParsedProgramAccount = {
  pubkey: PublicKey;
  kind: AccountKind;
  sourceOwner: "program" | "delegation_program";
  baseOwner: string;
  baseLamports: number;
  user?: string;
  tokenMint: string;
  username?: string;
  amountRaw: string;
};

type DelegationStatusResult = {
  isDelegated: boolean;
  fqdn?: string;
  delegationRecord?: {
    authority?: string;
    owner?: string;
    delegationSlot?: number;
    lamports?: number;
  };
};

type DelegationStatusResponse = {
  result?: DelegationStatusResult;
  error?: { code?: number; message?: string };
};

type AccountReport = ParsedProgramAccount & {
  perOwner: string | null;
  delegationStatus: DelegationStatusResult | null;
  delegationError: string | null;
  expectedValidator: string;
  validatorMismatch: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  let rpcUrl = "https://api.mainnet-beta.solana.com";
  let perRpcUrl = "";
  let routerUrl = "";
  let programId = PROGRAM_ID;
  let delegationProgramId = DELEGATION_PROGRAM_ID;
  let outPath: string | undefined;
  let concurrency = 25;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--rpc-url" && next) {
      rpcUrl = next;
      i++;
    } else if (arg === "--per-rpc-url" && next) {
      perRpcUrl = next;
      i++;
    } else if (arg === "--router-url" && next) {
      routerUrl = next;
      i++;
    } else if (arg === "--program-id" && next) {
      programId = new PublicKey(next);
      i++;
    } else if (arg === "--delegation-program-id" && next) {
      delegationProgramId = new PublicKey(next);
      i++;
    } else if (arg === "--out" && next) {
      outPath = next;
      i++;
    } else if (arg === "--concurrency" && next) {
      concurrency = Number(next);
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
  }

  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }

  if (!perRpcUrl) {
    perRpcUrl = rpcUrl.includes("mainnet") ? PER_MAINNET : PER_DEVNET;
  }
  if (!routerUrl) {
    routerUrl = perRpcUrl.includes("mainnet-tee")
      ? ROUTER_MAINNET
      : ROUTER_DEVNET;
  }

  return {
    rpcUrl,
    perRpcUrl: withOptionalToken(perRpcUrl),
    routerUrl,
    programId,
    delegationProgramId,
    outPath,
    concurrency,
  };
}

function printHelpAndExit(): never {
  console.log(`Usage: bun scripts/private-transfer-delegation-audit.ts [options]

Options:
  --rpc-url <url>                 Base Solana RPC URL (default: mainnet-beta)
  --per-rpc-url <url>             PER RPC URL (default inferred from --rpc-url)
  --router-url <url>              Magic Router URL (default inferred from --per-rpc-url)
  --program-id <pubkey>           Telegram private transfer program ID
  --delegation-program-id <pubkey> Delegation program ID
  --concurrency <n>               Parallel delegation status requests (default: 25)
  --out <path>                    Write full JSON report to file
  -h, --help                      Show help

Env:
  PER_AUTH_TOKEN or MB_PER_AUTH_TOKEN
    If set, appended to --per-rpc-url as ?token=... when missing.
`);
  process.exit(0);
}

function withOptionalToken(url: string): string {
  if (url.includes("token=")) return url;
  const token = process.env.PER_AUTH_TOKEN ?? process.env.MB_PER_AUTH_TOKEN;
  if (!token) return url;
  const delimiter = url.includes("?") ? "&" : "?";
  return `${url}${delimiter}token=${encodeURIComponent(token)}`;
}

function hasPrefix(data: Buffer, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (data[i] !== prefix[i]) return false;
  }
  return true;
}

function readU64LE(data: Buffer, offset: number): bigint {
  const view = data.subarray(offset, offset + 8);
  if (view.length < 8) throw new Error("short u64");
  return view.readBigUInt64LE(0);
}

function parseDepositData(data: Buffer): {
  user: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
} {
  const minLen = 8 + 32 + 32 + 8;
  if (data.length < minLen) throw new Error("invalid deposit length");
  const user = new PublicKey(data.subarray(8, 40));
  const tokenMint = new PublicKey(data.subarray(40, 72));
  const amount = readU64LE(data, 72);
  return { user, tokenMint, amount };
}

function parseUsernameDepositData(data: Buffer): {
  username: string;
  tokenMint: PublicKey;
  amount: bigint;
} {
  if (data.length < 8 + 4 + 32 + 8) {
    throw new Error("invalid username_deposit length");
  }
  const usernameLen = data.readUInt32LE(8);
  const usernameStart = 12;
  const usernameEnd = usernameStart + usernameLen;
  if (usernameEnd > data.length) throw new Error("invalid username length");
  const username = data.subarray(usernameStart, usernameEnd).toString("utf8");
  const tokenMintStart = usernameEnd;
  const tokenMintEnd = tokenMintStart + 32;
  if (tokenMintEnd + 8 > data.length)
    throw new Error("invalid tokenMint offset");
  const tokenMint = new PublicKey(data.subarray(tokenMintStart, tokenMintEnd));
  const amount = readU64LE(data, tokenMintEnd);
  return { username, tokenMint, amount };
}

function tryParseProgramAccount(params: {
  pubkey: PublicKey;
  data: Buffer;
  owner: PublicKey;
  lamports: number;
  sourceOwner: "program" | "delegation_program";
  programId: PublicKey;
}): ParsedProgramAccount | null {
  const { pubkey, data, owner, lamports, sourceOwner, programId } = params;
  try {
    if (hasPrefix(data, DEPOSIT_DISCRIMINATOR)) {
      const decoded = parseDepositData(data);
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("deposit_v2"),
          decoded.user.toBuffer(),
          decoded.tokenMint.toBuffer(),
        ],
        programId
      );
      if (!expected.equals(pubkey)) return null;
      return {
        pubkey,
        kind: "deposit",
        sourceOwner,
        baseOwner: owner.toBase58(),
        baseLamports: lamports,
        user: decoded.user.toBase58(),
        tokenMint: decoded.tokenMint.toBase58(),
        amountRaw: decoded.amount.toString(),
      };
    }

    if (hasPrefix(data, USERNAME_DEPOSIT_DISCRIMINATOR)) {
      const decoded = parseUsernameDepositData(data);
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("username_deposit_v2"),
          Buffer.from(decoded.username),
          decoded.tokenMint.toBuffer(),
        ],
        programId
      );
      if (!expected.equals(pubkey)) return null;
      return {
        pubkey,
        kind: "username_deposit",
        sourceOwner,
        baseOwner: owner.toBase58(),
        baseLamports: lamports,
        tokenMint: decoded.tokenMint.toBase58(),
        username: decoded.username,
        amountRaw: decoded.amount.toString(),
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function postJsonRpc<T>(
  endpoint: string,
  method: string,
  params: unknown[]
): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${endpoint}`);
  }
  return (await res.json()) as T;
}

async function fetchDelegationStatus(params: {
  perRpcUrl: string;
  routerUrl: string;
  account: string;
  expectedValidator: string;
}): Promise<{ result: DelegationStatusResult | null; error: string | null }> {
  const payloadParams = [params.account];
  try {
    const tee = await postJsonRpc<DelegationStatusResponse>(
      params.perRpcUrl,
      "getDelegationStatus",
      payloadParams
    );
    if (tee.result?.isDelegated) {
      return { result: tee.result, error: null };
    }
  } catch (err) {
    // fall through to router
    const message = err instanceof Error ? err.message : String(err);
    if (!message) {
      return { result: null, error: "Unknown TEE error" };
    }
  }

  try {
    const routerEndpoint = params.routerUrl.endsWith("/getDelegationStatus")
      ? params.routerUrl
      : `${params.routerUrl.replace(/\/$/, "")}/getDelegationStatus`;
    const router = await postJsonRpc<DelegationStatusResponse>(
      routerEndpoint,
      "getDelegationStatus",
      payloadParams
    );
    if (router.error?.message?.includes(params.expectedValidator)) {
      return {
        result: {
          isDelegated: true,
          delegationRecord: {
            authority: params.expectedValidator,
          },
        },
        error: null,
      };
    }
    if (router.error?.message) {
      const unknownNodeMatch = router.error.message.match(
        /unknown ER node:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/
      );
      if (unknownNodeMatch) {
        return {
          result: {
            isDelegated: true,
            delegationRecord: {
              authority: unknownNodeMatch[1],
            },
          },
          error: router.error.message,
        };
      }
    }
    if (router.error?.message) {
      return { result: null, error: router.error.message };
    }
    return { result: router.result ?? null, error: null };
  } catch (err) {
    return {
      result: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor++;
      if (index >= items.length) return;
      out[index] = await mapFn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const expectedValidator = args.perRpcUrl.includes("mainnet-tee")
    ? ER_VALIDATOR_MAINNET
    : ER_VALIDATOR_DEVNET;

  const baseConn = new Connection(args.rpcUrl, { commitment: "confirmed" });
  const perConn = new Connection(args.perRpcUrl, { commitment: "confirmed" });

  console.log("Scanning accounts...");
  const [programOwned, delegationOwned] = await Promise.all([
    baseConn.getProgramAccounts(args.programId),
    baseConn.getProgramAccounts(args.delegationProgramId),
  ]);

  const parsed = new Map<string, ParsedProgramAccount>();

  for (const acc of programOwned) {
    const item = tryParseProgramAccount({
      pubkey: acc.pubkey,
      data: acc.account.data,
      owner: acc.account.owner,
      lamports: acc.account.lamports,
      sourceOwner: "program",
      programId: args.programId,
    });
    if (item) parsed.set(item.pubkey.toBase58(), item);
  }
  for (const acc of delegationOwned) {
    const item = tryParseProgramAccount({
      pubkey: acc.pubkey,
      data: acc.account.data,
      owner: acc.account.owner,
      lamports: acc.account.lamports,
      sourceOwner: "delegation_program",
      programId: args.programId,
    });
    if (item) parsed.set(item.pubkey.toBase58(), item);
  }

  const accounts = [...parsed.values()];
  console.log(
    `Found ${accounts.length} deposit accounts (program + delegated).`
  );

  const reports = await mapWithConcurrency(
    accounts,
    args.concurrency,
    async (item): Promise<AccountReport> => {
      const [perInfo, delegation] = await Promise.all([
        perConn.getAccountInfo(item.pubkey, "confirmed"),
        fetchDelegationStatus({
          perRpcUrl: args.perRpcUrl,
          routerUrl: args.routerUrl,
          account: item.pubkey.toBase58(),
          expectedValidator,
        }),
      ]);

      const authority = delegation.result?.delegationRecord?.authority;
      return {
        ...item,
        perOwner: perInfo?.owner.toBase58() ?? null,
        delegationStatus: delegation.result,
        delegationError: delegation.error,
        expectedValidator,
        validatorMismatch: Boolean(
          authority && authority !== expectedValidator
        ),
      };
    }
  );

  const summary = {
    totalAccounts: reports.length,
    depositCount: reports.filter((r) => r.kind === "deposit").length,
    usernameDepositCount: reports.filter((r) => r.kind === "username_deposit")
      .length,
    delegatedOnBaseCount: reports.filter(
      (r) => r.baseOwner === args.delegationProgramId.toBase58()
    ).length,
    delegatedByStatusCount: reports.filter(
      (r) => r.delegationStatus?.isDelegated === true
    ).length,
    validatorMismatchCount: reports.filter((r) => r.validatorMismatch).length,
    authorities: Object.entries(
      reports.reduce<Record<string, number>>((acc, r) => {
        const key = r.delegationStatus?.delegationRecord?.authority ?? "<none>";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {})
    )
      .map(([authority, count]) => ({ authority, count }))
      .sort((a, b) => b.count - a.count),
  };

  const output = {
    generatedAt: new Date().toISOString(),
    config: {
      rpcUrl: args.rpcUrl,
      perRpcUrl: args.perRpcUrl,
      routerUrl: args.routerUrl,
      programId: args.programId.toBase58(),
      delegationProgramId: args.delegationProgramId.toBase58(),
      expectedValidator,
      concurrency: args.concurrency,
    },
    summary,
    accounts: reports.map((r) => ({
      pubkey: r.pubkey.toBase58(),
      kind: r.kind,
      sourceOwner: r.sourceOwner,
      baseOwner: r.baseOwner,
      perOwner: r.perOwner,
      baseLamports: r.baseLamports,
      amountRaw: r.amountRaw,
      user: r.user ?? null,
      username: r.username ?? null,
      tokenMint: r.tokenMint,
      delegationStatus: r.delegationStatus ?? null,
      delegationError: r.delegationError,
      expectedValidator: r.expectedValidator,
      validatorMismatch: r.validatorMismatch,
    })),
  };

  console.log("\nSummary:");
  console.log(JSON.stringify(summary, null, 2));

  if (args.outPath) {
    writeFileSync(args.outPath, JSON.stringify(output, null, 2));
    console.log(`\nWrote report: ${args.outPath}`);
  } else {
    console.log("\nFull report:");
    console.log(JSON.stringify(output, null, 2));
  }
}

main().catch((error) => {
  console.error("Audit failed:", error);
  process.exit(1);
});
