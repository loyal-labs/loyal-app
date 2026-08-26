import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  codecs,
  createLoyalSmartAccountsClient,
  pda,
  PROGRAM_ID,
  smartAccounts,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts";
import {
  getKaminoUsdcEarnTargetForCluster,
  LoyalCluster,
} from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  mintToChecked,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";

import { resolveEarnRealtimeRefreshPlan } from "../src/features/earn-realtime/invalidation";
import {
  consumeEarnRealtimeStream,
  type EarnRealtimeTokenResponse,
} from "../src/features/earn-realtime/stream";
import {
  EARN_REALTIME_EVENT_TYPES,
  type EarnRealtimeInvalidation,
} from "../src/features/earn-realtime/types";
import { resolveRequiredClientEarnPolicy } from "../src/features/earn-policy/resolve-client-policy";

const INITIAL_DEPOSIT_RAW = BigInt(4_000_000);
const TOP_UP_RAW = BigInt(2_000_000);
const PARTIAL_WITHDRAW_RAW = BigInt(2_000_000);
const FULL_WITHDRAW_RAW = BigInt(4_000_000);
const INITIAL_WALLET_BALANCE_RAW = BigInt(10_000_000);
const MINT_AUTHORITY_SEED = new Uint8Array(32).fill(7);
const WALLET_SEED = new Uint8Array(32).fill(8);
const POLICY_SIGNER_SEED = new Uint8Array(32).fill(9);
const KAMINO_DEPOSIT_DISCRIMINATOR = Buffer.from([
  216, 224, 191, 27, 204, 151, 102, 175,
]);
const KAMINO_WITHDRAW_DISCRIMINATOR = Buffer.from([
  235, 52, 119, 152, 149, 197, 20, 7,
]);
const KAMINO_FARMS_PROGRAM = new PublicKey(
  "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"
);
const FORBIDDEN_EARN_API_PATTERN =
  /\/api\/smart-accounts\/(?:yield-optimization|mobile\/earn)\/(?:deposits?|withdrawals?|withdraw|deposit|policy-refunds|policies)\/(?:prepare|confirm|reconcile)(?:\/|$)/;

type Stage =
  | "route_policy"
  | "setup_policy"
  | "initial_deposit"
  | "top_up"
  | "partial_withdrawal"
  | "full_withdrawal";
type ChainTransaction = { signature: string; slot: number; stage: Stage };
type GenesisManifest = { addresses: Record<string, string> };
type LocalState = {
  collateralMint: string;
  forbiddenApiRequests: string[];
  kaminoRequestCount: number;
  market: string;
  marketAuthority: string;
  obligation: string;
  policyAccount: string;
  policySeed: string;
  projectedPolicyRefreshCount: number;
  reserve: string;
  reserveLiquiditySupply: string;
  settingsPda: string;
  setupPolicyAccount: string;
  setupPolicySeed: string;
  usdcMint: string;
  vaultCollateralAta: string;
  vaultPubkey: string;
  walletAddress: string;
};
type Args = Record<string, string | undefined>;

function parseArgs(argv: string[]): { command: string; args: Args } {
  const [command, ...rest] = argv;
  if (
    !command ||
    ![
      "initial",
      "topup",
      "partial",
      "full",
      "listen",
      "wait-finalized",
    ].includes(command)
  ) {
    throw new Error(
      "Expected initial, topup, partial, full, listen, or wait-finalized command."
    );
  }
  const args: Args = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!(key?.startsWith("--") && value))
      throw new Error(`Invalid argument near ${key ?? "end"}.`);
    args[key.slice(2)] = value;
  }
  return { command, args };
}

function required(args: Args, ...keys: string[]): void {
  for (const key of keys)
    if (!args[key]) throw new Error(`--${key} is required.`);
}

