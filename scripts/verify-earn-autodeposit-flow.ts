import { mock } from "bun:test";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  LoyalCluster,
  SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET,
} from "../packages/loyal-actions/src/index.ts";
import {
  createSmartAccountVaultsClient,
  sendPreparedWithWallet,
  type WalletAdapterLike,
} from "../packages/smart-account-vaults/src/index.ts";
import type {
  SmartAccountPreparedEarnUsdcAutodepositClose,
  SmartAccountPreparedEarnUsdcAutodepositPull,
  SmartAccountPreparedEarnUsdcAutodepositSetup,
} from "../packages/smart-account-vaults/src/types.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";
import { compilePreparedOperation } from "../sdk/loyal-smart-accounts-core/src/index.ts";
import { PROGRAM_ADDRESS } from "../sdk/loyal-smart-accounts/src/index.ts";

mock.module("server-only", () => ({}));

type EvidenceStep = {
  accounts?: Record<string, unknown>;
  error?: string;
  instructionCount?: number;
  persistence?: unknown;
  signature?: string;
  simulationLogs?: string[];
  status: "failed" | "skipped" | "success";
};

const SOLANA_ENV = resolveSolanaEnv(
  process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV ?? "mainnet"
);
const DRY_RUN = process.env.AUTODEPOSIT_VERIFY_DRY_RUN !== "0";
const SKIP_PULL = process.env.AUTODEPOSIT_SKIP_PULL === "1";
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
const AMOUNT_RAW = parseRawAmount(
  process.env.AUTODEPOSIT_AMOUNT_RAW ?? "10000"
);
const PULL_AMOUNT_RAW = parseRawAmount(
  process.env.AUTODEPOSIT_PULL_AMOUNT_RAW ?? AMOUNT_RAW.toString()
);
const NONCE = parseRawAmount(
  process.env.AUTODEPOSIT_NONCE ?? BigInt(Date.now()).toString()
);
function parseRawAmount(value: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`Invalid positive raw amount: ${value}`);
  }
  return BigInt(value);
}

function loadKeypair(envName: string): Keypair {
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(`${envName} is not set.`);
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

function keypairWallet(keypair: Keypair): WalletAdapterLike {
  return {
    publicKey: keypair.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      transaction: T
    ) {
      transaction.sign([keypair]);
      return transaction;
    },
  };
}

