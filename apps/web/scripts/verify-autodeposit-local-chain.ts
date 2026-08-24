import { createHmac } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import {
  codecs,
  createLoyalSmartAccountsClient,
  pda,
  PROGRAM_ID,
  smartAccounts,
} from "@loyal-labs/loyal-smart-accounts";
import { LoyalCluster } from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import bs58 from "bs58";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { resolveEarnRealtimeRefreshPlan } from "../src/features/earn-realtime/invalidation";
import {
  consumeEarnRealtimeStream,
  type EarnRealtimeTokenResponse,
} from "../src/features/earn-realtime/stream";
import { EARN_REALTIME_EVENT_TYPES } from "../src/features/earn-realtime/types";
import {
  resolveEarnAutodepositTogglePresentation,
  sendEarnAutodepositSetupBatch,
} from "../src/lib/yield-optimization/earn-autodeposit-client-flow";
import { earnAutodepositConfigFromLoadedState } from "../src/lib/yield-optimization/earn-autodeposit-loaded-state.shared";

type SetupStage =
  | "approve_token_delegate"
  | "close_autodeposit"
  | "create_policy"
  | "create_recurring_delegation"
  | "initialize_subscription_authority";

type LocalState = {
  delegatedSigner: string;
  policyAccount: string;
  policySeed: string;
  recurringDelegation: string;
  settingsPda: string;
  subscriptionAuthority: string;
  vaultPubkey: string;
  vaultUsdcAta: string;
  walletAddress: string;
  walletBalanceFloorRaw: string;
  walletUsdcAta: string;
};

type RecordedTransaction = {
  signature: string;
  stage: SetupStage;
};

