import { mock } from "bun:test";
import bs58 from "bs58";
import { and, desc, eq } from "drizzle-orm";
import {
  getAssociatedTokenAddressSync,
  AccountLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  getKaminoUsdcEarnTargetForCluster,
  LoyalCluster,
} from "../packages/loyal-actions/src/index.ts";
import {
  createSmartAccountVaultsClient,
  sendPreparedWithWallet,
  type WalletAdapterLike,
} from "../packages/smart-account-vaults/src/index.ts";
import type {
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcYieldRoutingPolicy,
  SmartAccountPreparedEarnUsdcWithdraw,
} from "../packages/smart-account-vaults/src/types.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";
import { compilePreparedOperation } from "../sdk/loyal-smart-accounts-core/src/index.ts";
import {
  pda,
  PROGRAM_ADDRESS,
} from "../sdk/loyal-smart-accounts/src/index.ts";

mock.module("server-only", () => ({}));

type VerifyPhase =
  | "full-withdraw-cleanup"
  | "initial-deposit-from-clean"
  | "top-up-partial-smoke"
  | "all";

type CleanupCandidateEvidence = {
  account: string | null;
  action: "close" | "not_safely_closeable";
  kind: string;
  reason?: string;
};

type EvidenceStep = {
  amountRaw?: string;
  cleanupCandidates?: CleanupCandidateEvidence[];
  confirmedSlot?: string;
  error?: string;
  instructionCount?: number;
  kaminoDeposit?: unknown;
  kaminoSetupAccountCount?: number;
  kaminoSetupRentLamports?: string;
  kaminoSetupRequired?: boolean;
  postKaminoVaultUsdcRaw?: string | null;
  persistence?: unknown;
  signature?: string;
  simulationLogs?: string[];
  unsignedSimulationLogs?: string[];
  status: "skipped" | "success" | "failed";
  kaminoWithdrawAmountRaw?: string;
  transactionFeeLamports?: string;
  vaultUsdcRemainderRaw?: string;
};

const SOLANA_ENV = resolveSolanaEnv(
  process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV ?? "mainnet"
);
const VERIFY_PHASE = (process.env.EARN_VERIFY_PHASE ??
  "full-withdraw-cleanup") as VerifyPhase;
const DRY_RUN = process.env.EARN_VERIFY_DRY_RUN === "1";
const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  process.env.RPC_URL ??
  getSolanaEndpoints(SOLANA_ENV).rpcEndpoint;
const PROGRAM_ID = new PublicKey(
  process.env.LOYAL_SMART_ACCOUNTS_PROGRAM_ID ?? PROGRAM_ADDRESS
);
const SETTINGS_PDA = new PublicKey(
  process.env.EARN_SETTINGS_PDA ??
    process.env.SMART_ACCOUNT_SETTINGS_PDA ??
    "6jgkucnbz1RuHq6NULqACQY3r2XegHaWhgPpaCEGPCA3"
);
const FIRST_DEPOSIT_RAW = parseRawAmount(
  process.env.EARN_FIRST_DEPOSIT_RAW ?? "10000"
);
const TOP_UP_DEPOSIT_RAW = parseRawAmount(
  process.env.EARN_TOP_UP_DEPOSIT_RAW ?? "5000"
);
const PARTIAL_WITHDRAW_RAW = parseRawAmount(
  process.env.EARN_PARTIAL_WITHDRAW_RAW ?? "7000"
);
const RESUME_FULL_WITHDRAW_SIGNATURE =
  process.env.EARN_FULL_WITHDRAW_SIGNATURE?.trim() || null;
const RESUME_FULL_WITHDRAW_SLOT =
  process.env.EARN_FULL_WITHDRAW_SLOT?.trim() || null;
const RESUME_INITIAL_DEPOSIT_SIGNATURE =
  process.env.EARN_INITIAL_DEPOSIT_SIGNATURE?.trim() || null;
const RESUME_INITIAL_DEPOSIT_SLOT =
  process.env.EARN_INITIAL_DEPOSIT_SLOT?.trim() || null;
const RESUME_INITIAL_POLICY_SIGNATURE =
  process.env.EARN_INITIAL_POLICY_SIGNATURE?.trim() || null;
const RESUME_INITIAL_POLICY_SLOT =
  process.env.EARN_INITIAL_POLICY_SLOT?.trim() || null;
const RESUME_INITIAL_POLICY_ACCOUNT =
  process.env.EARN_INITIAL_POLICY_ACCOUNT?.trim() || null;
const RESUME_INITIAL_POLICY_SEED =
  process.env.EARN_INITIAL_POLICY_SEED?.trim() || null;
const RESUME_TOP_UP_DEPOSIT_SIGNATURE =
  process.env.EARN_TOP_UP_DEPOSIT_SIGNATURE?.trim() || null;
const RESUME_TOP_UP_DEPOSIT_SLOT =
  process.env.EARN_TOP_UP_DEPOSIT_SLOT?.trim() || null;
const RESUME_PARTIAL_WITHDRAW_SIGNATURE =
  process.env.EARN_PARTIAL_WITHDRAW_SIGNATURE?.trim() || null;
const RESUME_PARTIAL_WITHDRAW_SLOT =
  process.env.EARN_PARTIAL_WITHDRAW_SLOT?.trim() || null;