function localConnection(rpcUrl: string): Connection {
  const url = new URL(rpcUrl);
  if (!(url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
    throw new Error("The Earn local E2E refuses non-loopback RPC endpoints.");
  }
  return new Connection(url.toString(), "confirmed");
}

function localWallet(): Keypair {
  return Keypair.fromSeed(WALLET_SEED);
}

function policySigner(): Keypair {
  return Keypair.fromSeed(POLICY_SIGNER_SEED);
}

function decimalAmountToRaw(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  return (
    BigInt(whole || "0") * BigInt(1_000_000) +
    BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0")
  );
}

function encodedAmount(discriminator: Buffer, amountRaw: bigint): string {
  const data = Buffer.alloc(16);
  discriminator.copy(data);
  data.writeBigUInt64LE(amountRaw, 8);
  return data.toString("base64");
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}

function configureFetchGuard(state: LocalState): () => void {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = inputUrl(input);
    const pathname = new URL(rawUrl, "http://local.loyal").pathname;
    if (FORBIDDEN_EARN_API_PATTERN.test(pathname)) {
      state.forbiddenApiRequests.push(pathname);
      throw new Error(
        `Client attempted forbidden Earn API request: ${pathname}`
      );
    }
    const deposit = pathname.endsWith("/klend/deposit-instructions");
    const withdraw = pathname.endsWith("/klend/withdraw-instructions");
    if (!(deposit || withdraw)) return nativeFetch(input, init);
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      amount?: string;
      wallet?: string;
    };
    if (!(body.amount && body.wallet))
      throw new Error("Kamino request omitted amount or wallet.");
    if (body.wallet !== state.vaultPubkey)
      throw new Error("Kamino request used an unexpected vault.");
    state.kaminoRequestCount += 1;
    const program = getKaminoUsdcEarnTargetForCluster(
      LoyalCluster.MainnetBeta
    ).lendProgramId.toBase58();
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      new PublicKey(state.usdcMint),
      new PublicKey(state.vaultPubkey),
      true,
      TOKEN_PROGRAM_ID
    ).toBase58();
    const ro = (address: string) => ({ address, role: "READONLY" });
    const rw = (address: string) => ({ address, role: "WRITABLE" });
    const signer = (address: string) => ({ address, role: "WRITABLE_SIGNER" });
    const common = [
      signer(state.vaultPubkey),
      rw(state.obligation),
      ro(state.market),
      ro(state.marketAuthority),
      rw(state.reserve),
      ro(state.usdcMint),
    ];
    const accounts = deposit
      ? [
          ...common,
          rw(state.reserveLiquiditySupply),
          rw(state.collateralMint),
          rw(state.vaultCollateralAta),
          rw(vaultUsdcAta),
        ]
      : [
          ...common,
          rw(state.vaultCollateralAta),
          rw(state.collateralMint),
          rw(state.reserveLiquiditySupply),
          rw(vaultUsdcAta),
        ];
    accounts.push(
      ro(program),
      ro(TOKEN_PROGRAM_ID.toBase58()),
      ro(TOKEN_PROGRAM_ID.toBase58()),
      ro("Sysvar1nstructions1111111111111111111111111"),
      ro(program),
      ro(program),
      ro(KAMINO_FARMS_PROGRAM.toBase58())
    );
    return new Response(
      JSON.stringify({
        instructions: [
          {
            accounts,
            data: encodedAmount(
              deposit
                ? KAMINO_DEPOSIT_DISCRIMINATOR
                : KAMINO_WITHDRAW_DISCRIMINATOR,
              decimalAmountToRaw(body.amount)
            ),
            programAddress: program,
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = nativeFetch;
  };
}

async function finalizedSlot(
  connection: Connection,
  signature: string
): Promise<number> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const status = (
      await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (status?.err)
      throw new Error(
        `Transaction ${signature} failed: ${JSON.stringify(status.err)}`
      );
    if (status?.confirmationStatus === "finalized") {
      const transaction = await connection.getTransaction(signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      if (!transaction)
        throw new Error(`Finalized transaction ${signature} was not found.`);
      return transaction.slot;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Transaction ${signature} did not finalize.`);
}

async function confirmedSlot(
  connection: Connection,
  signature: string
): Promise<number> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const status = (
      await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (status?.err)
      throw new Error(
        `Transaction ${signature} failed: ${JSON.stringify(status.err)}`
      );
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      const transaction = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!transaction)
        throw new Error(`Confirmed transaction ${signature} was not found.`);
      return transaction.slot;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Transaction ${signature} was not confirmed.`);
}

async function sendPrepared(
  connection: Connection,
  client: ReturnType<typeof createSmartAccountVaultsClient>,
  prepared: PreparedLoyalSmartAccountsOperation<string>,
  stage: Stage
): Promise<ChainTransaction> {
  const signature = await client.sdk.send(prepared, {
    confirm: true,
    signers: [localWallet()],
  });
  return { signature, slot: await confirmedSlot(connection, signature), stage };
}

async function createSmartAccount(
  connection: Connection,
  treasury: PublicKey
): Promise<PublicKey> {
  const wallet = localWallet();
  const airdrop = await connection.requestAirdrop(
    wallet.publicKey,
    20 * LAMPORTS_PER_SOL
  );
  await confirmedSlot(connection, airdrop);
  const [settingsPda] = pda.getSettingsPda({
    accountIndex: BigInt(1),
    programId: PROGRAM_ID,
  });
  const prepared = await smartAccounts.prepare.create({
    creator: wallet.publicKey,
    programId: PROGRAM_ID,
    rentCollector: null,
    settings: settingsPda,
    settingsAuthority: null,
    signers: [{ key: wallet.publicKey, permissions: codecs.Permissions.all() }],
    threshold: 1,
    timeLock: 0,
    treasury,
  });
  await createLoyalSmartAccountsClient({
    connection,
    defaultCommitment: "confirmed",
    programId: PROGRAM_ID,
  }).send(prepared, { confirm: true, signers: [wallet] });
  return settingsPda;
}

async function writeTransactions(
  path: string,
  records: ChainTransaction[]
): Promise<void> {
  await writeFile(
    path,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
  );
}

async function waitFinalized(args: Args): Promise<void> {
  required(args, "rpc-url", "transaction");
  const connection = localConnection(args["rpc-url"]!);
  const records = (await readFile(args.transaction!, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChainTransaction);
  await Promise.all(
    records.map((record) => finalizedSlot(connection, record.signature))
  );
}

async function assertBalances(
  connection: Connection,
  state: LocalState,
  walletRaw: bigint,
  obligationRaw: bigint,
  collateralRaw: bigint
): Promise<void> {
  const walletAta = getAssociatedTokenAddressSync(
    new PublicKey(state.usdcMint),
    localWallet().publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  const walletAccount = await getAccount(
    connection,
    walletAta,
    "confirmed",
    TOKEN_PROGRAM_ID
  );
  if (walletAccount.amount !== walletRaw)
    throw new Error(`Wallet balance ${walletAccount.amount} != ${walletRaw}.`);
  const obligation = await connection.getAccountInfo(
    new PublicKey(state.obligation),
    "confirmed"
  );
  if (!obligation || obligation.data.readBigUInt64LE(128) !== obligationRaw) {
    throw new Error(`Obligation did not reach ${obligationRaw}.`);
  }
  const collateralInfo = await connection.getAccountInfo(
    new PublicKey(state.vaultCollateralAta),
    "confirmed"
  );
  if (collateralRaw === BigInt(0) && !collateralInfo) return;
  const collateral = await getAccount(
    connection,
    new PublicKey(state.vaultCollateralAta),
    "confirmed",
    TOKEN_PROGRAM_ID
  );
  if (collateral.amount !== collateralRaw)
    throw new Error(
      `Collateral balance ${collateral.amount} != ${collateralRaw}.`
    );
}

function policy(state: LocalState) {
  return {
    account: new PublicKey(state.policyAccount),
    seed: BigInt(state.policySeed),
    setupPolicy: {
      account: new PublicKey(state.setupPolicyAccount),
      seed: BigInt(state.setupPolicySeed),
    },
  };
}

async function projectedPolicy(state: LocalState, path: string) {
  const projectedState = JSON.parse(await readFile(path, "utf8")) as {
    policy: {
      account: string;
      seed: string;
      setupPolicy: { account: string; seed: string } | null;
    } | null;
    settingsPda: string;
  };
  let committed = false;
  const resolved = await resolveRequiredClientEarnPolicy({
    currentState: { policy: null, settingsPda: state.settingsPda },
    expectedSettingsPda: state.settingsPda,
    onRefreshed: () => {
      committed = true;
    },
    refreshState: async () => {
      state.projectedPolicyRefreshCount += 1;
      return projectedState;
    },
  });
  if (!committed || state.projectedPolicyRefreshCount !== 1) {
    throw new Error(
      "Existing-position policy was not recovered by one refresh."
    );
  }
  if (
    resolved.account !== state.policyAccount ||
    resolved.seed !== state.policySeed ||
    resolved.setupPolicy?.account !== state.setupPolicyAccount ||
    resolved.setupPolicy.seed !== state.setupPolicySeed
  ) {
    throw new Error(
      "Refreshed client policy differs from LaserStream projection."
    );
  }
  return {
    account: new PublicKey(resolved.account),
    seed: BigInt(resolved.seed),
    setupPolicy: {
      account: new PublicKey(resolved.setupPolicy.account),
      seed: BigInt(resolved.setupPolicy.seed),
    },
  };
}

function assertNoApiConfirmation(state: LocalState): void {
  if (state.forbiddenApiRequests.length)
    throw new Error(
      `Forbidden API requests: ${state.forbiddenApiRequests.join(", ")}`
    );
}

async function initial(args: Args): Promise<void> {
  required(args, "rpc-url", "treasury", "genesis", "state", "transaction");
  const manifest = JSON.parse(
    await readFile(args.genesis!, "utf8")
  ) as GenesisManifest;
  const connection = localConnection(args["rpc-url"]!);
  const settingsPda = await createSmartAccount(
    connection,
    new PublicKey(args.treasury!)
  );
  if (settingsPda.toBase58() !== manifest.addresses.settings)
    throw new Error("Genesis settings mismatch.");
  const state: LocalState = {
    collateralMint: manifest.addresses.collateralMint!,
    forbiddenApiRequests: [],
    kaminoRequestCount: 0,
    market: manifest.addresses.market!,
    marketAuthority: manifest.addresses.marketAuthority!,
    obligation: manifest.addresses.obligation!,
    policyAccount: "",
    policySeed: "",
    projectedPolicyRefreshCount: 0,
    reserve: manifest.addresses.reserve!,
    reserveLiquiditySupply: manifest.addresses.reserveLiquiditySupply!,
    settingsPda: settingsPda.toBase58(),
    setupPolicyAccount: "",
    setupPolicySeed: "",
    usdcMint: manifest.addresses.usdcMint!,
    vaultCollateralAta: manifest.addresses.vaultCollateralAta!,
    vaultPubkey: manifest.addresses.vault!,
    walletAddress: localWallet().publicKey.toBase58(),
  };
  const restore = configureFetchGuard(state);
  try {
    const walletAta = getAssociatedTokenAddressSync(
      new PublicKey(state.usdcMint),
      localWallet().publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          localWallet().publicKey,
          walletAta,
          localWallet().publicKey,
          new PublicKey(state.usdcMint),
          TOKEN_PROGRAM_ID
        )
      ),
      [localWallet()],
      { commitment: "confirmed" }
    );
    await mintToChecked(
      connection,
      localWallet(),
      new PublicKey(state.usdcMint),
      walletAta,
      Keypair.fromSeed(MINT_AUTHORITY_SEED),
      INITIAL_WALLET_BALANCE_RAW,
      6,
      [],
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );
    const vaults = createSmartAccountVaultsClient({
      connection,
      programId: PROGRAM_ID,
    });
    const prepared = await vaults.prepareEarnUsdcDeposit({
      amountRaw: INITIAL_DEPOSIT_RAW,
      cluster: LoyalCluster.MainnetBeta,
      feePayer: localWallet().publicKey,
      policySigner: policySigner().publicKey,
      settingsPda,
      walletAddress: localWallet().publicKey,
    });
    if (
      !(
        prepared.policySetupPrepared &&
        prepared.policyFinalizePrepared &&
        prepared.setupPolicy
      )
    ) {
      throw new Error("Initial deposit omitted client policy stages.");
    }
    state.policyAccount = prepared.policy.account.toBase58();
    state.policySeed = prepared.policy.seed.toString();
    state.setupPolicyAccount = prepared.setupPolicy.account.toBase58();
    state.setupPolicySeed = prepared.setupPolicy.seed.toString();
    if (
      prepared.vault.pubkey.toBase58() !== state.vaultPubkey ||
      prepared.targetReserve.obligation.toBase58() !== state.obligation
    ) {
      throw new Error("Client builder targeted unexpected local accounts.");
    }
    const records = [
      await sendPrepared(
        connection,
        vaults,
        prepared.policySetupPrepared,
        "route_policy"
      ),
      await sendPrepared(
        connection,
        vaults,
        prepared.policyFinalizePrepared,
        "setup_policy"
      ),
      await sendPrepared(
        connection,
        vaults,
        prepared.prepared,
        "initial_deposit"
      ),
    ];
    await assertBalances(
      connection,
      state,
      BigInt(6_000_000),
      BigInt(4_000_000),
      BigInt(4_000_000)
    );
    assertNoApiConfirmation(state);
    await writeFile(args.state!, JSON.stringify(state, null, 2));
    await writeTransactions(args.transaction!, records);
  } finally {
    restore();
  }
}

async function next(
  command: "topup" | "partial" | "full",
  args: Args
): Promise<void> {
  required(args, "rpc-url", "state", "transaction");
  const state = JSON.parse(await readFile(args.state!, "utf8")) as LocalState;
  const connection = localConnection(args["rpc-url"]!);
  const vaults = createSmartAccountVaultsClient({
    connection,
    programId: PROGRAM_ID,
  });
  const restore = configureFetchGuard(state);
  try {
    let record: ChainTransaction;
    if (command === "topup") {
      const prepared = await vaults.prepareEarnUsdcDeposit({
        amountRaw: TOP_UP_RAW,
        cluster: LoyalCluster.MainnetBeta,
        feePayer: localWallet().publicKey,
        initializeYieldRoutingPolicy: false,
        policySigner: policySigner().publicKey,
        settingsPda: new PublicKey(state.settingsPda),
        walletAddress: localWallet().publicKey,
        yieldRoutingPolicy: policy(state),
      });
      if (prepared.policySetupPrepared || prepared.policyFinalizePrepared)
        throw new Error("Top-up rebuilt policy stages.");
      record = await sendPrepared(
        connection,
        vaults,
        prepared.prepared,
        "top_up"
      );
      await assertBalances(
        connection,
        state,
        BigInt(4_000_000),
        BigInt(6_000_000),
        BigInt(6_000_000)
      );
    } else {
      const partial = command === "partial";
      const yieldRoutingPolicy =
        partial && args["projected-state"]
          ? await projectedPolicy(state, args["projected-state"])
          : policy(state);
      const amountRaw = partial ? PARTIAL_WITHDRAW_RAW : FULL_WITHDRAW_RAW;
      const currentAmountRaw = partial ? BigInt(6_000_000) : BigInt(4_000_000);
      const base = {
        amountRaw,
        closePoliciesOnFullWithdrawal: false,
        cluster: LoyalCluster.MainnetBeta,
        feePayer: localWallet().publicKey,
        policySigner: policySigner().publicKey,
        settingsPda: new PublicKey(state.settingsPda),
        walletAddress: localWallet().publicKey,
        source: {
          type: "reserve" as const,
          id: state.reserve,
          amountRaw: currentAmountRaw,
          liquidityMint: new PublicKey(state.usdcMint),
          market: new PublicKey(state.market),
          reserve: new PublicKey(state.reserve),
        },
        yieldRoutingPolicy,
      };
      const prepared = await vaults.prepareEarnUsdcWithdraw(
        partial ? { ...base, mode: "partial" } : { ...base, mode: "full" }
      );
      if (prepared.withdrawSteps.length !== 1 || !prepared.withdrawSteps[0])
        throw new Error(`${command} did not build one client step.`);
      record = await sendPrepared(
        connection,
        vaults,
        prepared.withdrawSteps[0].prepared,
        partial ? "partial_withdrawal" : "full_withdrawal"
      );
      await assertBalances(
        connection,
        state,
        partial ? BigInt(6_000_000) : BigInt(10_000_000),
        partial ? BigInt(4_000_000) : BigInt(0),
        partial ? BigInt(4_000_000) : BigInt(0)
      );
    }
    assertNoApiConfirmation(state);
    await writeFile(args.state!, JSON.stringify(state, null, 2));
    await writeTransactions(args.transaction!, [record]);
  } finally {
    restore();
  }
}

function realtimeToken(state: LocalState, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      aud: "loyal-yield-realtime",
      clientKind: "web",
      earnVaultAddress: state.vaultPubkey,
      exp: now + 300,
      iat: now,
      iss: "loyal-apps",
      scopes: ["earn"],
      settingsPda: state.settingsPda,
      solanaEnv: "mainnet-beta",
      v: 1,
      walletAddress: state.walletAddress,
    })
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret)
    .update(payload)
    .digest("base64url")}`;
}

async function listen(args: Args): Promise<void> {
  required(args, "auth-secret", "events-url", "state", "output");
  const state = JSON.parse(await readFile(args.state!, "utf8")) as LocalState;
  const response: EarnRealtimeTokenResponse = {
    accessToken: realtimeToken(state, args["auth-secret"]!),
    eventsUrl: args["events-url"]!,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    schemaVersion: 1,
  };
  const expected = [
    "holding_event_deposit_initialized",
    "holding_event_deposit_top_up",
    "holding_event_withdrawal_partial",
    "holding_event_withdrawal_full",
  ];
  const events: EarnRealtimeInvalidation[] = [];
  const reasons: string[] = [];
  const controller = new AbortController();
  let complete = false;
  let output: string | null = null;
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    await consumeEarnRealtimeStream({
      cursor: null,
      onConnected: () => undefined,
      response,
      signal: controller.signal,
      onInvalidation: (event) => {
        events.push(event);
        if (event.eventType === EARN_REALTIME_EVENT_TYPES.transaction)
          reasons.push(event.reason ?? "");
        if (
          reasons.length === expected.length &&
          reasons.every((reason, index) => reason === expected[index]) &&
          events.some(
            (event) => event.eventType === EARN_REALTIME_EVENT_TYPES.position
          )
        ) {
          const refreshPlan = resolveEarnRealtimeRefreshPlan(events);
          if (
            !(
              refreshPlan.position &&
              refreshPlan.transactions &&
              refreshPlan.earnings
            )
          )
            throw new Error("Incomplete SSE refresh plan.");
          complete = true;
          output = JSON.stringify(
            { events, refreshPlan, transactionReasons: reasons },
            null,
            2
          );
          controller.abort();
        }
      },
    });
  } catch (error) {
    if (
      !(
        complete &&
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError"
      )
    )
      throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!complete)
    throw new Error(`SSE transaction reasons were ${reasons.join(", ")}.`);
  await writeFile(args.output!, output!);
}

const { command, args } = parseArgs(process.argv.slice(2));
if (command === "initial") await initial(args);
else if (command === "topup" || command === "partial" || command === "full")
  await next(command, args);
else if (command === "wait-finalized") await waitFinalized(args);
else await listen(args);