async function verifyAcceptedButMissingSubmission(args: {
  connection: Connection;
  prepared: Parameters<typeof sendEarnAutodepositSetupBatch>[0]["prepared"];
  wallet: Keypair;
}): Promise<void> {
  const originalConfirmTransaction = args.connection.confirmTransaction;
  const originalSendRawTransaction = args.connection.sendRawTransaction;
  const originalSimulateTransaction = args.connection.simulateTransaction;
  let droppedSignature: string | null = null;
  let simulationObserved = false;

  args.connection.sendRawTransaction = async (rawTransaction) => {
    const signedTransaction = VersionedTransaction.deserialize(
      new Uint8Array(rawTransaction)
    );
    const payerSignature = signedTransaction.signatures[0];
    if (!payerSignature || payerSignature.every((byte) => byte === 0)) {
      throw new Error("Verifier received an unsigned raw transaction.");
    }
    droppedSignature = bs58.encode(payerSignature);
    return droppedSignature;
  };
  args.connection.confirmTransaction = (async () => {
    throw new Error("block height exceeded before the signature appeared");
  }) as Connection["confirmTransaction"];
  args.connection.simulateTransaction = ((...callArgs: unknown[]) => {
    simulationObserved = true;
    return Reflect.apply(
      originalSimulateTransaction,
      args.connection,
      callArgs
    );
  }) as Connection["simulateTransaction"];

  let reportedMissingSubmission = false;
  try {
    await sendEarnAutodepositSetupBatch({
      connection: args.connection,
      prepared: args.prepared,
      wallet: {
        publicKey: args.wallet.publicKey,
        signAllTransactions: async <
          T extends Transaction | VersionedTransaction
        >(
          unsignedTransactions: T[]
        ) => {
          for (const transaction of unsignedTransactions) {
            if (transaction instanceof Transaction) {
              transaction.partialSign(args.wallet);
            } else {
              transaction.sign([args.wallet]);
            }
          }
          return unsignedTransactions;
        },
        signTransaction: async <T extends Transaction | VersionedTransaction>(
          transaction: T
        ) => {
          if (transaction instanceof Transaction) {
            transaction.partialSign(args.wallet);
          } else {
            transaction.sign([args.wallet]);
          }
          return transaction;
        },
      },
    });
  } catch (error) {
    reportedMissingSubmission =
      error instanceof Error &&
      error.message.includes("confirmation is unresolved");
  } finally {
    args.connection.confirmTransaction = originalConfirmTransaction;
    args.connection.sendRawTransaction = originalSendRawTransaction;
    args.connection.simulateTransaction = originalSimulateTransaction;
  }

  if (!droppedSignature) {
    throw new Error("Verifier did not capture the accepted transaction.");
  }
  const status = (
    await args.connection.getSignatureStatuses([droppedSignature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  if (status) {
    throw new Error(
      "Verifier's dropped transaction unexpectedly reached chain."
    );
  }
  if (!simulationObserved) {
    throw new Error(
      "Missing Autodeposit transaction was not simulated before reporting failure."
    );
  }
  if (!reportedMissingSubmission) {
    throw new Error(
      "Missing Autodeposit transaction did not surface an unresolved confirmation error."
    );
  }
}

type Args = {
  authSecret?: string;
  closeOutput?: string;
  closeReady?: string;
  eventsUrl?: string;
  expectedReason?: string;
  expectedUiState?: "created" | "deleted";
  output: string;
  pendingFloorReady?: string;
  postgresUrl?: string;
  rpcUrl?: string;
  state?: string;
  treasury?: string;
};

function parseArgs(argv: string[]): { command: string; args: Args } {
  const [command, ...rest] = argv;
  if (!command || !["listen", "setup"].includes(command)) {
    throw new Error("Expected setup or listen command.");
  }
  const values: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!(key?.startsWith("--") && value)) {
      throw new Error(`Invalid argument near ${key ?? "end of command"}.`);
    }
    values[key.slice(2)] = value;
  }
  if (!values.output) {
    throw new Error("--output is required.");
  }
  return {
    command,
    args: {
      authSecret: values["auth-secret"],
      closeOutput: values["close-output"],
      closeReady: values["close-ready"],
      eventsUrl: values["events-url"],
      expectedReason: values["expected-reason"],
      expectedUiState: values["expected-ui-state"] as
        | "created"
        | "deleted"
        | undefined,
      output: values.output,
      pendingFloorReady: values["pending-floor-ready"],
      postgresUrl: values["postgres-url"],
      rpcUrl: values["rpc-url"],
      state: values.state,
      treasury: values.treasury,
    },
  };
}

async function waitForFinalized(
  connection: Connection,
  signature: string
): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const status = (
      await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (status?.err) {
      throw new Error(
        `Transaction ${signature} failed: ${JSON.stringify(status.err)}`
      );
    }
    if (status?.confirmationStatus === "finalized") {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Transaction ${signature} did not finalize.`);
}

async function writeChainTransactions(args: {
  connection: Connection;
  output: string;
  transactions: RecordedTransaction[];
}) {
  const records = [];
  for (const transaction of args.transactions) {
    await waitForFinalized(args.connection, transaction.signature);
    const response = await args.connection.getTransaction(
      transaction.signature,
      {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      }
    );
    if (!response) {
      throw new Error(
        `Finalized transaction ${transaction.signature} was not found.`
      );
    }
    if (response.meta?.err) {
      throw new Error(
        `Finalized transaction ${
          transaction.signature
        } failed: ${JSON.stringify(response.meta.err)}`
      );
    }
    const message = response.transaction.message;
    if (message.addressTableLookups.length !== 0) {
      throw new Error(
        "Local Autodeposit transaction unexpectedly used an ALT."
      );
    }
    const decompiled = TransactionMessage.decompile(message);
    records.push({
      instructions: decompiled.instructions.map((instruction) => ({
        accounts: instruction.keys.map((account) => ({
          isSigner: account.isSigner,
          isWritable: account.isWritable,
          pubkey: account.pubkey.toBase58(),
        })),
        data: Buffer.from(instruction.data).toString("base64"),
        programId: instruction.programId.toBase58(),
      })),
      signature: transaction.signature,
      slot: response.slot,
      stage: transaction.stage,
    });
  }
  await writeFile(
    args.output,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
  );
}

async function createLocalSmartAccount(
  connection: Connection,
  treasury: PublicKey
) {
  const wallet = Keypair.generate();
  const delegatedSigner = Keypair.generate();
  const airdrop = await connection.requestAirdrop(
    wallet.publicKey,
    20 * LAMPORTS_PER_SOL
  );
  await waitForFinalized(connection, airdrop);

  const client = createLoyalSmartAccountsClient({
    connection,
    defaultCommitment: "confirmed",
    programId: PROGRAM_ID,
  });
  const [programConfigPda] = pda.getProgramConfigPda({ programId: PROGRAM_ID });
  if (!(await connection.getAccountInfo(programConfigPda, "finalized"))) {
    throw new Error(
      "Local validator is missing the Squads ProgramConfig genesis account."
    );
  }
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
    signers: [
      {
        key: wallet.publicKey,
        permissions: codecs.Permissions.all(),
      },
    ],
    threshold: 1,
    timeLock: 0,
    treasury,
  });
  await client.send(prepared, { confirm: true, signers: [wallet] });
  return { delegatedSigner, settingsPda, wallet };
}

async function setup(args: Args) {
  if (!(args.rpcUrl && args.treasury)) {
    throw new Error("setup requires --rpc-url and --treasury.");
  }
  if (Boolean(args.closeReady) !== Boolean(args.closeOutput)) {
    throw new Error("setup requires both --close-ready and --close-output.");
  }
  const connection = new Connection(args.rpcUrl, "confirmed");
  const { delegatedSigner, settingsPda, wallet } =
    await createLocalSmartAccount(connection, new PublicKey(args.treasury));
  const vaults = createSmartAccountVaultsClient({
    connection,
    programId: PROGRAM_ID,
  });
  const usdcMint = new PublicKey(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  );
  const walletUsdcAta = getAssociatedTokenAddressSync(
    usdcMint,
    wallet.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        wallet.publicKey,
        walletUsdcAta,
        wallet.publicKey,
        usdcMint,
        TOKEN_PROGRAM_ID
      )
    ),
    [wallet],
    { commitment: "finalized" }
  );

  const transactions: RecordedTransaction[] = [];
  const walletBalanceFloorRaw = BigInt(2_000_000);
  const nonce = BigInt(42);
  let policySeed: bigint | undefined;
  let completedState: LocalState | null = null;
  let interruptedAfterPolicy = false;
  let missingSubmissionVerified = false;
  for (let round = 0; round < 4; round += 1) {
    const stages = await vaults.prepareEarnUsdcAutodepositSetupBatch({
      amountRaw: BigInt(1_000_000),
      cluster: LoyalCluster.MainnetBeta,
      expiryTimestamp: BigInt(0),
      feePayer: wallet.publicKey,
      minimumDelegatorBalanceRaw: walletBalanceFloorRaw,
      nonce,
      periodLengthSeconds: BigInt(3600),
      policySeed,
      policySigner: delegatedSigner.publicKey,
      settingsPda,
      signer: wallet.publicKey,
      walletAddress: wallet.publicKey,
    });
    if (stages.length === 0) {
      throw new Error("Web Autodeposit setup prepared no stages.");
    }
    if (
      interruptedAfterPolicy &&
      stages.some((stage) => stage.stage === "create_policy")
    ) {
      throw new Error(
        "Partial Autodeposit retry prepared a duplicate policy before projection caught up."
      );
    }

    const policyOnlyStage = !interruptedAfterPolicy
      ? stages.find((stage) => stage.stage === "create_policy")
      : undefined;
    const stagesToSend = policyOnlyStage ? [policyOnlyStage] : stages;
    const stageByPrepared = new Map(
      stagesToSend.map((stage) => [stage.prepared, stage] as const)
    );
    if (!missingSubmissionVerified) {
      await verifyAcceptedButMissingSubmission({
        connection,
        prepared: stagesToSend.map((stage) => stage.prepared),
        wallet,
      });
      missingSubmissionVerified = true;
    }
    await sendEarnAutodepositSetupBatch({
      connection,
      onTransactionConfirmed: ({ prepared, signature }) => {
        const stage = stageByPrepared.get(prepared);
        if (!stage) {
          throw new Error("Confirmed an unknown Autodeposit setup stage.");
        }
        transactions.push({
          signature,
          stage: stage.stage as SetupStage,
        });
      },
      prepared: stagesToSend.map((stage) => stage.prepared),
      wallet: {
        publicKey: wallet.publicKey,
        signAllTransactions: async <
          T extends Transaction | VersionedTransaction
        >(
          unsignedTransactions: T[]
        ) => {
          for (const transaction of unsignedTransactions) {
            if (transaction instanceof Transaction) {
              transaction.partialSign(wallet);
            } else {
              transaction.sign([wallet]);
            }
          }
          return unsignedTransactions;
        },
        signTransaction: async <T extends Transaction | VersionedTransaction>(
          transaction: T
        ) => {
          if (transaction instanceof Transaction) {
            transaction.partialSign(wallet);
          } else {
            transaction.sign([wallet]);
          }
          return transaction;
        },
      },
    });

    for (const stage of stagesToSend) {
      const setupStage = stage.stage as SetupStage;
      if (setupStage !== "initialize_subscription_authority") {
        const nextPolicySeed =
          stage.policy.seed ?? stage.persistence.policySeed;
        if (nextPolicySeed === null) {
          throw new Error(`Autodeposit ${setupStage} omitted the policy seed.`);
        }
        policySeed = BigInt(nextPolicySeed);
      }
      if (
        setupStage === "create_recurring_delegation" ||
        setupStage === "approve_token_delegate"
      ) {
        const { policyAccount, policySeed: persistedPolicySeed } =
          stage.persistence;
        if (policyAccount === null || persistedPolicySeed === null) {
          throw new Error(
            `Autodeposit ${setupStage} omitted persisted policy identity.`
          );
        }
        completedState = {
          delegatedSigner: delegatedSigner.publicKey.toBase58(),
          policyAccount,
          policySeed: persistedPolicySeed,
          recurringDelegation: stage.persistence.recurringDelegation,
          settingsPda: settingsPda.toBase58(),
          subscriptionAuthority: stage.persistence.subscriptionAuthority,
          vaultPubkey: stage.persistence.vaultPubkey,
          vaultUsdcAta: stage.persistence.vaultUsdcAta,
          walletAddress: wallet.publicKey.toBase58(),
          walletBalanceFloorRaw: walletBalanceFloorRaw.toString(),
          walletUsdcAta: stage.persistence.walletUsdcAta,
        };
      }
    }
    if (policyOnlyStage) {
      interruptedAfterPolicy = true;
      const partialSetupToggle =
        resolveEarnAutodepositTogglePresentation("creating");
      if (
        partialSetupToggle.disabled ||
        partialSetupToggle.isOn ||
        partialSetupToggle.isPending ||
        partialSetupToggle.label !== "Finish setup" ||
        !partialSetupToggle.opensSetup
      ) {
        throw new Error(
          "Partial Autodeposit setup is not recoverable from the web toggle."
        );
      }
      continue;
    }
    if (completedState) {
      break;
    }
  }
  if (!completedState) {
    throw new Error("Web Autodeposit setup did not reach delegation creation.");
  }
  if (!interruptedAfterPolicy) {
    throw new Error("Web verifier did not exercise partial setup recovery.");
  }
  const completedSetupToggle =
    resolveEarnAutodepositTogglePresentation("created");
  if (
    completedSetupToggle.disabled ||
    !completedSetupToggle.isOn ||
    completedSetupToggle.isPending ||
    completedSetupToggle.label !== null ||
    completedSetupToggle.opensSetup
  ) {
    throw new Error("Completed Autodeposit setup does not render as active.");
  }
  const stageSequence = transactions.map((transaction) => transaction.stage);
  const expectedStages = [
    "initialize_subscription_authority",
    "create_policy",
    "create_recurring_delegation",
  ];
  if (JSON.stringify(stageSequence) !== JSON.stringify(expectedStages)) {
    throw new Error(
      `Unexpected Autodeposit setup stages: ${stageSequence.join(", ")}`
    );
  }

  for (const transaction of transactions) {
    await waitForFinalized(connection, transaction.signature);
  }

  const tokenAccount = await getAccount(
    connection,
    new PublicKey(completedState.walletUsdcAta),
    "finalized",
    TOKEN_PROGRAM_ID
  );
  if (
    tokenAccount.delegate?.toBase58() !==
      completedState.subscriptionAuthority ||
    tokenAccount.delegatedAmount < BigInt(1_000_000)
  ) {
    throw new Error(
      "Autodeposit setup did not install the wallet ATA delegate."
    );
  }
  for (const address of [
    completedState.policyAccount,
    completedState.recurringDelegation,
    completedState.subscriptionAuthority,
    completedState.vaultUsdcAta,
  ]) {
    if (
      !(await connection.getAccountInfo(new PublicKey(address), "finalized"))
    ) {
      throw new Error(`Autodeposit setup account ${address} is missing.`);
    }
  }
  await writeFile(args.output, JSON.stringify(completedState, null, 2));
  await writeChainTransactions({
    connection,
    output: `${args.output}.transactions.ndjson`,
    transactions,
  });
  if (args.closeReady && args.closeOutput) {
    let closeRequested = false;
    for (let attempt = 0; attempt < 1200; attempt += 1) {
      try {
        await access(args.closeReady);
        closeRequested = true;
        break;
      } catch {
        await Bun.sleep(100);
      }
    }
    if (!closeRequested) {
      throw new Error("Local verifier did not request Autodeposit close.");
    }
    const preparedClose = await vaults.prepareEarnUsdcAutodepositClose({
      cluster: LoyalCluster.MainnetBeta,
      feePayer: wallet.publicKey,
      policy: new PublicKey(completedState.policyAccount),
      policySigner: delegatedSigner.publicKey,
      recurringDelegation: new PublicKey(completedState.recurringDelegation),
      settingsPda,
      signer: wallet.publicKey,
      walletAddress: wallet.publicKey,
    });
    const closeSignature = await vaults.sdk.send(preparedClose.prepared, {
      confirm: true,
      signers: [wallet],
    });
    await waitForFinalized(connection, closeSignature);
    if (
      await connection.getAccountInfo(
        new PublicKey(completedState.recurringDelegation),
        "finalized"
      )
    ) {
      throw new Error(
        "Autodeposit close left the recurring delegation on-chain."
      );
    }
    if (
      await connection.getAccountInfo(
        new PublicKey(completedState.policyAccount),
        "finalized"
      )
    ) {
      throw new Error("Autodeposit close left the sweep policy on-chain.");
    }
    const closedTokenAccount = await getAccount(
      connection,
      new PublicKey(completedState.walletUsdcAta),
      "finalized",
      TOKEN_PROGRAM_ID
    );
    if (
      closedTokenAccount.delegate !== null ||
      closedTokenAccount.delegatedAmount !== BigInt(0)
    ) {
      throw new Error(
        "Autodeposit close left the wallet token delegate active."
      );
    }
    await writeChainTransactions({
      connection,
      output: args.closeOutput,
      transactions: [{ signature: closeSignature, stage: "close_autodeposit" }],
    });
  }
}

function issueLocalToken(state: LocalState, authSecret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: "loyal-yield-realtime",
    clientKind: "web",
    earnVaultAddress: state.vaultPubkey,
    exp: now + 300,
    iat: now,
    iss: "loyal-apps",
    scopes: ["autodeposit", "earn"],
    settingsPda: state.settingsPda,
    solanaEnv: "mainnet-beta",
    v: 1,
    walletAddress: state.walletAddress,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", authSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

async function listen(args: Args) {
  const expectedUiState = args.expectedUiState ?? "created";
  if (
    !(
      args.authSecret &&
      args.eventsUrl &&
      args.expectedReason &&
      args.postgresUrl &&
      args.state
    )
  ) {
    throw new Error(
      "listen requires auth, events, pending-floor, PostgreSQL, and state arguments."
    );
  }
  const pendingFloorReady = args.pendingFloorReady;
  const postgresUrl = args.postgresUrl;
  const state = JSON.parse(await readFile(args.state, "utf8")) as LocalState;
  process.env.NEON_DATABASE_URL = postgresUrl;
  process.env.YIELD_OPTIMIZATION_LOCAL_DATABASE_URL = postgresUrl;
  const repository = await import(
    "../src/lib/yield-optimization/earn-autodeposit-repository.server"
  );
  const { serializeAutodepositState } = await import(
    "../src/lib/yield-optimization/earn-state-serializers.server"
  );
  const persistFloor = async () => {
    if (!pendingFloorReady) {
      throw new Error(
        "created UI verification requires --pending-floor-ready."
      );
    }
    for (let attempt = 0; attempt < 600; attempt += 1) {
      try {
        await repository.updateAutodepositWalletBalanceFloor({
          policyAccount: state.policyAccount,
          recurringDelegation: state.recurringDelegation,
          settings: state.settingsPda,
          vaultIndex: 1,
          walletAddress: state.walletAddress,
          walletBalanceFloorRaw: BigInt(state.walletBalanceFloorRaw),
        });
        await writeFile(pendingFloorReady, "ready\n");
        return;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Autodeposit target does not exist."
        ) {
          await Bun.sleep(100);
          continue;
        }
        throw error;
      }
    }
    throw new Error("Web did not find the pending Autodeposit target.");
  };
  const response: EarnRealtimeTokenResponse = {
    accessToken: issueLocalToken(state, args.authSecret),
    eventsUrl: args.eventsUrl,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    schemaVersion: 1,
  };
  const controller = new AbortController();
  let matched = false;
  let floorError: unknown;
  const floorUpdate =
    expectedUiState === "created"
      ? persistFloor().catch((error) => {
          floorError = error;
          controller.abort();
        })
      : Promise.resolve();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    await consumeEarnRealtimeStream({
      cursor: null,
      onConnected: () => undefined,
      onInvalidation: (event) => {
        if (
          event.eventType === EARN_REALTIME_EVENT_TYPES.allowance &&
          event.reason === args.expectedReason
        ) {
          matched = true;
          void writeFile(
            args.output,
            JSON.stringify(
              {
                event,
                refreshPlan: resolveEarnRealtimeRefreshPlan([event]),
              },
              null,
              2
            )
          ).finally(() => controller.abort());
        }
      },
      response,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted =
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError";
    if (!(aborted && (matched || floorError))) {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
  if (!matched) {
    if (floorError) {
      throw floorError;
    }
    throw new Error(
      `Web SSE consumer did not receive ${args.expectedReason} Autodeposit state.`
    );
  }
  await floorUpdate;
  if (floorError) {
    throw floorError;
  }
  const current = await repository.findCurrentEarnAutodepositState({
    settings: state.settingsPda,
    vaultIndex: 1,
    walletAddress: state.walletAddress,
  });
  const output = JSON.parse(await readFile(args.output, "utf8")) as Record<
    string,
    unknown
  >;
  if (expectedUiState === "deleted") {
    if (current) {
      throw new Error("SSE refresh still loaded a deleted Autodeposit target.");
    }
    await writeFile(
      args.output,
      JSON.stringify(
        {
          ...output,
          ui: {
            isOn: false,
            isPending: false,
            keepAmount: null,
            state: "deleted",
          },
        },
        null,
        2
      )
    );
    return;
  }
  if (!current) {
    throw new Error("SSE refresh did not load an Autodeposit target.");
  }
  const loaded = serializeAutodepositState({
    ...current,
    depositedThisPeriodRaw: BigInt(0),
    scheduledSweeps: [],
  });
  const config = earnAutodepositConfigFromLoadedState(loaded);
  if (!(config && config.state === "created" && config.keepAmount === "2")) {
    throw new Error("SSE refresh did not load the active Autodeposit floor.");
  }
  const toggle = resolveEarnAutodepositTogglePresentation(config.state);
  await writeFile(
    args.output,
    JSON.stringify(
      {
        ...output,
        ui: {
          isOn: toggle.isOn,
          isPending: toggle.isPending,
          keepAmount: config.keepAmount,
          state: config.state,
        },
      },
      null,
      2
    )
  );
}

const { command, args } = parseArgs(process.argv.slice(2));
if (command === "setup") {
  await setup(args);
} else {
  await listen(args);
  // The local PostgreSQL adapter keeps a pooled socket open. The verifier has
  // completed all writes and assertions at this point, so close the process
  // instead of leaving the shell harness waiting on that idle socket.
  process.exit(0);
}
