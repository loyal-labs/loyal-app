import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  codecs,
  createLoyalSmartAccountsClient,
  pda,
  PROGRAM_ID,
  smartAccounts,
} from "@loyal-labs/loyal-smart-accounts";
import { LoyalCluster } from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
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
} from "@solana/web3.js";

import { resolveEarnRealtimeRefreshPlan } from "../src/features/earn-realtime/invalidation";
import {
  consumeEarnRealtimeStream,
  type EarnRealtimeTokenResponse,
} from "../src/features/earn-realtime/stream";
import { EARN_REALTIME_EVENT_TYPES } from "../src/features/earn-realtime/types";

type SetupStage =
  | "approve_token_delegate"
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
  walletUsdcAta: string;
};

type RecordedTransaction = {
  signature: string;
  stage: SetupStage;
};

type Args = {
  authSecret?: string;
  eventsUrl?: string;
  expectedReason?: string;
  output: string;
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
      eventsUrl: values["events-url"],
      expectedReason: values["expected-reason"],
      output: values.output,
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
  const nonce = BigInt(42);
  let policySeed: bigint | undefined;
  let completedState: LocalState | null = null;
  for (let round = 0; round < 4; round += 1) {
    const stages = await vaults.prepareEarnUsdcAutodepositSetupBatch({
      amountRaw: BigInt(1_000_000),
      cluster: LoyalCluster.MainnetBeta,
      expiryTimestamp: BigInt(0),
      feePayer: wallet.publicKey,
      minimumDelegatorBalanceRaw: BigInt(0),
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
    for (const stage of stages) {
      const setupStage = stage.stage as SetupStage;
      const signature = await vaults.sdk.send(stage.prepared, {
        confirm: true,
        signers: [wallet],
      });
      transactions.push({ signature, stage: setupStage });
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
          walletUsdcAta: stage.persistence.walletUsdcAta,
        };
      }
    }
    if (completedState) {
      break;
    }
  }
  if (!completedState) {
    throw new Error("Web Autodeposit setup did not reach delegation creation.");
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
  if (
    !(args.authSecret && args.eventsUrl && args.expectedReason && args.state)
  ) {
    throw new Error(
      "listen requires --auth-secret, --events-url, --expected-reason, and --state."
    );
  }
  const state = JSON.parse(await readFile(args.state, "utf8")) as LocalState;
  const response: EarnRealtimeTokenResponse = {
    accessToken: issueLocalToken(state, args.authSecret),
    eventsUrl: args.eventsUrl,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    schemaVersion: 1,
  };
  const controller = new AbortController();
  let matched = false;
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
    if (
      !(
        matched &&
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError"
      )
    ) {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
  if (!matched) {
    throw new Error(
      `Web SSE consumer did not receive ${args.expectedReason} Autodeposit state.`
    );
  }
}

const { command, args } = parseArgs(process.argv.slice(2));
if (command === "setup") {
  await setup(args);
} else {
  await listen(args);
}
