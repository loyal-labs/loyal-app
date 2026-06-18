import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  Stablecoin,
  SUBSCRIPTIONS_PROGRAM_ID,
  SUBSCRIPTIONS_TRANSFER_RECURRING,
  SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PULLED_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DATA_LEN,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR,
  SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET,
  SUBSCRIPTION_TRANSFER_DELEGATOR_OFFSET,
  SUBSCRIPTION_TRANSFER_MINT_OFFSET,
  deriveSubscriptionAuthority,
  getStablecoinMintForCluster,
  resolveLoyalClusterForSolanaEnv,
  subscriptionRevokeDelegationData,
} from "../packages/loyal-actions/src/index.ts";
import {
  createSmartAccountVaultsClient,
  sendPreparedWithWallet,
} from "../packages/smart-account-vaults/src/index.ts";
import { compilePreparedOperation } from "../sdk/loyal-smart-accounts-core/src/index.ts";
import {
  PROGRAM_ADDRESS,
  createLoyalSmartAccountsClient,
  generated,
  pda,
} from "../sdk/loyal-smart-accounts/src/index.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
  type SolanaEnv,
} from "../packages/solana-rpc/src/index.ts";

const EARN_VAULT_INDEX = 1;

type ParsedArgs = {
  execute: boolean;
  policies: PublicKey[];
  programId: PublicKey;
  recurringDelegations: PublicKey[];
  rpcUrl: string | null;
  settingsPda: PublicKey;
  walletAddress: PublicKey;
};

type DelegationCandidate = {
  address: string;
  lamports: number;
  amountPerPeriodRaw: string;
  amountPulledRaw: string;
};

type PolicyCandidate = {
  address: string;
  seed: string;
  state: string;
  accountIndex: number | null;
  lamports: number | null;
  explicit: boolean;
  matchesBalanceSweep: boolean;
};

