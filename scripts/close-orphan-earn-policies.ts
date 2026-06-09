import bs58 from "bs58";
import { neon } from "@neondatabase/serverless";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getKaminoUsdcEarnTargetForCluster,
  resolveLoyalClusterForSolanaEnv,
} from "../packages/loyal-actions/src/index.ts";
import {
  createSmartAccountVaultsClient,
  sendPreparedWithWallet,
  type SmartAccountPolicySnapshot,
} from "../packages/smart-account-vaults/src/index.ts";
import {
  compilePreparedOperation,
  generated,
} from "../sdk/loyal-smart-accounts-core/src/index.ts";
import {
  PROGRAM_ADDRESS,
  createLoyalSmartAccountsClient,
  pda,
} from "../sdk/loyal-smart-accounts/src/index.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
  type SolanaEnv,
} from "../packages/solana-rpc/src/index.ts";

const EARN_VAULT_INDEX = 1;
const YIELD_DATABASE_URL_ENV_NAME = "NEON_DATABASE_URL";

type ParsedArgs = {
  execute: boolean;
  programId: PublicKey;
  rpcUrl: string | null;
  settingsPda: PublicKey;
};

type OrphanEarnPolicyInput = {
  accountIndex: number | null;
  address: string;
  dbPresent: boolean;
  lamports: number | null;
  matchesEarnYieldRouting: boolean;
  referencedByActivePosition: boolean;
  seed: string;
  state: string;
};

type OrphanEarnPolicyCandidate = OrphanEarnPolicyInput & {
  expectedAction: "close";
};

function printHelpAndExit(): never {
  console.log(`Usage:
  op run --env-file=.env.1password -- sh -c 'bun run scripts/close-orphan-earn-policies.ts --settings-pda <PUBKEY> [--execute]'

Required:
  --settings-pda <PUBKEY>   Smart-account Settings PDA to inspect.

Options:
  --execute                 Close orphan Earn policies. Omit for dry-run.
  --rpc-url <URL>           Override RPC endpoint.
  --program-id <PUBKEY>     Override smart-account program id.

Environment:
  SOLANA_TESTING_PK         Required only with --execute. Accepts base58, JSON array, or hex secret key.
  NEON_DATABASE_URL         Yield Neon database URL.
  NEXT_PUBLIC_SOLANA_ENV    devnet or mainnet. Defaults to devnet.
`);
  process.exit(0);
}

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv = process.argv.slice(2)): ParsedArgs {
  let execute = false;
  let settingsPda: PublicKey | null = null;
  let rpcUrl: string | null = null;
  let programId = new PublicKey(
    process.env.LOYAL_SMART_ACCOUNTS_PROGRAM_ID ?? PROGRAM_ADDRESS
  );

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--help":
      case "-h":
        printHelpAndExit();
        break;
      case "--execute":
        execute = true;
        break;
      case "--settings-pda":
        settingsPda = new PublicKey(readFlagValue(argv, index, arg));
        index += 1;
        break;
      case "--rpc-url":
        rpcUrl = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case "--program-id":
        programId = new PublicKey(readFlagValue(argv, index, arg));
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!settingsPda) {
    throw new Error("--settings-pda is required.");
  }

  return { execute, programId, rpcUrl, settingsPda };
}

function parseSecretKeyBytes(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Secret key is empty.");
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (value) =>
          !Number.isInteger(value) || Number(value) < 0 || Number(value) > 255
      )
    ) {
      throw new Error("Secret key JSON must be an array of bytes.");
    }
    return Uint8Array.from(parsed as number[]);
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Uint8Array.from(
      trimmed.match(/../g)!.map((byte) => Number.parseInt(byte, 16))
    );
  }

  return bs58.decode(trimmed);
}

function loadTestingKeypairFromEnv(): Keypair {
  const raw = process.env.SOLANA_TESTING_PK;
  if (!raw) {
    throw new Error("SOLANA_TESTING_PK is required for --execute.");
  }
  return Keypair.fromSecretKey(parseSecretKeyBytes(raw));
}

function resolveRpcUrl(solanaEnv: SolanaEnv, override: string | null): string {
  return (
    override ??
    process.env.RPC_URL ??
    process.env[`SOLANA_${solanaEnv.toUpperCase()}_RPC_URL`] ??
    (solanaEnv === "mainnet" ? process.env.SOLANA_RPC_URL : undefined) ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT ??
    getSolanaEndpoints(solanaEnv).rpcEndpoint
  );
}