async function simulatePrepared(args: {
  connection: Connection;
  prepared:
    | SmartAccountPreparedEarnUsdcAutodepositClose["prepared"]
    | SmartAccountPreparedEarnUsdcAutodepositPull["prepared"]
    | SmartAccountPreparedEarnUsdcAutodepositSetup["prepared"];
  signers: Keypair[];
}): Promise<string[]> {
  const latestBlockhash = await args.connection.getLatestBlockhash("confirmed");
  const transaction = compilePreparedOperation({
    prepared: args.prepared,
    blockhash: latestBlockhash.blockhash,
  });
  transaction.sign(args.signers);
  const simulation = await args.connection.simulateTransaction(transaction, {
    commitment: "confirmed",
    sigVerify: false,
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

async function sendPrepared(args: {
  connection: Connection;
  prepared:
    | SmartAccountPreparedEarnUsdcAutodepositClose["prepared"]
    | SmartAccountPreparedEarnUsdcAutodepositPull["prepared"]
    | SmartAccountPreparedEarnUsdcAutodepositSetup["prepared"];
  wallet: WalletAdapterLike;
}): Promise<string> {
  return sendPreparedWithWallet({
    confirm: true,
    connection: args.connection,
    prepared: args.prepared,
    wallet: args.wallet,
  });
}

async function accountStatus(connection: Connection, pubkey: string | null) {
  if (!pubkey) {
    return null;
  }
  const account = await connection.getAccountInfo(new PublicKey(pubkey));
  return account
    ? {
        exists: true,
        lamports: account.lamports,
        owner: account.owner.toBase58(),
      }
    : { exists: false };
}

async function waitForAccountStatus(args: {
  connection: Connection;
  pubkey: string | null;
  exists: boolean;
  attempts?: number;
  delayMs?: number;
}) {
  const attempts = args.attempts ?? 10;
  const delayMs = args.delayMs ?? 500;
  let latest = await accountStatus(args.connection, args.pubkey);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (Boolean(latest?.exists) === args.exists) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    latest = await accountStatus(args.connection, args.pubkey);
  }
  return latest;
}

async function recurringDelegationParameters(
  connection: Connection,
  pubkey: PublicKey
) {
  const account = await connection.getAccountInfo(pubkey, "confirmed");
  if (!account) {
    return null;
  }
  const data = account.data;
  return {
    delegator: new PublicKey(
      data.subarray(
        Number(SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET),
        Number(SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET) + 32
      )
    ).toBase58(),
    delegatee: new PublicKey(
      data.subarray(
        Number(SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET),
        Number(SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET) + 32
      )
    ).toBase58(),
    authority: new PublicKey(
      data.subarray(
        Number(SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET),
        Number(SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET) + 32
      )
    ).toBase58(),
    mint: new PublicKey(
      data.subarray(
        Number(SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET),
        Number(SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET) + 32
      )
    ).toBase58(),
    amountPerPeriodRaw: data
      .readBigUInt64LE(
        Number(SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET)
      )
      .toString(),
  };
}

async function balanceSnapshot(connection: Connection, owner: PublicKey) {
  const lamports = await connection.getBalance(owner, "confirmed");
  return {
    lamports,
    sol: lamports / 1_000_000_000,
  };
}

function assertLiveAccountExists(
  label: string,
  status: Awaited<ReturnType<typeof accountStatus>>
) {
  if (!status || !status.exists) {
    throw new Error(`Expected ${label} to exist after live setup.`);
  }
}

function assertLiveAccountClosed(
  label: string,
  status: Awaited<ReturnType<typeof accountStatus>>
) {
  if (status?.exists) {
    throw new Error(`Expected ${label} to be closed after live teardown.`);
  }
}

async function simulatePreparedEvidence(args: {
  connection: Connection;
  prepared:
    | SmartAccountPreparedEarnUsdcAutodepositClose["prepared"]
    | SmartAccountPreparedEarnUsdcAutodepositPull["prepared"]
    | SmartAccountPreparedEarnUsdcAutodepositSetup["prepared"];
  signers: Keypair[];
}): Promise<Pick<EvidenceStep, "error" | "simulationLogs" | "status">> {
  try {
    return {
      status: "success",
      simulationLogs: await simulatePrepared(args),
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const user = loadKeypair("SOLANA_TESTING_PK");
  const deploymentPolicySigner = loadKeypair("DEPLOYMENT_PK");
  const automation = DRY_RUN
    ? { publicKey: deploymentPolicySigner.publicKey }
    : deploymentPolicySigner;
  const automationPublicKey = automation.publicKey;
  const client = createSmartAccountVaultsClient({
    connection,
    programId: PROGRAM_ID,
  });
  const cluster =
    SOLANA_ENV === "devnet" ? LoyalCluster.Devnet : LoyalCluster.MainnetBeta;
  const evidence: Record<string, EvidenceStep> = {};
  evidence.preFlowBalance = {
    status: "success",
    accounts: {
      wallet: user.publicKey.toBase58(),
      ...(await balanceSnapshot(connection, user.publicKey)),
    },
  };

  let setup = await client.prepareEarnUsdcAutodepositSetup({
    settingsPda: SETTINGS_PDA,
    walletAddress: user.publicKey,
    feePayer: user.publicKey,
    signer: user.publicKey,
    policySigner: automationPublicKey,
    amountRaw: AMOUNT_RAW,
    nonce: NONCE,
    cluster,
  });

  evidence.setup = {
    status: "success",
    instructionCount: setup.prepared.instructions.length,
    persistence: setup.persistence,
  };

  let policySeed = setup.policy.seed;

  while (setup.stage !== "create_recurring_delegation") {
    const stage = setup.stage;
    const evidenceKey =
      stage === "initialize_subscription_authority"
        ? "initializeAuthority"
        : "createPolicy";
    evidence[evidenceKey] = DRY_RUN
      ? {
          instructionCount: setup.prepared.instructions.length,
          ...(await simulatePreparedEvidence({
            connection,
            prepared: setup.prepared,
            signers: [user],
          })),
        }
      : {
          status: "success",
          signature: await sendPrepared({
            connection,
            prepared: setup.prepared,
            wallet: keypairWallet(user),
          }),
        };

    if (DRY_RUN) {
      evidence.pull = {
        status: "skipped",
        error: `Dry-run stopped after ${stage} preview; run live for the mutating full flow.`,
      };
      console.log(JSON.stringify(evidence, null, 2));
      return;
    }

    policySeed = setup.policy.seed ?? policySeed;
    setup = await client.prepareEarnUsdcAutodepositSetup({
      settingsPda: SETTINGS_PDA,
      walletAddress: user.publicKey,
      feePayer: user.publicKey,
      signer: user.publicKey,
      policySigner: automationPublicKey,
      amountRaw: AMOUNT_RAW,
      nonce: NONCE,
      policySeed: policySeed ?? undefined,
      cluster,
    });
  }

  if (setup.stage !== "create_recurring_delegation") {
    evidence.pull = {
      status: "skipped",
      error: "Setup did not reach create_recurring_delegation stage.",
    };
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }

  evidence.createRecurringDelegation = DRY_RUN
    ? {
        instructionCount: setup.prepared.instructions.length,
        ...(await simulatePreparedEvidence({
          connection,
          prepared: setup.prepared,
          signers: [user],
        })),
        persistence: setup.persistence,
      }
    : {
        status: "success",
        signature: await sendPrepared({
          connection,
          prepared: setup.prepared,
          wallet: keypairWallet(user),
        }),
        persistence: setup.persistence,
      };

  if (DRY_RUN) {
    evidence.pull = {
      status: "skipped",
      error:
        "Dry-run stopped after recurring delegation preview; run live for pull and teardown.",
    };
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }

  const postSetupPolicy = await waitForAccountStatus({
    connection,
    pubkey: setup.persistence.policyAccount,
    exists: true,
  });
  const postSetupRecurringDelegation = await waitForAccountStatus({
    connection,
    pubkey: setup.persistence.recurringDelegation,
    exists: true,
  });
  const postSetupSubscriptionAuthority = await waitForAccountStatus({
    connection,
    pubkey: setup.persistence.subscriptionAuthority,
    exists: true,
  });

  if (!DRY_RUN) {
    assertLiveAccountExists("policy", postSetupPolicy);
    assertLiveAccountExists(
      "recurring delegation",
      postSetupRecurringDelegation
    );
    assertLiveAccountExists(
      "subscription authority",
      postSetupSubscriptionAuthority
    );
  }

  evidence.postSetupAccounts = {
    status: "success",
    accounts: {
      policy: postSetupPolicy,
      recurringDelegation: postSetupRecurringDelegation,
      subscriptionAuthority: postSetupSubscriptionAuthority,
      recurringDelegationParameters: await recurringDelegationParameters(
        connection,
        setup.subscription.recurringDelegation
      ),
    },
  };
  evidence.postSetupBalance = {
    status: "success",
    accounts: {
      wallet: user.publicKey.toBase58(),
      ...(await balanceSnapshot(connection, user.publicKey)),
    },
  };

  if (SKIP_PULL) {
    evidence.pull = {
      status: "skipped",
      error:
        "AUTODEPOSIT_SKIP_PULL=1; continuing to close/refund verification.",
    };
  } else {
    const pull = await client.prepareEarnUsdcAutodepositPull({
      policy: setup.policy.account!,
      walletAddress: user.publicKey,
      feePayer: user.publicKey,
      policySigner: automationPublicKey,
      recurringDelegation: setup.subscription.recurringDelegation,
      amountRaw: PULL_AMOUNT_RAW,
      cluster,
    });
    evidence.pull = DRY_RUN
      ? {
          status: "success",
          instructionCount: pull.prepared.instructions.length,
          persistence: pull.persistence,
        }
      : {
          status: "success",
          signature: await sendPrepared({
            connection,
            prepared: pull.prepared,
            wallet: keypairWallet(automation as Keypair),
          }),
          persistence: pull.persistence,
        };
  }

  const close = await client.prepareEarnUsdcAutodepositClose({
    settingsPda: SETTINGS_PDA,
    walletAddress: user.publicKey,
    feePayer: user.publicKey,
    signer: user.publicKey,
    policySigner: automationPublicKey,
    policy: setup.policy.account!,
    recurringDelegation: setup.subscription.recurringDelegation,
    cluster,
  });
  evidence.close = DRY_RUN
    ? {
        status: "success",
        instructionCount: close.prepared.instructions.length,
        persistence: close.persistence,
      }
    : {
        status: "success",
        signature: await sendPrepared({
          connection,
          prepared: close.prepared,
          wallet: keypairWallet(user),
        }),
        persistence: close.persistence,
      };

  const postClosePolicy = await waitForAccountStatus({
    connection,
    pubkey: setup.persistence.policyAccount,
    exists: false,
  });
  const postCloseRecurringDelegation = await waitForAccountStatus({
    connection,
    pubkey: setup.persistence.recurringDelegation,
    exists: false,
  });

  if (!DRY_RUN) {
    assertLiveAccountClosed("policy", postClosePolicy);
    assertLiveAccountClosed(
      "recurring delegation",
      postCloseRecurringDelegation
    );
  }

  evidence.postCloseAccounts = {
    status: "success",
    accounts: {
      policy: postClosePolicy,
      recurringDelegation: postCloseRecurringDelegation,
    },
  };
  evidence.postCloseBalance = {
    status: "success",
    accounts: {
      wallet: user.publicKey.toBase58(),
      ...(await balanceSnapshot(connection, user.publicKey)),
    },
  };

  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