function printHelpAndExit(): never {
  console.log(`Usage:
  op run --env-file=.env.1password -- sh -c 'bun run scripts/close-earn-autodeposit-accounts.ts --settings-pda <PUBKEY> --wallet-address <PUBKEY> [--execute]'

Required:
  --settings-pda <PUBKEY>     Smart-account Settings PDA to inspect.
  --wallet-address <PUBKEY>   User wallet that owns the subscription authority.

Options:
  --execute                   Revoke delegation(s) and close policy account(s). Omit for dry-run.
  --policy <PUBKEY>           Policy to close. May be passed multiple times.
                              If omitted, matching balance-sweep policies are detected on-chain.
  --recurring-delegation <PUBKEY>
                              Recurring delegation to revoke. May be passed multiple times.
                              If omitted, matching delegations are detected from the Subscriptions program.
  --rpc-url <URL>             Override RPC endpoint.
  --program-id <PUBKEY>       Override smart-account program id.

Environment:
  SOLANA_TESTING_PK           Required only with --execute. Must match --wallet-address and be a settings signer.
  NEXT_PUBLIC_SOLANA_ENV      devnet or mainnet. Defaults to devnet.

Notes:
  This script revokes recurring delegation accounts and removes balance-sweep policies.
  The local Subscriptions helper surface exposes no close-subscription-authority instruction,
  so the script reports subscription-authority rent separately if that account remains.
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
  const policies: PublicKey[] = [];
  const recurringDelegations: PublicKey[] = [];
  let settingsPda: PublicKey | null = null;
  let walletAddress: PublicKey | null = null;
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
      case "--policy":
        policies.push(new PublicKey(readFlagValue(argv, index, arg)));
        index += 1;
        break;
      case "--program-id":
        programId = new PublicKey(readFlagValue(argv, index, arg));
        index += 1;
        break;
      case "--recurring-delegation":
        recurringDelegations.push(
          new PublicKey(readFlagValue(argv, index, arg))
        );
        index += 1;
        break;
      case "--rpc-url":
        rpcUrl = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case "--settings-pda":
        settingsPda = new PublicKey(readFlagValue(argv, index, arg));
        index += 1;
        break;
      case "--wallet-address":
        walletAddress = new PublicKey(readFlagValue(argv, index, arg));
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!settingsPda) {
    throw new Error("--settings-pda is required.");
  }
  if (!walletAddress) {
    throw new Error("--wallet-address is required.");
  }

  return {
    execute,
    policies,
    programId,
    recurringDelegations,
    rpcUrl,
    settingsPda,
    walletAddress,
  };
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

function readU64Le(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
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

function bytesEqual(left: Uint8Array, right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function publicKeyBytes(pubkey: PublicKey): number[] {
  return Array.from(pubkey.toBytes());
}

function hasDataSliceEquals(
  constraint: generated.InstructionConstraint,
  offset: bigint,
  value: readonly number[]
): boolean {
  return constraint.dataConstraints.some((dataConstraint) => {
    const dataValue = dataConstraint.dataValue;
    return (
      bignumToBigInt(dataConstraint.dataOffset) === offset &&
      dataConstraint.operator === generated.DataOperator.Equals &&
      dataValue.__kind === "U8Slice" &&
      bytesEqual(dataValue.fields[0], value)
    );
  });
}

function hasDataU8Equals(
  constraint: generated.InstructionConstraint,
  offset: bigint,
  value: number
): boolean {
  return constraint.dataConstraints.some((dataConstraint) => {
    const dataValue = dataConstraint.dataValue;
    return (
      bignumToBigInt(dataConstraint.dataOffset) === offset &&
      dataConstraint.operator === generated.DataOperator.Equals &&
      dataValue.__kind === "U8" &&
      dataValue.fields[0] === value
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

function hasRecurringDelegationAccountConstraint(args: {
  constraint: generated.InstructionConstraint;
  accountIndex: number;
  delegator: PublicKey;
  mint: PublicKey;
  subscriptionAuthority: PublicKey;
  vaultPda: PublicKey;
}): boolean {
  return args.constraint.accountConstraints.some((accountConstraint) => {
    const value = accountConstraint.accountConstraint;
    if (
      accountConstraint.accountIndex !== args.accountIndex ||
      accountConstraint.owner === null ||
      !accountConstraint.owner.equals(SUBSCRIPTIONS_PROGRAM_ID) ||
      value.__kind !== "AccountData"
    ) {
      return false;
    }

    const checks = value.fields[0];
    return (
      checks.some(
        (check) =>
          bignumToBigInt(check.dataOffset) ===
            BigInt(SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET) &&
          check.dataValue.__kind === "U8" &&
          check.dataValue.fields[0] ===
            SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR
      ) &&
      checks.some(
        (check) =>
          bignumToBigInt(check.dataOffset) ===
            BigInt(SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET) &&
          check.dataValue.__kind === "U8Slice" &&
          bytesEqual(check.dataValue.fields[0], publicKeyBytes(args.delegator))
      ) &&
      checks.some(
        (check) =>
          bignumToBigInt(check.dataOffset) ===
            BigInt(SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET) &&
          check.dataValue.__kind === "U8Slice" &&
          bytesEqual(check.dataValue.fields[0], publicKeyBytes(args.vaultPda))
      ) &&
      checks.some(
        (check) =>
          bignumToBigInt(check.dataOffset) ===
            BigInt(SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET) &&
          check.dataValue.__kind === "U8Slice" &&
          bytesEqual(
            check.dataValue.fields[0],
            publicKeyBytes(args.subscriptionAuthority)
          )
      ) &&
      checks.some(
        (check) =>
          bignumToBigInt(check.dataOffset) ===
            BigInt(SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET) &&
          check.dataValue.__kind === "U8Slice" &&
          bytesEqual(check.dataValue.fields[0], publicKeyBytes(args.mint))
      )
    );
  });
}

function isBalanceSweepPolicy(args: {
  policy: Awaited<
    ReturnType<
      ReturnType<
        typeof createLoyalSmartAccountsClient
      >["policies"]["queries"]["fetchPolicy"]
    >
  >;
  delegator: PublicKey;
  mint: PublicKey;
  subscriptionAuthority: PublicKey;
  vaultPda: PublicKey;
  vaultUsdcAta: PublicKey;
  walletUsdcAta: PublicKey;
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
    payload.instructionsConstraints.length !== 1
  ) {
    return false;
  }

  const constraint = payload.instructionsConstraints[0];
  return (
    constraint.programId.equals(SUBSCRIPTIONS_PROGRAM_ID) &&
    hasRecurringDelegationAccountConstraint({
      constraint,
      accountIndex: 0,
      delegator: args.delegator,
      mint: args.mint,
      subscriptionAuthority: args.subscriptionAuthority,
      vaultPda: args.vaultPda,
    }) &&
    hasPubkeyConstraint({
      constraint,
      accountIndex: 1,
      owner: SUBSCRIPTIONS_PROGRAM_ID,
      pubkey: args.subscriptionAuthority,
    }) &&
    hasPubkeyConstraint({
      constraint,
      accountIndex: 2,
      pubkey: args.walletUsdcAta,
    }) &&
    hasPubkeyConstraint({
      constraint,
      accountIndex: 3,
      pubkey: args.vaultUsdcAta,
    }) &&
    hasPubkeyConstraint({
      constraint,
      accountIndex: 4,
      pubkey: args.mint,
    }) &&
    hasPubkeyConstraint({
      constraint,
      accountIndex: 6,
      pubkey: args.vaultPda,
    }) &&
    hasDataU8Equals(constraint, 0n, SUBSCRIPTIONS_TRANSFER_RECURRING) &&
    hasDataSliceEquals(
      constraint,
      BigInt(SUBSCRIPTION_TRANSFER_DELEGATOR_OFFSET),
      publicKeyBytes(args.delegator)
    ) &&
    hasDataSliceEquals(
      constraint,
      BigInt(SUBSCRIPTION_TRANSFER_MINT_OFFSET),
      publicKeyBytes(args.mint)
    )
  );
}

function createSubscriptionRevokeDelegationInstruction(args: {
  authority: PublicKey;
  delegation: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    keys: [
      { pubkey: args.authority, isSigner: true, isWritable: true },
      { pubkey: args.delegation, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(subscriptionRevokeDelegationData()),
  });
}

async function findRecurringDelegations(args: {
  connection: Connection;
  delegator: PublicKey;
  mint: PublicKey;
  subscriptionAuthority: PublicKey;
  vaultPda: PublicKey;
}): Promise<DelegationCandidate[]> {
  const accounts = await args.connection.getProgramAccounts(
    SUBSCRIPTIONS_PROGRAM_ID,
    {
      filters: [
        { dataSize: SUBSCRIPTION_RECURRING_DELEGATION_DATA_LEN },
        {
          memcmp: {
            offset: SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET,
            bytes: bs58.encode(
              Uint8Array.from([SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR])
            ),
          },
        },
        {
          memcmp: {
            offset: SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET,
            bytes: args.delegator.toBase58(),
          },
        },
        {
          memcmp: {
            offset: SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET,
            bytes: args.vaultPda.toBase58(),
          },
        },
        {
          memcmp: {
            offset: SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET,
            bytes: args.subscriptionAuthority.toBase58(),
          },
        },
        {
          memcmp: {
            offset: SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET,
            bytes: args.mint.toBase58(),
          },
        },
      ],
    }
  );

  return accounts.map(({ account, pubkey }) => ({
    address: pubkey.toBase58(),
    lamports: account.lamports,
    amountPerPeriodRaw: readU64Le(
      account.data,
      SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET
    ).toString(),
    amountPulledRaw: readU64Le(
      account.data,
      SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PULLED_OFFSET
    ).toString(),
  }));
}

async function resolveDelegationCandidates(args: {
  connection: Connection;
  explicitDelegations: PublicKey[];
  delegator: PublicKey;
  mint: PublicKey;
  subscriptionAuthority: PublicKey;
  vaultPda: PublicKey;
}): Promise<DelegationCandidate[]> {
  if (args.explicitDelegations.length === 0) {
    return findRecurringDelegations(args);
  }

  return Promise.all(
    args.explicitDelegations.map(async (delegation) => {
      const account = await args.connection.getAccountInfo(
        delegation,
        "confirmed"
      );
      if (!account) {
        return {
          address: delegation.toBase58(),
          lamports: 0,
          amountPerPeriodRaw: "0",
          amountPulledRaw: "0",
        };
      }
      if (!account.owner.equals(SUBSCRIPTIONS_PROGRAM_ID)) {
        throw new Error(
          `Recurring delegation ${delegation.toBase58()} is not owned by the Subscriptions program.`
        );
      }
      return {
        address: delegation.toBase58(),
        lamports: account.lamports,
        amountPerPeriodRaw: readU64Le(
          account.data,
          SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET
        ).toString(),
        amountPulledRaw: readU64Le(
          account.data,
          SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PULLED_OFFSET
        ).toString(),
      };
    })
  );
}

async function findBalanceSweepPolicies(args: {
  client: ReturnType<typeof createSmartAccountVaultsClient>;
  connection: Connection;
  delegator: PublicKey;
  explicitPolicies: PublicKey[];
  lowLevelClient: ReturnType<typeof createLoyalSmartAccountsClient>;
  mint: PublicKey;
  settingsPda: PublicKey;
  subscriptionAuthority: PublicKey;
  vaultPda: PublicKey;
  vaultUsdcAta: PublicKey;
  walletUsdcAta: PublicKey;
}): Promise<PolicyCandidate[]> {
  const overview =
    args.explicitPolicies.length === 0
      ? await args.client.fetchPolicyOverview({
          settingsPda: args.settingsPda,
          rootSigners: [],
        })
      : {
          policies: args.explicitPolicies.map((policy) => ({
            address: policy.toBase58(),
            accountIndex: null,
            seed: "explicit",
            state: "unknown",
          })),
        };

  return Promise.all(
    overview.policies.map(async (policy) => {
      const policyPubkey = new PublicKey(policy.address);
      const account = await args.connection.getAccountInfo(
        policyPubkey,
        "confirmed"
      );
      const rawPolicy = account
        ? await args.lowLevelClient.policies.queries.fetchPolicy(policyPubkey)
        : null;
      const matchesBalanceSweep =
        rawPolicy !== null &&
        isBalanceSweepPolicy({
          policy: rawPolicy,
          delegator: args.delegator,
          mint: args.mint,
          subscriptionAuthority: args.subscriptionAuthority,
          vaultPda: args.vaultPda,
          vaultUsdcAta: args.vaultUsdcAta,
          walletUsdcAta: args.walletUsdcAta,
        });

      return {
        address: policy.address,
        seed: policy.seed,
        state: rawPolicy?.policyState.__kind ?? policy.state,
        accountIndex:
          rawPolicy?.policyState.__kind === "ProgramInteraction"
            ? rawPolicy.policyState.fields[0].accountIndex
            : policy.accountIndex,
        lamports: account?.lamports ?? null,
        explicit: args.explicitPolicies.length > 0,
        matchesBalanceSweep,
      };
    })
  ).then((policies) =>
    policies.filter((policy) => policy.explicit || policy.matchesBalanceSweep)
  );
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

async function executeCleanup(args: {
  client: ReturnType<typeof createSmartAccountVaultsClient>;
  connection: Connection;
  delegations: DelegationCandidate[];
  policies: PolicyCandidate[];
  settingsPda: PublicKey;
  signer: Keypair;
}) {
  const delegationPubkeys = args.delegations.map(
    (delegation) => new PublicKey(delegation.address)
  );
  const policyPubkeys = args.policies.map(
    (policy) => new PublicKey(policy.address)
  );
  const closePolicyPrepared =
    policyPubkeys.length === 0
      ? null
      : await args.client.prepareClosePoliciesSync({
          settingsPda: args.settingsPda,
          policies: policyPubkeys,
          feePayer: args.signer.publicKey,
          signers: [args.signer.publicKey],
        });
  const prepared = {
    operation: "earnAutodepositCleanup",
    payer: args.signer.publicKey,
    programId: args.client.programId,
    requiresConfirmation: true,
    instructions: [
      ...delegationPubkeys.map((delegation) =>
        createSubscriptionRevokeDelegationInstruction({
          authority: args.signer.publicKey,
          delegation,
        })
      ),
      ...(closePolicyPrepared?.instructions ?? []),
    ],
    lookupTableAccounts: closePolicyPrepared?.lookupTableAccounts ?? [],
  } as const;

  if (prepared.instructions.length === 0) {
    throw new Error("No cleanup instructions to execute.");
  }

  const signerBalanceBefore = await args.connection.getBalance(
    args.signer.publicKey,
    "confirmed"
  );
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
      `Cleanup simulation failed: ${JSON.stringify(simulation.value.err)}\n${
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
  const signerBalanceAfter = await args.connection.getBalance(
    args.signer.publicKey,
    "confirmed"
  );

  const cleanupAccounts = [...delegationPubkeys, ...policyPubkeys];
  const remainingAccounts = await args.connection.getMultipleAccountsInfo(
    cleanupAccounts,
    "confirmed"
  );
  const stillOpen = cleanupAccounts.filter(
    (_, index) => remainingAccounts[index]
  );
  if (stillOpen.length > 0) {
    throw new Error(
      `Cleanup transaction confirmed, but account(s) still exist: ${stillOpen
        .map((account) => account.toBase58())
        .join(", ")}`
    );
  }

  return {
    confirmedSlot,
    feeLamports,
    signature,
    signerBalanceBefore,
    signerBalanceAfter,
    signerBalanceDelta: signerBalanceAfter - signerBalanceBefore,
  };
}

function printDelegationTable(delegations: DelegationCandidate[]) {
  console.table(
    delegations.map((delegation) => ({
      delegation: delegation.address,
      amountPerPeriodRaw: delegation.amountPerPeriodRaw,
      amountPulledRaw: delegation.amountPulledRaw,
      lamports: delegation.lamports,
    }))
  );
}

function printPolicyTable(policies: PolicyCandidate[]) {
  console.table(
    policies.map((policy) => ({
      policy: policy.address,
      seed: policy.seed,
      state: policy.state,
      accountIndex: policy.accountIndex,
      lamports: policy.lamports,
      explicit: policy.explicit,
      balanceSweepMatch: policy.matchesBalanceSweep,
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
  const usdcMint = getStablecoinMintForCluster(loyalCluster, Stablecoin.USDC);
  const vaultPda = pda.getSmartAccountPda({
    programId: args.programId,
    settingsPda: args.settingsPda,
    accountIndex: EARN_VAULT_INDEX,
  })[0];
  const walletUsdcAta = PublicKey.findProgramAddressSync(
    [
      args.walletAddress.toBytes(),
      new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBytes(),
      usdcMint.toBytes(),
    ],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
  )[0];
  const vaultUsdcAta = PublicKey.findProgramAddressSync(
    [
      vaultPda.toBytes(),
      new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBytes(),
      usdcMint.toBytes(),
    ],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
  )[0];
  const subscriptionAuthority = deriveSubscriptionAuthority(
    args.walletAddress,
    usdcMint
  );
  const subscriptionAuthorityAccount = await connection.getAccountInfo(
    subscriptionAuthority,
    "confirmed"
  );

  console.log(`mode: ${args.execute ? "execute" : "dry-run"}`);
  console.log(`cluster: ${loyalCluster} (solana env: ${solanaEnv})`);
  console.log(`rpc: ${formatRpcUrlForLog(rpcUrl)}`);
  console.log(`settings: ${args.settingsPda.toBase58()}`);
  console.log(`wallet: ${args.walletAddress.toBase58()}`);
  console.log(`earn vault: ${vaultPda.toBase58()}`);
  console.log(`USDC mint: ${usdcMint.toBase58()}`);
  console.log(`subscription authority: ${subscriptionAuthority.toBase58()}`);
  console.log(
    `subscription authority lamports: ${
      subscriptionAuthorityAccount?.lamports ?? "missing"
    }`
  );

  const signer = args.execute ? loadTestingKeypairFromEnv() : null;
  if (signer) {
    if (!signer.publicKey.equals(args.walletAddress)) {
      throw new Error(
        `SOLANA_TESTING_PK public key ${signer.publicKey.toBase58()} does not match --wallet-address.`
      );
    }
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

  const [delegations, policies] = await Promise.all([
    resolveDelegationCandidates({
      connection,
      explicitDelegations: args.recurringDelegations,
      delegator: args.walletAddress,
      mint: usdcMint,
      subscriptionAuthority,
      vaultPda,
    }),
    findBalanceSweepPolicies({
      client,
      connection,
      delegator: args.walletAddress,
      explicitPolicies: args.policies,
      lowLevelClient,
      mint: usdcMint,
      settingsPda: args.settingsPda,
      subscriptionAuthority,
      vaultPda,
      vaultUsdcAta,
      walletUsdcAta,
    }),
  ]);

  console.log("");
  console.log("Recurring delegation candidates:");
  printDelegationTable(delegations);

  console.log("");
  console.log("Balance-sweep policy candidates:");
  printPolicyTable(policies);

  const delegationLamports = delegations.reduce(
    (sum, delegation) => sum + delegation.lamports,
    0
  );
  const policyLamports = policies.reduce(
    (sum, policy) => sum + (policy.lamports ?? 0),
    0
  );
  console.log("");
  console.log(`delegation lamports to close: ${delegationLamports}`);
  console.log(`policy lamports to close: ${policyLamports}`);
  console.log(
    `subscription authority lamports not closed by this script: ${
      subscriptionAuthorityAccount?.lamports ?? 0
    }`
  );

  if (delegations.length === 0 && policies.length === 0) {
    console.log(
      "No Earn autodeposit delegation or balance-sweep policy found."
    );
    return;
  }

  if (!args.execute) {
    console.log("");
    console.log(
      "Dry-run only. Re-run with --execute to revoke delegations and close policies."
    );
    return;
  }

  if (!signer) {
    throw new Error("Internal error: execute mode requires signer.");
  }

  const result = await executeCleanup({
    client,
    connection,
    delegations,
    policies,
    settingsPda: args.settingsPda,
    signer,
  });
  const postSubscriptionAuthorityAccount = await connection.getAccountInfo(
    subscriptionAuthority,
    "confirmed"
  );

  console.log("");
  console.log(`cleanup signature: ${result.signature}`);
  console.log(`confirmed slot: ${result.confirmedSlot}`);
  console.log(`transaction fee lamports: ${result.feeLamports ?? "unknown"}`);
  console.log(`signer balance before: ${result.signerBalanceBefore}`);
  console.log(`signer balance after: ${result.signerBalanceAfter}`);
  console.log(`signer balance delta: ${result.signerBalanceDelta}`);
  if (result.feeLamports !== null) {
    console.log(
      `delta plus fee: ${result.signerBalanceDelta + result.feeLamports}`
    );
  }
  console.log(`closed delegation lamports: ${delegationLamports}`);
  console.log(`closed policy lamports: ${policyLamports}`);
  console.log(
    `subscription authority lamports after cleanup: ${
      postSubscriptionAuthorityAccount?.lamports ?? "missing"
    }`
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
