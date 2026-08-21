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
import type { SmartAccountEarnCrossMintProjectedPolicyInput } from "@loyal-labs/smart-account-vaults";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
} from "@solana/web3.js";

import {
  executeEarnAutoswapSetupClient,
  prepareEarnAutoswapDeletionClient,
} from "../src/lib/yield-optimization/earn-autoswap-client-flow";
import { resolveEarnRealtimeRefreshPlan } from "../src/features/earn-realtime/invalidation";
import {
  consumeEarnRealtimeStream,
  type EarnRealtimeTokenResponse,
} from "../src/features/earn-realtime/stream";
import { EARN_REALTIME_EVENT_TYPES } from "../src/features/earn-realtime/types";

type LocalState = {
  delegatedSigner: string;
  policies: string[];
  settingsPda: string;
  vaultPubkey: string;
  walletSecretKey: number[];
  walletAddress: string;
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
  if (!command || !["setup", "close", "listen"].includes(command)) {
    throw new Error("Expected setup, close, or listen command.");
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
  signatures: string[];
}) {
  const records = [];
  for (const signature of args.signatures) {
    await waitForFinalized(args.connection, signature);
    const response = await args.connection.getTransaction(signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    if (!response) {
      throw new Error(`Finalized transaction ${signature} was not found.`);
    }
    if (response.meta?.err) {
      throw new Error(
        `Finalized transaction ${signature} failed: ${JSON.stringify(
          response.meta.err
        )}`
      );
    }
    const message = response.transaction.message;
    if (message.addressTableLookups.length !== 0) {
      throw new Error("Local Autoswap transaction unexpectedly used an ALT.");
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
      signature,
      slot: response.slot,
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
  const signatures: string[] = [];
  const projectedPolicies: SmartAccountEarnCrossMintProjectedPolicyInput[] = [];
  const result = await executeEarnAutoswapSetupClient({
    client: vaults,
    input: {
      cluster: LoyalCluster.MainnetBeta,
      dailySourceMintSpendingCap: BigInt(1_000_000_000),
      feePayer: wallet.publicKey,
      maxSlippageBps: 100,
      settingsPda,
      signer: delegatedSigner.publicKey,
      walletAddress: wallet.publicKey,
    },
    onPolicyConfirmed: (policy) => projectedPolicies.push(policy),
    sendPrepared: async (prepared) => {
      const signature = await vaults.sdk.send(prepared, {
        confirm: true,
        signers: [wallet],
      });
      signatures.push(signature);
      return signature;
    },
  });
  if (result.completedPolicies !== 2 || signatures.length !== 2) {
    throw new Error("Web Autoswap setup did not submit both policies.");
  }
  const installed = await vaults.prepareEarnCrossMintSwapPolicies({
    cluster: LoyalCluster.MainnetBeta,
    dailySourceMintSpendingCap: BigInt(1_000_000_000),
    feePayer: wallet.publicKey,
    maxSlippageBps: 100,
    settingsPda,
    signer: delegatedSigner.publicKey,
    walletAddress: wallet.publicKey,
    projectedPolicies,
  });
  if (installed.policies.some((policy) => !policy.existing)) {
    throw new Error("Submitted Autoswap policies are not readable from chain.");
  }
  const state: LocalState = {
    delegatedSigner: delegatedSigner.publicKey.toBase58(),
    policies: installed.policies.map((policy) =>
      policy.policy.account.toBase58()
    ),
    settingsPda: settingsPda.toBase58(),
    vaultPubkey: installed.vault.pubkey.toBase58(),
    walletAddress: wallet.publicKey.toBase58(),
    walletSecretKey: [...wallet.secretKey],
  };
  await writeFile(args.output, JSON.stringify(state, null, 2));
  await writeChainTransactions({
    connection,
    output: `${args.output}.transactions.ndjson`,
    signatures,
  });
}

async function close(args: Args) {
  if (!(args.rpcUrl && args.state)) {
    throw new Error("close requires --rpc-url and --state.");
  }
  const state = JSON.parse(await readFile(args.state, "utf8")) as LocalState;
  const wallet = Keypair.fromSecretKey(Uint8Array.from(state.walletSecretKey));
  const connection = new Connection(args.rpcUrl, "confirmed");
  const vaults = createSmartAccountVaultsClient({
    connection,
    programId: PROGRAM_ID,
  });
  const prepared = await prepareEarnAutoswapDeletionClient({
    client: vaults,
    feePayer: wallet.publicKey,
    policies: state.policies.map((policy) => new PublicKey(policy)),
    settingsPda: new PublicKey(state.settingsPda),
    signer: wallet.publicKey,
  });
  if (!prepared) {
    throw new Error("Web Autoswap close did not prepare a transaction.");
  }
  const signature = await vaults.sdk.send(prepared, {
    confirm: true,
    signers: [wallet],
  });
  await writeChainTransactions({
    connection,
    output: args.output,
    signatures: [signature],
  });
  const remaining = await connection.getMultipleAccountsInfo(
    state.policies.map((policy) => new PublicKey(policy)),
    "finalized"
  );
  if (remaining.some(Boolean)) {
    throw new Error("Autoswap policy accounts remain on chain after close.");
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
          event.eventType === EARN_REALTIME_EVENT_TYPES.autoswap &&
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
      `Web SSE consumer did not receive ${args.expectedReason} Autoswap state.`
    );
  }
}

const { command, args } = parseArgs(process.argv.slice(2));
if (command === "setup") {
  await setup(args);
} else if (command === "close") {
  await close(args);
} else {
  await listen(args);
}