const EVIDENCE_PATH =
  process.env.EARN_MAINNET_EVIDENCE_PATH ??
  `/private/tmp/loyal-earn-mainnet-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;
const EARN_TARGET = getKaminoUsdcEarnTargetForCluster(LoyalCluster.MainnetBeta);
const RENT_REFUND_ROUNDING_ALLOWANCE_LAMPORTS = 10_000;

function parseRawAmount(value: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`Invalid positive raw amount: ${value}`);
  }
  return BigInt(value);
}

function loadTestingKeypair(): Keypair {
  const raw = process.env.SOLANA_TESTING_PK;
  if (!raw) {
    throw new Error("SOLANA_TESTING_PK is not set.");
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Keypair.fromSecretKey(
      Uint8Array.from(
        trimmed.match(/../g)!.map((byte) => Number.parseInt(byte, 16))
      )
    );
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

function loadDeploymentPolicySigner(): PublicKey {
  const raw = process.env.DEPLOYMENT_PK;
  if (!raw) {
    throw new Error("DEPLOYMENT_PK is not set.");
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed))).publicKey;
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Keypair.fromSecretKey(
      Uint8Array.from(
        trimmed.match(/../g)!.map((byte) => Number.parseInt(byte, 16))
      )
    ).publicKey;
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed)).publicKey;
}

function assertMainnet(): void {
  if (SOLANA_ENV !== "mainnet") {
    throw new Error(
      `This verifier must run against mainnet, got ${SOLANA_ENV}. Set NEXT_PUBLIC_SOLANA_ENV=mainnet.`
    );
  }
}

function assertVerifyPhase(phase: string): asserts phase is VerifyPhase {
  if (
    phase !== "full-withdraw-cleanup" &&
    phase !== "initial-deposit-from-clean" &&
    phase !== "top-up-partial-smoke" &&
    phase !== "all"
  ) {
    throw new Error(`Unsupported EARN_VERIFY_PHASE: ${phase}`);
  }
}

function createWalletAdapter(keypair: Keypair): WalletAdapterLike {
  return {
    publicKey: keypair.publicKey,
    async signTransaction<T extends VersionedTransaction>(transaction: T) {
      transaction.sign([keypair]);
      return transaction;
    },
  };
}

function bigintJson(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

async function writeEvidence(evidence: unknown): Promise<void> {
  await Bun.write(EVIDENCE_PATH, `${JSON.stringify(evidence, bigintJson, 2)}\n`);
}

async function resolveConfirmedSignatureSlot(args: {
  connection: Connection;
  signature: string;
}): Promise<bigint> {
  let lastStatus: unknown = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { value } = await args.connection.getSignatureStatuses(
      [args.signature],
      { searchTransactionHistory: true }
    );
    const status = value[0];
    lastStatus = status;
    if (status?.err) {
      throw new Error(
        `Transaction ${args.signature} failed: ${JSON.stringify(status.err)}`
      );
    }
    if (
      status &&
      (status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized")
    ) {
      return BigInt(status.slot);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Transaction ${args.signature} is not confirmed. Last status: ${JSON.stringify(
      lastStatus
    )}`
  );
}