function formatRpcUrlForLog(rpcUrl: string): string {
  try {
    const url = new URL(rpcUrl);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : "/..."}`;
  } catch {
    return "[custom RPC URL]";
  }
}

function bytesEqual(left: Uint8Array, right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function bignumToBigInt(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(value);
  }
  if (typeof value === "string") {
    return BigInt(value);
  }
  if (
    value &&
    typeof value === "object" &&
    "toString" in value &&
    typeof value.toString === "function"
  ) {
    return BigInt(value.toString());
  }
  throw new Error("Unsupported bignum value.");
}

function hasDataSliceEquals(
  constraint: generated.InstructionConstraint,
  value: readonly number[]
): boolean {
  return constraint.dataConstraints.some((dataConstraint) => {
    const dataValue = dataConstraint.dataValue;
    return (
      bignumToBigInt(dataConstraint.dataOffset) === 0n &&
      dataConstraint.operator === generated.DataOperator.Equals &&
      dataValue.__kind === "U8Slice" &&
      bytesEqual(dataValue.fields[0], value)
    );
  });
}

function hasPubkeyConstraint(args: {
  constraint: generated.InstructionConstraint;
  accountIndex: number;
  owner?: PublicKey;
  pubkey: PublicKey;
}): boolean {
  return args.constraint.accountConstraints.some((accountConstraint) => {
    const value = accountConstraint.accountConstraint;
    const ownerMatches =
      !args.owner ||
      (accountConstraint.owner !== null &&
        accountConstraint.owner.equals(args.owner));

    return (
      accountConstraint.accountIndex === args.accountIndex &&
      ownerMatches &&
      value.__kind === "Pubkey" &&
      value.fields[0].some((pubkey) => pubkey.equals(args.pubkey))
    );
  });
}

function instructionMatchesEarnTarget(args: {
  constraint: generated.InstructionConstraint;
  discriminator: readonly number[];
  marketAccountIndex: number;
  target: ReturnType<typeof getKaminoUsdcEarnTargetForCluster>;
  vaultPda: PublicKey;
}): boolean {
  return (
    args.constraint.programId.equals(args.target.lendProgramId) &&
    hasDataSliceEquals(args.constraint, args.discriminator) &&
    hasPubkeyConstraint({
      constraint: args.constraint,
      accountIndex: 0,
      pubkey: args.vaultPda,
    }) &&
    hasPubkeyConstraint({
      constraint: args.constraint,
      accountIndex: args.marketAccountIndex,
      pubkey: args.target.market,
    }) &&
    hasPubkeyConstraint({
      constraint: args.constraint,
      accountIndex: 4,
      owner: TOKEN_PROGRAM_ID,
      pubkey: args.target.liquidityMint,
    }) &&
    hasPubkeyConstraint({
      constraint: args.constraint,
      accountIndex: 10,
      pubkey: TOKEN_PROGRAM_ID,
    })
  );
}

function isEarnYieldRoutingPolicy(args: {
  policy: Awaited<
    ReturnType<
      ReturnType<
        typeof createLoyalSmartAccountsClient
      >["policies"]["queries"]["fetchPolicy"]
    >
  >;
  target: ReturnType<typeof getKaminoUsdcEarnTargetForCluster>;
  vaultPda: PublicKey;
}): boolean {
  const state = args.policy.policyState;
  if (state.__kind !== "ProgramInteraction") {
    return false;
  }

  const payload = state.fields[0];
  if (
    payload.accountIndex !== EARN_VAULT_INDEX ||
    payload.preHook !== null ||
    payload.postHook !== null ||
    payload.spendingLimits.length !== 0 ||
    payload.instructionsConstraints.length !== 2
  ) {
    return false;
  }

  return (
    instructionMatchesEarnTarget({
      constraint: payload.instructionsConstraints[0],
      discriminator: args.target.withdrawDiscriminator,
      marketAccountIndex: 1,
      target: args.target,
      vaultPda: args.vaultPda,
    }) &&
    instructionMatchesEarnTarget({
      constraint: payload.instructionsConstraints[1],
      discriminator: args.target.depositDiscriminator,
      marketAccountIndex: 2,
      target: args.target,
      vaultPda: args.vaultPda,
    })
  );
}

function filterOrphanEarnPolicies(
  policies: OrphanEarnPolicyInput[]
): OrphanEarnPolicyCandidate[] {
  return policies
    .filter(
      (policy) =>
        policy.state === "ProgramInteraction" &&
        policy.accountIndex === EARN_VAULT_INDEX &&
        !policy.dbPresent &&
        !policy.referencedByActivePosition
    )
    .map((policy) => ({ ...policy, expectedAction: "close" as const }));
}

function createWalletAdapter(wallet: Keypair) {
  return {
    publicKey: wallet.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      transaction: T
    ): Promise<T> {
      if (transaction instanceof VersionedTransaction) {
        transaction.sign([wallet]);
        return transaction;
      }
      transaction.partialSign(wallet);
      return transaction;
    },
  };
}

async function queryYieldPolicyState(settingsPda: PublicKey): Promise<{
  activePositionPolicyAccounts: Set<string>;
  routePolicyAccounts: Set<string>;
}> {
  const databaseUrl = process.env[YIELD_DATABASE_URL_ENV_NAME];
  if (!databaseUrl) {
    throw new Error(`${YIELD_DATABASE_URL_ENV_NAME} is required.`);
  }

  const sql = neon(databaseUrl);
  const settings = settingsPda.toBase58();
  const [routeRows, activePositionRows] = await Promise.all([
    sql`
      SELECT policy_account
      FROM loyal_yield.route_policies
      WHERE settings = ${settings}
        AND vault_index = ${EARN_VAULT_INDEX}
    `,
    sql`
      SELECT DISTINCT policy_account
      FROM loyal_yield.user_yield_positions
      WHERE settings = ${settings}
        AND vault_index = ${EARN_VAULT_INDEX}
        AND status = 'active'
    `,
  ]);

  return {
    routePolicyAccounts: new Set(
      routeRows.map((row) => String(row.policy_account))
    ),
    activePositionPolicyAccounts: new Set(
      activePositionRows.map((row) => String(row.policy_account))
    ),
  };
}

async function resolveConfirmedSignatureSlot(args: {
  connection: Connection;
  signature: string;
}): Promise<number> {
  const { value } = await args.connection.getSignatureStatuses(
    [args.signature],
    { searchTransactionHistory: true }
  );
  const status = value[0];
  if (!status || status.err) {
    throw new Error(`Transaction ${args.signature} is not confirmed.`);
  }
  if (
    status.confirmationStatus !== "confirmed" &&
    status.confirmationStatus !== "finalized"
  ) {
    throw new Error(`Transaction ${args.signature} is not confirmed.`);
  }
  return status.slot;
}

async function executeClose(args: {
  candidates: OrphanEarnPolicyCandidate[];
  client: ReturnType<typeof createSmartAccountVaultsClient>;
  connection: Connection;
  settingsPda: PublicKey;
  signer: Keypair;
}) {
  const policies = args.candidates.map(
    (candidate) => new PublicKey(candidate.address)
  );
  const signerBalanceBefore = await args.connection.getBalance(
    args.signer.publicKey,
    "confirmed"
  );
  const closedPolicyLamports = args.candidates.reduce(
    (sum, candidate) => sum + (candidate.lamports ?? 0),
    0
  );
  const prepared = await args.client.prepareCloseYieldRoutingPoliciesSync({
    settingsPda: args.settingsPda,
    policies,
    feePayer: args.signer.publicKey,
    signers: [args.signer.publicKey],
  });

  const latestBlockhash = await args.connection.getLatestBlockhash("confirmed");
  const simulated = compilePreparedOperation({
    prepared,
    blockhash: latestBlockhash.blockhash,
  });
  simulated.sign([args.signer]);
  const simulation = await args.connection.simulateTransaction(simulated, {
    commitment: "confirmed",
    sigVerify: true,
  });

  if (simulation.value.err) {
    throw new Error(
      `Close simulation failed: ${JSON.stringify(simulation.value.err)}\n${
        simulation.value.logs?.join("\n") ?? ""
      }`
    );
  }

  const signature = await sendPreparedWithWallet({
    connection: args.connection,
    wallet: createWalletAdapter(args.signer),
    prepared,
    confirm: true,
  });
  const confirmedSlot = await resolveConfirmedSignatureSlot({
    connection: args.connection,
    signature,
  });
  const transaction = await args.connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const feeLamports = transaction?.meta?.fee ?? null;

  const remainingAccounts = await args.connection.getMultipleAccountsInfo(
    policies,
    "confirmed"
  );
  const stillOpen = policies.filter((_, index) => remainingAccounts[index]);
  if (stillOpen.length > 0) {
    throw new Error(
      `Close transaction confirmed, but policy account(s) still exist: ${stillOpen
        .map((policy) => policy.toBase58())
        .join(", ")}`
    );
  }

  const signerBalanceAfter = await args.connection.getBalance(
    args.signer.publicKey,
    "confirmed"
  );

  return {
    closedPolicyLamports,
    confirmedSlot,
    feeLamports,
    signature,
    signerBalanceAfter,
    signerBalanceBefore,
    signerBalanceDelta: signerBalanceAfter - signerBalanceBefore,
  };
}

function printPolicyTable(
  policies: Array<OrphanEarnPolicyInput | OrphanEarnPolicyCandidate>
) {
  console.table(
    policies.map((policy) => ({
      policy: policy.address,
      seed: policy.seed,
      accountIndex: policy.accountIndex,
      dbPresent: policy.dbPresent,
      activePosition: policy.referencedByActivePosition,
      lamports: policy.lamports,
      earnMatch: policy.matchesEarnYieldRouting,
      expectedAction:
        "expectedAction" in policy ? policy.expectedAction : "skip",
    }))
  );
}

async function main() {
  const args = parseArgs();
  const solanaEnv = resolveSolanaEnv(
    process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV ?? "devnet"
  );
  const loyalCluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const rpcUrl = resolveRpcUrl(solanaEnv, args.rpcUrl);
  const connection = new Connection(rpcUrl, { commitment: "confirmed" });
  const client = createSmartAccountVaultsClient({
    connection,
    programId: args.programId,
  });
  const lowLevelClient = createLoyalSmartAccountsClient({
    connection,
    programId: args.programId,
  });
  const target = getKaminoUsdcEarnTargetForCluster(loyalCluster);
  const vaultPda = pda.getSmartAccountPda({
    programId: args.programId,
    settingsPda: args.settingsPda,
    accountIndex: EARN_VAULT_INDEX,
  })[0];

  console.log(`mode: ${args.execute ? "execute" : "dry-run"}`);
  console.log(`cluster: ${loyalCluster} (solana env: ${solanaEnv})`);
  console.log(`rpc: ${formatRpcUrlForLog(rpcUrl)}`);
  console.log(`settings: ${args.settingsPda.toBase58()}`);
  console.log(`earn vault: ${vaultPda.toBase58()}`);
  console.log(`target reserve: ${target.reserve.toBase58()}`);

  const signer = args.execute ? loadTestingKeypairFromEnv() : null;
  if (signer) {
    const base = await client.fetchOverviewBase({
      settingsPda: args.settingsPda,
    });
    const signerSnapshot = base.signers.find(
      (entry) =>
        entry.scope === "settings" &&
        entry.address === signer.publicKey.toBase58()
    );
    if (!signerSnapshot) {
      throw new Error(
        `SOLANA_TESTING_PK public key ${signer.publicKey.toBase58()} is not a settings signer.`
      );
    }
    console.log(
      `signer: ${signer.publicKey.toBase58()} (${signerSnapshot.permissions.join(
        ", "
      )})`
    );
  }

  const [policyOverview, dbState] = await Promise.all([
    client.fetchPolicyOverview({
      settingsPda: args.settingsPda,
      rootSigners: [],
    }),
    queryYieldPolicyState(args.settingsPda),
  ]);

  const policyRows: OrphanEarnPolicyInput[] = await Promise.all(
    policyOverview.policies.map(async (policy: SmartAccountPolicySnapshot) => {
      const account = await connection.getAccountInfo(
        new PublicKey(policy.address),
        "confirmed"
      );
      let matchesEarnYieldRouting = false;
      if (
        policy.state === "ProgramInteraction" &&
        policy.accountIndex === EARN_VAULT_INDEX
      ) {
        const rawPolicy = await lowLevelClient.policies.queries.fetchPolicy(
          new PublicKey(policy.address)
        );
        matchesEarnYieldRouting = isEarnYieldRoutingPolicy({
          policy: rawPolicy,
          target,
          vaultPda,
        });
      }

      return {
        address: policy.address,
        seed: policy.seed,
        state: policy.state,
        accountIndex: policy.accountIndex,
        dbPresent: dbState.routePolicyAccounts.has(policy.address),
        referencedByActivePosition: dbState.activePositionPolicyAccounts.has(
          policy.address
        ),
        matchesEarnYieldRouting,
        lamports: account?.lamports ?? null,
      };
    })
  );
  const candidates = filterOrphanEarnPolicies(policyRows);

  console.log("");
  console.log("All on-chain policies:");
  printPolicyTable(policyRows);

  console.log("");
  console.log("Orphan Earn policy candidates:");
  printPolicyTable(candidates);

  if (candidates.length === 0) {
    console.log("No orphan Earn policies found.");
    return;
  }

  if (!args.execute) {
    console.log("Dry-run only. Re-run with --execute to close these policies.");
    return;
  }

  if (!signer) {
    throw new Error("Internal error: execute mode requires signer.");
  }

  const result = await executeClose({
    candidates,
    client,
    connection,
    settingsPda: args.settingsPda,
    signer,
  });

  console.log("");
  console.log(`close signature: ${result.signature}`);
  console.log(`confirmed slot: ${result.confirmedSlot}`);
  console.log(`closed policy lamports: ${result.closedPolicyLamports}`);
  console.log(`transaction fee lamports: ${result.feeLamports ?? "unknown"}`);
  console.log(`signer balance before: ${result.signerBalanceBefore}`);
  console.log(`signer balance after: ${result.signerBalanceAfter}`);
  console.log(`signer balance delta: ${result.signerBalanceDelta}`);
  if (result.feeLamports !== null) {
    console.log(
      `delta plus fee: ${result.signerBalanceDelta + result.feeLamports}`
    );
  }
  console.log("closed policies:");
  printPolicyTable(candidates);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