async function resolveTransactionFeeLamports(args: {
  connection: Connection;
  signature: string;
}): Promise<bigint> {
  const transaction = await args.connection.getTransaction(args.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const fee = transaction?.meta?.fee;
  if (typeof fee !== "number") {
    throw new Error(`Transaction ${args.signature} fee is unavailable.`);
  }
  return BigInt(fee);
}

async function loadKaminoDepositEvidence(args: {
  connection: Connection;
  signature: string;
}) {
  const transaction = await args.connection.getTransaction(args.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!transaction) {
    throw new Error(`Transaction ${args.signature} is unavailable.`);
  }
  const logs = transaction.meta?.logMessages ?? [];
  const depositLog = logs.find((line) =>
    line.includes("Deposit reserve liquidity")
  );
  const amountMatch = depositLog?.match(
    /Deposit reserve liquidity (\d+) and obligation collateral (\d+)/
  );
  const staticKeys = transaction.transaction.message.staticAccountKeys;
  const loadedAddresses = transaction.meta?.loadedAddresses;
  const accountKeys = [
    ...staticKeys,
    ...(loadedAddresses?.writable ?? []),
    ...(loadedAddresses?.readonly ?? []),
  ];
  const collateralBalance = transaction.meta?.postTokenBalances?.find(
    (balance) =>
      balance.mint !== EARN_TARGET.liquidityMint.toBase58() &&
      BigInt(balance.uiTokenAmount.amount) > 0n
  );
  const reserveCollateralSupplyAccount =
    collateralBalance && accountKeys[collateralBalance.accountIndex]
      ? accountKeys[collateralBalance.accountIndex]
      : null;

  return {
    depositedLiquidityRaw: amountMatch?.[1] ?? null,
    initObligationLogged: logs.some((line) =>
      line.includes("Instruction: InitObligation")
    ),
    obligationCollateralRaw: amountMatch?.[2] ?? null,
    reserveCollateralMint: collateralBalance?.mint ?? null,
    reserveCollateralSupplyAccount:
      reserveCollateralSupplyAccount?.toBase58() ?? null,
  };
}

async function simulatePrepared(args: {
  connection: Connection;
  prepared: SmartAccountPreparedEarnUsdcDeposit["prepared"];
  wallet: WalletAdapterLike;
}): Promise<string[]> {
  const blockhash = await args.connection.getLatestBlockhash("confirmed");
  const transaction = compilePreparedOperation({
    blockhash: blockhash.blockhash,
    prepared: args.prepared,
  });
  const signed = await args.wallet.signTransaction(transaction);
  const simulation = await args.connection.simulateTransaction(signed, {
    commitment: "confirmed",
    sigVerify: true,
  });

  if (simulation.value.err) {
    throw new Error(
      `Simulation failed: ${JSON.stringify(simulation.value.err)}\n${(
        simulation.value.logs ?? []
      ).join("\n")}`
    );
  }

  return simulation.value.logs ?? [];
}

async function simulatePreparedUnsigned(args: {
  connection: Connection;
  prepared: SmartAccountPreparedEarnUsdcDeposit["prepared"];
}): Promise<string[]> {
  const blockhash = await args.connection.getLatestBlockhash("confirmed");
  const transaction = compilePreparedOperation({
    blockhash: blockhash.blockhash,
    prepared: args.prepared,
  });
  const simulation = await args.connection.simulateTransaction(transaction, {
    commitment: "confirmed",
    sigVerify: false,
  });

  if (simulation.value.err) {
    throw new Error(
      `Unsigned simulation failed: ${JSON.stringify(
        simulation.value.err
      )}\n${(simulation.value.logs ?? []).join("\n")}`
    );
  }

  return simulation.value.logs ?? [];
}

async function simulatePreparedPrefixTokenBalance(args: {
  connection: Connection;
  prepared: SmartAccountPreparedEarnUsdcDeposit["prepared"];
  tokenAccount: PublicKey;
  throughInstructionCount: number;
}): Promise<{ amountRaw: string | null; logs: string[] }> {
  const blockhash = await args.connection.getLatestBlockhash("confirmed");
  const transaction = compilePreparedOperation({
    blockhash: blockhash.blockhash,
    prepared: {
      ...args.prepared,
      instructions: args.prepared.instructions.slice(
        0,
        args.throughInstructionCount
      ),
    },
  });
  const simulation = await args.connection.simulateTransaction(transaction, {
    accounts: {
      addresses: [args.tokenAccount.toBase58()],
      encoding: "base64",
    },
    commitment: "confirmed",
    sigVerify: false,
  });
  const account = simulation.value.accounts?.[0];
  const accountData = account?.data;
  if (!accountData || !Array.isArray(accountData)) {
    return {
      amountRaw: null,
      logs: simulation.value.logs ?? [],
    };
  }

  const data = Buffer.from(accountData[0] as string, "base64");
  return {
    amountRaw: AccountLayout.decode(data).amount.toString(),
    logs: simulation.value.logs ?? [],
  };
}

async function sendOrResumePrepared(args: {
  connection: Connection;
  prepared: SmartAccountPreparedEarnUsdcDeposit["prepared"];
  resumeSignature: string | null;
  resumeSlot: string | null;
  wallet: WalletAdapterLike;
}): Promise<{ signature: string; simulationLogs: string[]; slot: bigint }> {
  if (args.resumeSignature) {
    return {
      signature: args.resumeSignature,
      simulationLogs: [],
      slot: args.resumeSlot
        ? BigInt(args.resumeSlot)
        : await resolveConfirmedSignatureSlot({
            connection: args.connection,
            signature: args.resumeSignature,
          }),
    };
  }

  const simulationLogs = await simulatePrepared(args);
  const signature = await sendPreparedWithWallet({
    confirm: true,
    connection: args.connection,
    prepared: args.prepared,
    sendOptions: {
      maxRetries: 5,
      preflightCommitment: "confirmed",
      skipPreflight: false,
    },
    wallet: args.wallet,
  });

  return {
    signature,
    simulationLogs,
    slot: await resolveConfirmedSignatureSlot({
      connection: args.connection,
      signature,
    }),
  };
}

function depositInput(args: {
  prepared: SmartAccountPreparedEarnUsdcDeposit;
  policyInitialization?: "create" | "reuse";
  policySignature: string;
  signature: string;
  slot: bigint;
}) {
  const persistence = args.prepared.persistence;
  return {
    cluster: persistence.cluster,
    confirmedSlot: args.slot,
    depositMint: persistence.depositMint,
    depositSignature: args.signature,
    delegatedSigner: persistence.delegatedSigner,
    liquidityMint: persistence.liquidityMint,
    market: persistence.market,
    policyAccount: persistence.policyAccount,
    policyId: BigInt(persistence.policyId),
    policyInitialization:
      args.policyInitialization ?? persistence.policyInitialization,
    policySeed: BigInt(persistence.policySeed),
    policySignature: args.policySignature,
    principalAmountRaw: BigInt(persistence.principalAmountRaw),
    settings: persistence.settings,
    smartAccountAddress: persistence.vaultPubkey,
    targetReserve: persistence.targetReserve,
    targetSupplyApyBps:
      persistence.targetSupplyApyBps === null
        ? null
        : BigInt(persistence.targetSupplyApyBps),
    vaultIndex: persistence.vaultIndex,
    vaultPubkey: persistence.vaultPubkey,
    walletAddress: persistence.walletAddress,
  };
}

function policyInput(args: {
  prepared: SmartAccountPreparedEarnUsdcYieldRoutingPolicy;
  signature: string;
  slot: bigint;
}) {
  return policyInputFromPersistence({
    persistence: args.prepared.persistence,
    signature: args.signature,
    slot: args.slot,
  });
}

function policyInputFromPersistence(args: {
  persistence: SmartAccountPreparedEarnUsdcYieldRoutingPolicy["persistence"];
  signature: string;
  slot: bigint;
}) {
  const persistence = args.persistence;
  return {
    cluster: persistence.cluster,
    confirmedSlot: args.slot,
    delegatedSigner: persistence.delegatedSigner,
    liquidityMint: persistence.liquidityMint,
    market: persistence.market,
    policyAccount: persistence.policyAccount,
    policyId: BigInt(persistence.policyId),
    policySeed: BigInt(persistence.policySeed),
    policySignature: args.signature,
    settings: persistence.settings,
    targetReserve: persistence.targetReserve,
    vaultIndex: persistence.vaultIndex,
    vaultPubkey: persistence.vaultPubkey,
    walletAddress: persistence.walletAddress,
  };
}

function withdrawalInput(args: {
  prepared: SmartAccountPreparedEarnUsdcWithdraw;
  signature: string;
  slot: bigint;
}) {
  const persistence = args.prepared.persistence;
  return {
    cluster: persistence.cluster,
    confirmedSlot: args.slot,
    delegatedSigner: persistence.delegatedSigner,
    liquidityMint: persistence.liquidityMint,
    market: persistence.market,
    mode: persistence.mode,
    policyAccount: persistence.policyAccount,
    policyId: BigInt(persistence.policyId),
    policySeed: BigInt(persistence.policySeed),
    settings: persistence.settings,
    smartAccountAddress: persistence.vaultPubkey,
    targetReserve: persistence.targetReserve,
    vaultIndex: persistence.vaultIndex,
    vaultPubkey: persistence.vaultPubkey,
    walletAddress: persistence.walletAddress,
    withdrawalSignature: args.signature,
    withdrawnAmountRaw: BigInt(persistence.withdrawnAmountRaw),
  };
}

function compactPosition(position: unknown): unknown {
  if (!position || typeof position !== "object") {
    return position;
  }
  const record = position as Record<string, unknown>;
  return {
    currentAmountRaw: record.currentAmountRaw,
    firstDepositSignature: record.firstDepositSignature,
    id: record.id,
    lastConfirmedSlot: record.lastConfirmedSlot,
    lastDepositSignature: record.lastDepositSignature,
    lastHoldingEventId: record.lastHoldingEventId,
    principalAmountRaw: record.principalAmountRaw,
    status: record.status,
  };
}

function accountSnapshot(account: Awaited<ReturnType<Connection["getAccountInfo"]>>) {
  return account
    ? {
        lamports: account.lamports,
        owner: account.owner.toBase58(),
      }
    : null;
}

async function tokenAmount(
  connection: Connection,
  address: PublicKey
): Promise<string | null> {
  return (
    await connection.getTokenAccountBalance(address, "confirmed").catch(() => null)
  )?.value.amount ?? null;
}

async function loadState(args: {
  connection: Connection;
  policyAccount?: PublicKey | null;
  vaultCollateralAta?: PublicKey | null;
  vaultPubkey: PublicKey;
  vaultUsdcAta: PublicKey;
  walletAddress: PublicKey;
  walletUsdcAta: PublicKey;
  yieldClient: Awaited<ReturnType<typeof import("../frontend/src/lib/yield-optimization/yield-neon-client.server.ts")["getYieldOptimizationClient"]>>;
  schema: typeof import("../frontend/src/lib/yield-optimization/yield-neon-client.server.ts");
}) {
  const {
    managedVaults,
    routePolicies,
    userYieldPositionDeposits,
    userYieldPositionHoldingEvents,
    userYieldPositionWithdrawals,
    userYieldPositions,
  } = args.schema;
  const settings = SETTINGS_PDA.toBase58();
  const wallet = args.walletAddress.toBase58();
  const [walletAccount, policyAccount, vaultUsdcAccount, vaultCollateralAccount] =
    await Promise.all([
      args.connection.getAccountInfo(args.walletAddress, "confirmed"),
      args.policyAccount
        ? args.connection.getAccountInfo(args.policyAccount, "confirmed")
        : null,
      args.connection.getAccountInfo(args.vaultUsdcAta, "confirmed"),
      args.vaultCollateralAta
        ? args.connection.getAccountInfo(args.vaultCollateralAta, "confirmed")
        : null,
    ]);
  const [
    walletUsdcRaw,
    vaultUsdcRaw,
    vaultCollateralRaw,
    position,
    routePolicy,
    managedVault,
    deposits,
    withdrawals,
  ] = await Promise.all([
    tokenAmount(args.connection, args.walletUsdcAta),
    tokenAmount(args.connection, args.vaultUsdcAta),
    args.vaultCollateralAta
      ? tokenAmount(args.connection, args.vaultCollateralAta)
      : null,
    args.yieldClient.db.query.userYieldPositions.findFirst({
      orderBy: [desc(userYieldPositions.id)],
      where: and(
        eq(userYieldPositions.settings, settings),
        eq(userYieldPositions.vaultIndex, 1),
        eq(userYieldPositions.initialReserve, EARN_TARGET.reserve.toBase58()),
        eq(userYieldPositions.walletAddress, wallet)
      ),
    }),
    args.yieldClient.db.query.routePolicies.findFirst({
      orderBy: [desc(routePolicies.id)],
      where: and(
        eq(routePolicies.settings, settings),
        eq(routePolicies.vaultIndex, 1),
        eq(routePolicies.authority, wallet)
      ),
    }),
    args.yieldClient.db.query.managedVaults.findFirst({
      orderBy: [desc(managedVaults.id)],
      where: and(
        eq(managedVaults.settings, settings),
        eq(managedVaults.vaultIndex, 1),
        eq(managedVaults.vaultPubkey, args.vaultPubkey.toBase58())
      ),
    }),
    args.yieldClient.db.query.userYieldPositionDeposits.findMany({
      limit: 3,
      orderBy: [desc(userYieldPositionDeposits.confirmedAt)],
      where: and(
        eq(userYieldPositionDeposits.settings, settings),
        eq(userYieldPositionDeposits.walletAddress, wallet)
      ),
    }),
    args.yieldClient.db.query.userYieldPositionWithdrawals.findMany({
      limit: 3,
      orderBy: [desc(userYieldPositionWithdrawals.confirmedAt)],
      where: and(
        eq(userYieldPositionWithdrawals.settings, settings),
        eq(userYieldPositionWithdrawals.walletAddress, wallet)
      ),
    }),
  ]);
  const holdingEvents = position
    ? await args.yieldClient.db.query.userYieldPositionHoldingEvents.findMany({
        limit: 5,
        orderBy: [desc(userYieldPositionHoldingEvents.observedAt)],
        where: eq(userYieldPositionHoldingEvents.positionId, position.id),
      })
    : [];

  return {
    accounts: {
      policy: accountSnapshot(policyAccount),
      vaultCollateralAta: accountSnapshot(vaultCollateralAccount),
      vaultUsdcAta: accountSnapshot(vaultUsdcAccount),
      wallet: accountSnapshot(walletAccount),
    },
    db: {
      deposits,
      holdingEvents,
      managedVault,
      position: compactPosition(position),
      routePolicy,
      withdrawals,
    },
    tokenBalances: {
      vaultCollateralRaw,
      vaultUsdcRaw,
      walletUsdcRaw,
    },
  };
}

function assertNoPositionActive(
  state: Awaited<ReturnType<typeof loadState>>,
  options: {
    allowActivePolicyRows?: boolean;
    allowActivePosition?: boolean;
  } = {}
) {
  const position = state.db.position as { status?: string } | null;
  if (position?.status === "active" && !options.allowActivePosition) {
    throw new Error("Expected no active Earn position.");
  }
  if (options.allowActivePolicyRows) {
    return;
  }
  const routePolicy = state.db.routePolicy as { active?: boolean } | null;
  if (routePolicy?.active) {
    throw new Error("Expected no active Earn route policy.");
  }
  const managedVault = state.db.managedVault as { active?: boolean } | null;
  if (managedVault?.active) {
    throw new Error("Expected no active Earn managed vault.");
  }
}

async function assertNoVerifierFailures(args: {
  settings: string;
  verifyUserYieldPositions: () => Promise<Array<{ settings: string }>>;
}) {
  const failures = (await args.verifyUserYieldPositions()).filter(
    (failure) => failure.settings === args.settings
  );
  if (failures.length > 0) {
    throw new Error(
      `Yield position verifier failures: ${JSON.stringify(failures, bigintJson)}`
    );
  }
  return failures;
}

function fullWithdrawCleanupCandidates(
  prepared: SmartAccountPreparedEarnUsdcWithdraw
): CleanupCandidateEvidence[] {
  const candidates: CleanupCandidateEvidence[] = [];
  if (prepared.persistence.vaultCollateralCleanupIncluded) {
    candidates.push({
      account: prepared.vault.collateralAta.toBase58(),
      action: "close",
      kind: "vault_kamino_collateral_ata",
    });
  } else {
    candidates.push({
      account: prepared.vault.collateralAta.toBase58(),
      action: "not_safely_closeable",
      kind: "vault_kamino_collateral_ata",
      reason:
        "Kamino collateral token account is not owned by the Earn vault PDA.",
    });
  }

  candidates.push(
    {
      account: prepared.vault.usdcAta.toBase58(),
      action: "close",
      kind: "earn_vault_usdc_ata",
    },
    {
      account: null,
      action: "not_safely_closeable",
      kind: "kamino_obligation_or_user_metadata",
      reason:
        "No validated Kamino close instruction/account relationship is available in the Earn withdraw bundle.",
    }
  );

  return [
    ...candidates,
  ];
}

async function main() {
  assertMainnet();
  assertVerifyPhase(VERIFY_PHASE);

  const walletKeypair = loadTestingKeypair();
  const policySigner = loadDeploymentPolicySigner();
  const wallet = createWalletAdapter(walletKeypair);
  const connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 90_000,
  });
  const client = createSmartAccountVaultsClient({
    connection,
    programId: PROGRAM_ID,
  });
  const repository = await import(
    "../frontend/src/lib/yield-optimization/yield-deposit-repository.server.ts"
  );
  const schema = await import(
    "../frontend/src/lib/yield-optimization/yield-neon-client.server.ts"
  );
  const yieldClient = schema.getYieldOptimizationClient();
  const vaultPubkey = pda.getSmartAccountPda({
    accountIndex: 1,
    programId: PROGRAM_ID,
    settingsPda: SETTINGS_PDA,
  })[0];
  const vaultUsdcAta = getAssociatedTokenAddressSync(
    EARN_TARGET.liquidityMint,
    vaultPubkey,
    true,
    TOKEN_PROGRAM_ID
  );
  const walletUsdcAta = getAssociatedTokenAddressSync(
    EARN_TARGET.liquidityMint,
    wallet.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  const evidence: {
    cluster: string;
    dryRun: boolean;
    env: string;
    evidencePath: string;
    phase: VerifyPhase;
    postState?: unknown;
    preState?: unknown;
    steps: Record<string, EvidenceStep>;
    verifierFailures: unknown[];
  } = {
    cluster: LoyalCluster.MainnetBeta,
    dryRun: DRY_RUN,
    env: SOLANA_ENV,
    evidencePath: EVIDENCE_PATH,
    phase: VERIFY_PHASE,
    steps: {},
    verifierFailures: [],
  };

  async function runFullWithdrawCleanup() {
    const activePosition = await repository.findActiveYieldPosition({
      cluster: LoyalCluster.MainnetBeta,
      initialReserve: EARN_TARGET.reserve.toBase58(),
      settings: SETTINGS_PDA.toBase58(),
      vaultIndex: 1,
      walletAddress: wallet.publicKey.toBase58(),
    });
    if (!activePosition) {
      throw new Error("full-withdraw-cleanup requires an active Earn position.");
    }
    if (activePosition.currentAmountRaw <= 0n) {
      throw new Error("Active Earn position has no current holding to withdraw.");
    }
    const activeRoutePolicy = await yieldClient.db.query.routePolicies.findFirst({
      orderBy: [desc(schema.routePolicies.id)],
      where: and(
        eq(schema.routePolicies.active, true),
        eq(schema.routePolicies.authority, wallet.publicKey.toBase58()),
        eq(schema.routePolicies.settings, SETTINGS_PDA.toBase58()),
        eq(schema.routePolicies.vaultIndex, 1)
      ),
    });
    if (!activeRoutePolicy) {
      throw new Error("full-withdraw-cleanup requires an active Earn policy.");
    }

    const prepared = await client.prepareEarnUsdcWithdraw({
      amountRaw: activePosition.currentAmountRaw,
      cluster: LoyalCluster.MainnetBeta,
      feePayer: wallet.publicKey,
      mode: "full",
      policySigner,
      settingsPda: SETTINGS_PDA,
      walletAddress: wallet.publicKey,
      yieldRoutingPolicy: {
        account: new PublicKey(activeRoutePolicy.policyAccount),
        seed: activeRoutePolicy.policySeed,
      },
    });
    const policyAccount = prepared.policy.account;
    const vaultCollateralAta = prepared.vault.collateralAta;
    const preState = await loadState({
      connection,
      policyAccount,
      schema,
      vaultCollateralAta,
      vaultPubkey,
      vaultUsdcAta,
      walletAddress: wallet.publicKey,
      walletUsdcAta,
      yieldClient,
    });
    evidence.preState = preState;
    await writeEvidence(evidence);

    if (DRY_RUN) {
      const postKaminoVaultUsdc =
        await simulatePreparedPrefixTokenBalance({
          connection,
          prepared: prepared.prepared,
          throughInstructionCount: 2,
          tokenAccount: vaultUsdcAta,
        });
      evidence.steps.fullWithdrawal = {
        amountRaw: activePosition.currentAmountRaw.toString(),
        cleanupCandidates: fullWithdrawCleanupCandidates(prepared),
        instructionCount: prepared.prepared.instructions.length,
        kaminoWithdrawAmountRaw:
          prepared.persistence.kaminoWithdrawAmountRaw ??
          activePosition.currentAmountRaw.toString(),
        persistence: prepared.persistence,
        postKaminoVaultUsdcRaw: postKaminoVaultUsdc.amountRaw,
        status: "skipped",
        unsignedSimulationLogs: postKaminoVaultUsdc.logs.slice(-12),
        vaultUsdcRemainderRaw:
          prepared.persistence.vaultUsdcRemainderRaw ??
          preState.tokenBalances.vaultUsdcRaw ??
          "0",
      };
      await writeEvidence(evidence);
      const unsignedSimulationLogs = await simulatePreparedUnsigned({
        connection,
        prepared: prepared.prepared,
      });
      evidence.steps.fullWithdrawal = {
        ...evidence.steps.fullWithdrawal,
        amountRaw: activePosition.currentAmountRaw.toString(),
        cleanupCandidates: fullWithdrawCleanupCandidates(prepared),
        instructionCount: prepared.prepared.instructions.length,
        kaminoWithdrawAmountRaw:
          prepared.persistence.kaminoWithdrawAmountRaw ??
          activePosition.currentAmountRaw.toString(),
        persistence: prepared.persistence,
        status: "skipped",
        unsignedSimulationLogs: unsignedSimulationLogs.slice(-12),
        vaultUsdcRemainderRaw:
          prepared.persistence.vaultUsdcRemainderRaw ??
          preState.tokenBalances.vaultUsdcRaw ??
          "0",
      };
      await writeEvidence(evidence);
      return;
    }

    const sent = await sendOrResumePrepared({
      connection,
      prepared: prepared.prepared,
      resumeSignature: RESUME_FULL_WITHDRAW_SIGNATURE,
      resumeSlot: RESUME_FULL_WITHDRAW_SLOT,
      wallet,
    });
    const position = await repository.recordConfirmedYieldWithdrawal(
      withdrawalInput({
        prepared,
        signature: sent.signature,
        slot: sent.slot,
      })
    );
    evidence.steps.fullWithdrawal = {
      amountRaw: activePosition.currentAmountRaw.toString(),
      cleanupCandidates: fullWithdrawCleanupCandidates(prepared),
      confirmedSlot: sent.slot.toString(),
      instructionCount: prepared.prepared.instructions.length,
      kaminoWithdrawAmountRaw:
        prepared.persistence.kaminoWithdrawAmountRaw ??
        activePosition.currentAmountRaw.toString(),
      persistence: { position: compactPosition(position) },
      signature: sent.signature,
      simulationLogs: sent.simulationLogs.slice(-12),
      status: "success",
      vaultUsdcRemainderRaw:
        prepared.persistence.vaultUsdcRemainderRaw ??
        preState.tokenBalances.vaultUsdcRaw ??
        "0",
    };

    const postState = await loadState({
      connection,
      policyAccount,
      schema,
      vaultCollateralAta,
      vaultPubkey,
      vaultUsdcAta,
      walletAddress: wallet.publicKey,
      walletUsdcAta,
      yieldClient,
    });
    evidence.postState = postState;

    const preWalletUsdc = BigInt(preState.tokenBalances.walletUsdcRaw ?? "0");
    const postWalletUsdc = BigInt(postState.tokenBalances.walletUsdcRaw ?? "0");
    const expectedWalletUsdcDelta = BigInt(
      prepared.persistence.walletTransferAmountRaw ??
        prepared.persistence.kaminoWithdrawAmountRaw ??
        activePosition.currentAmountRaw.toString()
    );
    if (postWalletUsdc - preWalletUsdc !== expectedWalletUsdcDelta) {
      throw new Error(
        "Wallet USDC delta did not match full withdrawal plus vault remainder."
      );
    }
    const collateralCleanupIncluded =
      prepared.persistence.vaultCollateralCleanupIncluded === true;
    const expectedRent =
      BigInt(preState.accounts.policy?.lamports ?? 0) +
      (collateralCleanupIncluded
        ? BigInt(preState.accounts.vaultCollateralAta?.lamports ?? 0)
        : BigInt(0)) +
      BigInt(preState.accounts.vaultUsdcAta?.lamports ?? 0);
    const preSol = BigInt(preState.accounts.wallet?.lamports ?? 0);
    const postSol = BigInt(postState.accounts.wallet?.lamports ?? 0);
    const transactionFee = await resolveTransactionFeeLamports({
      connection,
      signature: sent.signature,
    });
    evidence.steps.fullWithdrawal.transactionFeeLamports =
      transactionFee.toString();
    if (
      postSol +
        transactionFee +
        BigInt(RENT_REFUND_ROUNDING_ALLOWANCE_LAMPORTS) <
      preSol + expectedRent
    ) {
      throw new Error("Wallet SOL balance does not show expected rent refund.");
    }
    if (postState.accounts.policy) {
      throw new Error("Earn policy account still exists after full withdrawal.");
    }
    if (collateralCleanupIncluded && postState.accounts.vaultCollateralAta) {
      throw new Error("Vault Kamino collateral ATA still exists after cleanup.");
    }
    if (postState.accounts.vaultUsdcAta) {
      throw new Error("Earn vault USDC ATA still exists after cleanup.");
    }
    const postPosition = postState.db.position as
      | { currentAmountRaw?: bigint; principalAmountRaw?: bigint; status?: string }
      | null;
    if (
      postPosition?.status !== "closed" ||
      postPosition.principalAmountRaw !== 0n ||
      postPosition.currentAmountRaw !== 0n
    ) {
      throw new Error("Yield position was not closed to zero.");
    }
    assertNoPositionActive(postState);
    evidence.verifierFailures = await assertNoVerifierFailures({
      settings: SETTINGS_PDA.toBase58(),
      verifyUserYieldPositions: repository.verifyUserYieldPositions,
    });
    await writeEvidence(evidence);
  }

  async function runInitialDepositFromClean() {
    const preState = await loadState({
      connection,
      policyAccount: null,
      schema,
      vaultCollateralAta: null,
      vaultPubkey,
      vaultUsdcAta,
      walletAddress: wallet.publicKey,
      walletUsdcAta,
      yieldClient,
    });
    assertNoPositionActive(preState, {
      allowActivePosition: Boolean(RESUME_INITIAL_DEPOSIT_SIGNATURE),
      allowActivePolicyRows: Boolean(RESUME_INITIAL_POLICY_SIGNATURE),
    });
    evidence.preState = preState;
    await writeEvidence(evidence);

    let initialPolicy:
      | {
          account: PublicKey;
          persistence: SmartAccountPreparedEarnUsdcYieldRoutingPolicy["persistence"];
          seed: bigint;
          signature: string;
        }
      | null = null;

    if (RESUME_INITIAL_POLICY_SIGNATURE) {
      if (!RESUME_INITIAL_POLICY_ACCOUNT || !RESUME_INITIAL_POLICY_SEED) {
        throw new Error(
          "Resuming an initial policy requires EARN_INITIAL_POLICY_ACCOUNT and EARN_INITIAL_POLICY_SEED."
        );
      }
      const policyAccount = new PublicKey(RESUME_INITIAL_POLICY_ACCOUNT);
      const policySeed = BigInt(RESUME_INITIAL_POLICY_SEED);
      const policyAccountInfo = await connection.getAccountInfo(
        policyAccount,
        "confirmed"
      );
      if (!policyAccountInfo) {
        throw new Error(
          `Resumed policy account ${policyAccount.toBase58()} does not exist.`
        );
      }
      const sentPolicy = {
        signature: RESUME_INITIAL_POLICY_SIGNATURE,
        slot: RESUME_INITIAL_POLICY_SLOT
          ? BigInt(RESUME_INITIAL_POLICY_SLOT)
          : await resolveConfirmedSignatureSlot({
              connection,
              signature: RESUME_INITIAL_POLICY_SIGNATURE,
            }),
      };
      const persistence: SmartAccountPreparedEarnUsdcYieldRoutingPolicy["persistence"] =
        {
          cluster: LoyalCluster.MainnetBeta,
          walletAddress: wallet.publicKey.toBase58(),
          delegatedSigner: policySigner.toBase58(),
          settings: SETTINGS_PDA.toBase58(),
          vaultIndex: 1,
          vaultPubkey: vaultPubkey.toBase58(),
          policyId: policySeed.toString(),
          policyAccount: policyAccount.toBase58(),
          policySeed: policySeed.toString(),
          targetReserve: EARN_TARGET.reserve.toBase58(),
          market: EARN_TARGET.market.toBase58(),
          liquidityMint: EARN_TARGET.liquidityMint.toBase58(),
        };
      if (DRY_RUN) {
        evidence.steps.initialPolicy = {
          confirmedSlot: sentPolicy.slot.toString(),
          instructionCount: 0,
          persistence,
          signature: sentPolicy.signature,
          simulationLogs: [],
          status: "skipped",
        };
        await writeEvidence(evidence);
        return;
      }
      await repository.recordConfirmedYieldRoutePolicy(
        policyInputFromPersistence({
          persistence,
          signature: sentPolicy.signature,
          slot: sentPolicy.slot,
        })
      );
      initialPolicy = {
        account: policyAccount,
        persistence,
        seed: policySeed,
        signature: sentPolicy.signature,
      };
      evidence.steps.initialPolicy = {
        confirmedSlot: sentPolicy.slot.toString(),
        instructionCount: 0,
        persistence,
        signature: sentPolicy.signature,
        simulationLogs: [],
        status: "success",
      };
      await writeEvidence(evidence);
    } else {
      const preparedPolicy = await client.prepareEarnUsdcYieldRoutingPolicy({
        cluster: LoyalCluster.MainnetBeta,
        feePayer: wallet.publicKey,
        settingsPda: SETTINGS_PDA,
        signer: policySigner,
        walletAddress: wallet.publicKey,
      });
      if (DRY_RUN) {
        const unsignedPolicySimulationLogs = await simulatePreparedUnsigned({
          connection,
          prepared: preparedPolicy.prepared,
        });
        evidence.steps.initialPolicy = {
          instructionCount: preparedPolicy.prepared.instructions.length,
          persistence: preparedPolicy.persistence,
          status: "skipped",
          unsignedSimulationLogs: unsignedPolicySimulationLogs.slice(-12),
        };
        await writeEvidence(evidence);
        return;
      }

      const sentPolicy = await sendOrResumePrepared({
        connection,
        prepared: preparedPolicy.prepared,
        resumeSignature: null,
        resumeSlot: null,
        wallet,
      });
      await repository.recordConfirmedYieldRoutePolicy(
        policyInput({
          prepared: preparedPolicy,
          signature: sentPolicy.signature,
          slot: sentPolicy.slot,
        })
      );
      initialPolicy = {
        account: preparedPolicy.policy.account,
        persistence: preparedPolicy.persistence,
        seed: preparedPolicy.policy.seed,
        signature: sentPolicy.signature,
      };
      evidence.steps.initialPolicy = {
        confirmedSlot: sentPolicy.slot.toString(),
        instructionCount: preparedPolicy.prepared.instructions.length,
        persistence: preparedPolicy.persistence,
        signature: sentPolicy.signature,
        simulationLogs: sentPolicy.simulationLogs.slice(-12),
        status: "success",
      };
      await writeEvidence(evidence);
    }

    if (!initialPolicy) {
      throw new Error("Initial policy was not prepared or resumed.");
    }

    const prepared = await client.prepareEarnUsdcDeposit({
      amountRaw: FIRST_DEPOSIT_RAW,
      cluster: LoyalCluster.MainnetBeta,
      feePayer: wallet.publicKey,
      initializeYieldRoutingPolicy: false,
      policySigner,
      settingsPda: SETTINGS_PDA,
      walletAddress: wallet.publicKey,
      yieldRoutingPolicy: {
        account: initialPolicy.account,
        seed: initialPolicy.seed,
      },
    });

    const sent = await sendOrResumePrepared({
      connection,
      prepared: prepared.prepared,
      resumeSignature: RESUME_INITIAL_DEPOSIT_SIGNATURE,
      resumeSlot: RESUME_INITIAL_DEPOSIT_SLOT,
      wallet,
    });
    const kaminoDeposit = await loadKaminoDepositEvidence({
      connection,
      signature: sent.signature,
    });
    if (
      !kaminoDeposit.initObligationLogged &&
      kaminoDeposit.depositedLiquidityRaw !== FIRST_DEPOSIT_RAW.toString()
    ) {
      throw new Error("Initial deposit transaction did not show Kamino setup or deposit.");
    }
    const position = await repository.recordConfirmedYieldDeposit(
      depositInput({
        policyInitialization: "create",
        policySignature: initialPolicy.signature,
        prepared,
        signature: sent.signature,
        slot: sent.slot,
      })
    );
    evidence.steps.initialDeposit = {
      amountRaw: FIRST_DEPOSIT_RAW.toString(),
      confirmedSlot: sent.slot.toString(),
      instructionCount: prepared.prepared.instructions.length,
      kaminoDeposit,
      kaminoSetupAccountCount: prepared.kaminoSetupAccountCount,
      kaminoSetupRentLamports: prepared.kaminoSetupRentLamports,
      kaminoSetupRequired: prepared.kaminoSetupRequired,
      persistence: { position: compactPosition(position) },
      signature: sent.signature,
      simulationLogs: sent.simulationLogs.slice(-12),
      status: "success",
    };

    const postState = await loadState({
      connection,
      policyAccount: prepared.policy.account,
      schema,
      vaultCollateralAta:
        prepared.vault.collateralAta ??
        (kaminoDeposit.reserveCollateralSupplyAccount
          ? new PublicKey(kaminoDeposit.reserveCollateralSupplyAccount)
          : null),
      vaultPubkey,
      vaultUsdcAta,
      walletAddress: wallet.publicKey,
      walletUsdcAta,
      yieldClient,
    });
    evidence.postState = postState;
    const preWalletUsdc = BigInt(preState.tokenBalances.walletUsdcRaw ?? "0");
    const postWalletUsdc = BigInt(postState.tokenBalances.walletUsdcRaw ?? "0");
    if (
      !RESUME_INITIAL_DEPOSIT_SIGNATURE &&
      preWalletUsdc - postWalletUsdc !== FIRST_DEPOSIT_RAW
    ) {
      throw new Error("Wallet USDC delta did not match initial deposit amount.");
    }
    if (!postState.accounts.policy) {
      throw new Error("Earn policy account was not created.");
    }
    if (prepared.vault.collateralAta && !postState.accounts.vaultCollateralAta) {
      throw new Error("Vault Kamino collateral ATA was not created.");
    }
    if (
      !prepared.vault.collateralAta &&
      (!kaminoDeposit.initObligationLogged ||
        kaminoDeposit.depositedLiquidityRaw !== FIRST_DEPOSIT_RAW.toString())
    ) {
      throw new Error("Kamino deposit/setup evidence was not found.");
    }
    const postPosition = postState.db.position as
      | { currentAmountRaw?: bigint; principalAmountRaw?: bigint; status?: string }
      | null;
    if (
      postPosition?.status !== "active" ||
      postPosition.principalAmountRaw !== FIRST_DEPOSIT_RAW ||
      postPosition.currentAmountRaw !== FIRST_DEPOSIT_RAW
    ) {
      throw new Error("Initial deposit did not create the expected active position.");
    }
    const routePolicy = postState.db.routePolicy as { active?: boolean } | null;
    const managedVault = postState.db.managedVault as { active?: boolean } | null;
    if (!routePolicy?.active || !managedVault?.active) {
      throw new Error("Initial deposit did not activate policy/vault DB rows.");
    }
    evidence.verifierFailures = await assertNoVerifierFailures({
      settings: SETTINGS_PDA.toBase58(),
      verifyUserYieldPositions: repository.verifyUserYieldPositions,
    });
    await writeEvidence(evidence);
  }

  async function runTopUpPartialSmoke() {
    const activeRoutePolicy = await yieldClient.db.query.routePolicies.findFirst({
      orderBy: [desc(schema.routePolicies.id)],
      where: and(
        eq(schema.routePolicies.active, true),
        eq(schema.routePolicies.authority, wallet.publicKey.toBase58()),
        eq(schema.routePolicies.settings, SETTINGS_PDA.toBase58()),
        eq(schema.routePolicies.vaultIndex, 1)
      ),
    });
    if (!activeRoutePolicy) {
      throw new Error("top-up-partial-smoke requires an active Earn policy.");
    }
    const before = await repository.findActiveYieldPosition({
      cluster: LoyalCluster.MainnetBeta,
      initialReserve: EARN_TARGET.reserve.toBase58(),
      settings: SETTINGS_PDA.toBase58(),
      vaultIndex: 1,
      walletAddress: wallet.publicKey.toBase58(),
    });
    if (!before) {
      throw new Error("top-up-partial-smoke requires an active Earn position.");
    }

    const topUp = await client.prepareEarnUsdcDeposit({
      amountRaw: TOP_UP_DEPOSIT_RAW,
      cluster: LoyalCluster.MainnetBeta,
      feePayer: wallet.publicKey,
      initializeYieldRoutingPolicy: false,
      policySigner,
      settingsPda: SETTINGS_PDA,
      walletAddress: wallet.publicKey,
      yieldRoutingPolicy: {
        account: new PublicKey(activeRoutePolicy.policyAccount),
        seed: activeRoutePolicy.policySeed,
      },
    });
    if (DRY_RUN) {
      const unsignedSimulationLogs = await simulatePreparedUnsigned({
        connection,
        prepared: topUp.prepared,
      });
      evidence.steps.topUpDeposit = {
        amountRaw: TOP_UP_DEPOSIT_RAW.toString(),
        instructionCount: topUp.prepared.instructions.length,
        kaminoSetupAccountCount: topUp.kaminoSetupAccountCount,
        kaminoSetupRentLamports: topUp.kaminoSetupRentLamports,
        kaminoSetupRequired: topUp.kaminoSetupRequired,
        persistence: topUp.persistence,
        status: "skipped",
        unsignedSimulationLogs: unsignedSimulationLogs.slice(-12),
      };
      await writeEvidence(evidence);
      return;
    }

    const topUpSent = await sendOrResumePrepared({
      connection,
      prepared: topUp.prepared,
      resumeSignature: RESUME_TOP_UP_DEPOSIT_SIGNATURE,
      resumeSlot: RESUME_TOP_UP_DEPOSIT_SLOT,
      wallet,
    });
    await repository.recordConfirmedYieldDeposit(
      depositInput({
        policySignature: activeRoutePolicy.lastSeenSignature,
        prepared: topUp,
        signature: topUpSent.signature,
        slot: topUpSent.slot,
      })
    );
    evidence.steps.topUpDeposit = {
      amountRaw: TOP_UP_DEPOSIT_RAW.toString(),
      confirmedSlot: topUpSent.slot.toString(),
      instructionCount: topUp.prepared.instructions.length,
      signature: topUpSent.signature,
      simulationLogs: topUpSent.simulationLogs.slice(-12),
      status: "success",
    };

    const partial = await client.prepareEarnUsdcWithdraw({
      amountRaw: PARTIAL_WITHDRAW_RAW,
      cluster: LoyalCluster.MainnetBeta,
      feePayer: wallet.publicKey,
      mode: "partial",
      policySigner,
      settingsPda: SETTINGS_PDA,
      walletAddress: wallet.publicKey,
      yieldRoutingPolicy: {
        account: new PublicKey(activeRoutePolicy.policyAccount),
        seed: activeRoutePolicy.policySeed,
      },
    });
    const partialSent = await sendOrResumePrepared({
      connection,
      prepared: partial.prepared,
      resumeSignature: RESUME_PARTIAL_WITHDRAW_SIGNATURE,
      resumeSlot: RESUME_PARTIAL_WITHDRAW_SLOT,
      wallet,
    });
    const after = await repository.recordConfirmedYieldWithdrawal(
      withdrawalInput({
        prepared: partial,
        signature: partialSent.signature,
        slot: partialSent.slot,
      })
    );
    evidence.steps.partialWithdrawal = {
      amountRaw: PARTIAL_WITHDRAW_RAW.toString(),
      confirmedSlot: partialSent.slot.toString(),
      instructionCount: partial.prepared.instructions.length,
      persistence: { position: compactPosition(after) },
      signature: partialSent.signature,
      simulationLogs: partialSent.simulationLogs.slice(-12),
      status: "success",
    };
    const expected =
      before.principalAmountRaw + TOP_UP_DEPOSIT_RAW - PARTIAL_WITHDRAW_RAW;
    if (after.principalAmountRaw !== expected) {
      throw new Error(
        `Top-up/partial principal mismatch: expected ${expected}, got ${after.principalAmountRaw}`
      );
    }
    evidence.verifierFailures = await assertNoVerifierFailures({
      settings: SETTINGS_PDA.toBase58(),
      verifyUserYieldPositions: repository.verifyUserYieldPositions,
    });
    await writeEvidence(evidence);
  }

  if (VERIFY_PHASE === "full-withdraw-cleanup" || VERIFY_PHASE === "all") {
    await runFullWithdrawCleanup();
  }
  if (VERIFY_PHASE === "initial-deposit-from-clean" || VERIFY_PHASE === "all") {
    await runInitialDepositFromClean();
  }
  if (VERIFY_PHASE === "top-up-partial-smoke" || VERIFY_PHASE === "all") {
    await runTopUpPartialSmoke();
  }

  console.log("[earn-mainnet] PASS");
  console.log(JSON.stringify(evidence, bigintJson, 2));
}

main().catch((error) => {
  console.error("[earn-mainnet] FAIL", error);
  throw error;
});
