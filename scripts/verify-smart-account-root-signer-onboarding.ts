import { mock } from "bun:test";
import bs58 from "bs58";
import { and, eq } from "drizzle-orm";
import nacl from "tweetnacl";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  Transaction,
} from "@solana/web3.js";

import {
  appSmartAccountSigners,
  appSmartAccountSponsorshipTransactions,
  appUserSmartAccounts,
  appUserWallets,
  appUsers,
} from "../packages/db-core/src/schema.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";
import {
  createSmartAccountVaultsClient,
  sendPreparedWithWallet,
  type WalletAdapterLike,
} from "../packages/smart-account-vaults/src/index.ts";
import {
  Settings,
  settingsDiscriminator,
} from "../packages/loyal-smart-accounts-core/src/index.ts";
import {
  PROGRAM_ADDRESS,
  pda,
} from "../packages/loyal-smart-accounts/src/index.ts";

mock.module("server-only", () => ({}));

const SOLANA_ENV = resolveSolanaEnv(
  process.env.NEXT_PUBLIC_SOLANA_ENV,
  "mainnet"
);
const EXECUTE = process.env.SMART_ACCOUNT_SIGNER_VERIFY_EXECUTE === "1";
const WRITE_DB =
  EXECUTE || process.env.SMART_ACCOUNT_SIGNER_VERIFY_WRITE_DB === "1";
const FRONTEND_BASE_URL =
  process.env.SMART_ACCOUNT_SIGNER_VERIFY_FRONTEND_BASE_URL;
const TURNSTILE_TOKEN = process.env.SMART_ACCOUNT_SIGNER_VERIFY_TURNSTILE_TOKEN;
const REQUEST_ORIGIN =
  process.env.SMART_ACCOUNT_SIGNER_VERIFY_REQUEST_ORIGIN ??
  "https://verifier.loyal.local";
const CLEANUP_SIGNER_ADDRESS =
  process.env.SMART_ACCOUNT_SIGNER_VERIFY_CLEANUP_SIGNER_ADDRESS;

type Evidence = Record<string, unknown>;

async function getSmartAccountRepository() {
  return import("../frontend/src/features/smart-accounts/server/repository.ts");
}

async function getFrontendDatabase() {
  const { getDatabase } = await import("../frontend/src/lib/core/database.ts");
  return getDatabase();
}

async function getWalletOnboarding() {
  return import(
    "../frontend/src/features/identity/server/wallet-onboarding.ts"
  );
}

function readProgramId(): PublicKey {
  return new PublicKey(
    process.env[
      `LOYAL_SMART_ACCOUNTS_PROGRAM_ID_${SOLANA_ENV.toUpperCase()}`
    ] ??
      process.env.LOYAL_SMART_ACCOUNTS_PROGRAM_ID ??
      PROGRAM_ADDRESS
  );
}

function loadKeypair(envName: string): Keypair {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    throw new Error(`${envName} is required.`);
  }

  if (raw.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  }

  if (/^[0-9a-f]+$/i.test(raw) && raw.length >= 128) {
    return Keypair.fromSecretKey(Buffer.from(raw, "hex"));
  }

  return Keypair.fromSecretKey(bs58.decode(raw));
}

function createWalletAdapter(keypair: Keypair): WalletAdapterLike {
  return {
    publicKey: keypair.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      transaction: T
    ) {
      if (transaction instanceof VersionedTransaction) {
        transaction.sign([keypair]);
      } else {
        transaction.sign(keypair);
      }
      return transaction;
    },
  };
}

function signerPermissionMask(
  settings: Settings,
  signer: PublicKey
): number | null {
  return (
    settings.signers.find((entry) => entry.key.equals(signer))?.permissions
      .mask ?? null
  );
}

async function fetchSettings(connection: Connection, settingsPda: PublicKey) {
  const account = await connection.getAccountInfo(settingsPda, "confirmed");
  if (!account) {
    throw new Error(
      `Settings account ${settingsPda.toBase58()} was not found.`
    );
  }

  return Settings.fromAccountInfo(account)[0];
}

async function resolveSettingsPdaForSigner(args: {
  connection: Connection;
  programId: PublicKey;
  signer: PublicKey;
}): Promise<PublicKey> {
  const explicit = process.env.SMART_ACCOUNT_SIGNER_VERIFY_SETTINGS_PDA;
  if (explicit) {
    return new PublicKey(explicit);
  }

  const accounts = await args.connection.getProgramAccounts(args.programId, {
    commitment: "confirmed",
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(Buffer.from(settingsDiscriminator)),
        },
      },
    ],
  });
  const matches: PublicKey[] = [];

  for (const account of accounts) {
    const settings = Settings.fromAccountInfo(account.account)[0];
    if (settings.signers.some((signer) => signer.key.equals(args.signer))) {
      matches.push(account.pubkey);
    }
  }

  if (matches.length === 0) {
    throw new Error(
      `No Settings account found with root signer ${args.signer.toBase58()}.`
    );
  }

  if (matches.length > 1) {
    throw new Error(
      "Multiple Settings accounts matched SOLANA_TESTING_PK. Re-run with SMART_ACCOUNT_SIGNER_VERIFY_SETTINGS_PDA. Matches: " +
        matches.map((match) => match.toBase58()).join(", ")
    );
  }

  return matches[0]!;
}

async function getSignatureSlot(connection: Connection, signature: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });
    if (status.value?.slot != null) {
      return status.value.slot;
    }
    await wait(1_000);
  }

  return null;
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRootSignerState(args: {
  connection: Connection;
  settingsPda: PublicKey;
  signer: PublicKey;
  expectedPresent: boolean;
}) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const settings = await fetchSettings(args.connection, args.settingsPda);
    const permissionMask = signerPermissionMask(settings, args.signer);
    const isPresent = permissionMask != null;

    if (isPresent === args.expectedPresent) {
      return {
        permissionMask,
        settings,
      };
    }

    await wait(1_000);
  }

  throw new Error(
    `Timed out waiting for signer ${args.signer.toBase58()} to be ${
      args.expectedPresent ? "present on" : "removed from"
    } Settings ${args.settingsPda.toBase58()}.`
  );
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return { message: String(error), name: "Error" };
}

function signWalletAuthMessage(args: { keypair: Keypair; message: string }) {
  return bs58.encode(
    nacl.sign.detached(
      new TextEncoder().encode(args.message),
      args.keypair.secretKey
    )
  );
}

async function postJson<T>(args: {
  body: unknown;
  cookie?: string;
  path: string;
}): Promise<{ body: T; response: Response }> {
  if (!FRONTEND_BASE_URL) {
    throw new Error(
      "SMART_ACCOUNT_SIGNER_VERIFY_FRONTEND_BASE_URL is not set."
    );
  }

  const response = await fetch(`${FRONTEND_BASE_URL}${args.path}`, {
    body: JSON.stringify(args.body),
    headers: {
      "content-type": "application/json",
      origin: FRONTEND_BASE_URL,
      ...(args.cookie ? { cookie: args.cookie } : {}),
    },
    method: "POST",
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `Frontend ${args.path} failed with ${response.status}: ${JSON.stringify(
        body
      )}`
    );
  }

  return { body: body as T, response };
}

function extractCookieHeader(response: Response): string {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  const rawCookies = getSetCookie ?? [response.headers.get("set-cookie") ?? ""];
  const cookies = rawCookies
    .flatMap((cookie) => cookie.split(", "))
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie));

  if (cookies.length === 0) {
    throw new Error("Frontend auth did not return a session cookie.");
  }

  return cookies.join("; ");
}

async function authenticateGeneratedWallet(args: {
  generatedWallet: Keypair;
  expectedSettingsPda: PublicKey;
  expectedSmartAccount: PublicKey;
}) {
  const challenge = await postJson<{ challengeToken: string; message: string }>(
    {
      body: {
        ...(TURNSTILE_TOKEN ? { turnstileToken: TURNSTILE_TOKEN } : {}),
        walletAddress: args.generatedWallet.publicKey.toBase58(),
      },
      path: "/api/auth/wallet/challenge",
    }
  );
  const completion = await postJson<{
    user?: { settingsPda?: string; smartAccountAddress?: string };
  }>({
    body: {
      challengeToken: challenge.body.challengeToken,
      signature: signWalletAuthMessage({
        keypair: args.generatedWallet,
        message: challenge.body.message,
      }),
    },
    path: "/api/auth/wallet/complete",
  });

  const settingsPda = completion.body.user?.settingsPda;
  const smartAccountAddress = completion.body.user?.smartAccountAddress;
  if (settingsPda !== args.expectedSettingsPda.toBase58()) {
    throw new Error(
      `Delegated auth returned settings ${settingsPda}, expected ${args.expectedSettingsPda.toBase58()}.`
    );
  }
  if (smartAccountAddress !== args.expectedSmartAccount.toBase58()) {
    throw new Error(
      `Delegated auth returned smart account ${smartAccountAddress}, expected ${args.expectedSmartAccount.toBase58()}.`
    );
  }

  return {
    cookie: extractCookieHeader(completion.response),
    settingsPda,
    smartAccountAddress,
  };
}

async function authenticateGeneratedWalletWithBackend(args: {
  generatedWallet: Keypair;
  expectedSettingsPda: PublicKey;
  expectedSmartAccount: PublicKey;
}) {
  const { completeWalletOnboarding, createWalletAuthChallenge } =
    await getWalletOnboarding();
  const challenge = await createWalletAuthChallenge(
    {
      walletAddress: args.generatedWallet.publicKey.toBase58(),
    },
    {
      requestOrigin: REQUEST_ORIGIN,
    }
  );
  const completion = await completeWalletOnboarding(
    {
      challengeToken: challenge.challengeToken,
      signature: signWalletAuthMessage({
        keypair: args.generatedWallet,
        message: challenge.message,
      }),
    },
    {
      requestOrigin: REQUEST_ORIGIN,
    }
  );

  if (completion.user.settingsPda !== args.expectedSettingsPda.toBase58()) {
    throw new Error(
      `Backend auth returned settings ${
        completion.user.settingsPda
      }, expected ${args.expectedSettingsPda.toBase58()}.`
    );
  }

  if (
    completion.user.smartAccountAddress !== args.expectedSmartAccount.toBase58()
  ) {
    throw new Error(
      `Backend auth returned smart account ${
        completion.user.smartAccountAddress
      }, expected ${args.expectedSmartAccount.toBase58()}.`
    );
  }

  if (completion.provisioningOutcome !== "delegated_root_signer") {
    throw new Error(
      `Backend auth outcome ${completion.provisioningOutcome} did not prove delegated root signer onboarding.`
    );
  }

  return {
    provisioningOutcome: completion.provisioningOutcome,
    settingsPda: completion.user.settingsPda,
    smartAccountAddress: completion.user.smartAccountAddress,
  };
}

async function queryDbProof(args: {
  generatedWallet: PublicKey;
  settingsPda: PublicKey;
  smartAccountAddress: PublicKey;
}) {
  const db = await getFrontendDatabase();
  const user = await db.query.appUsers.findFirst({
    where: and(
      eq(appUsers.provider, "solana"),
      eq(appUsers.subjectAddress, args.generatedWallet.toBase58())
    ),
  });
  const wallet = await db.query.appUserWallets.findFirst({
    where: eq(appUserWallets.walletAddress, args.generatedWallet.toBase58()),
  });
  const personalSmartAccount = user
    ? await db.query.appUserSmartAccounts.findFirst({
        where: and(
          eq(appUserSmartAccounts.userId, user.id),
          eq(appUserSmartAccounts.solanaEnv, SOLANA_ENV)
        ),
      })
    : null;
  const sponsorship =
    await db.query.appSmartAccountSponsorshipTransactions.findFirst({
      where: and(
        eq(appSmartAccountSponsorshipTransactions.solanaEnv, SOLANA_ENV),
        eq(
          appSmartAccountSponsorshipTransactions.userAddress,
          args.generatedWallet.toBase58()
        )
      ),
    });
  const signer = await db.query.appSmartAccountSigners.findFirst({
    where: and(
      eq(appSmartAccountSigners.solanaEnv, SOLANA_ENV),
      eq(appSmartAccountSigners.settingsPda, args.settingsPda.toBase58()),
      eq(appSmartAccountSigners.signerAddress, args.generatedWallet.toBase58())
    ),
  });

  return {
    userId: user?.id ?? null,
    walletLinkedAfterAuth: Boolean(wallet),
    walletUserId: wallet?.userId ?? null,
    personalSmartAccountCreated: Boolean(personalSmartAccount),
    sponsorshipCreated: Boolean(sponsorship),
    signerState: signer?.state ?? null,
    signerUserId: signer?.userId ?? null,
    smartAccountAddress: args.smartAccountAddress.toBase58(),
  };
}

type DbProof = Awaited<ReturnType<typeof queryDbProof>>;

function assertDbProofState(
  proof: DbProof,
  expected: {
    personalSmartAccountCreated: boolean;
    signerState: "active" | "removed";
    sponsorshipCreated: boolean;
    walletLinkedAfterAuth: boolean;
  }
) {
  if (proof.walletLinkedAfterAuth !== expected.walletLinkedAfterAuth) {
    throw new Error(
      `Unexpected app_user_wallets state: expected ${expected.walletLinkedAfterAuth}, got ${proof.walletLinkedAfterAuth}.`
    );
  }

  if (
    proof.personalSmartAccountCreated !== expected.personalSmartAccountCreated
  ) {
    throw new Error(
      `Unexpected personal smart-account state: expected ${expected.personalSmartAccountCreated}, got ${proof.personalSmartAccountCreated}.`
    );
  }

  if (proof.sponsorshipCreated !== expected.sponsorshipCreated) {
    throw new Error(
      `Unexpected sponsorship state: expected ${expected.sponsorshipCreated}, got ${proof.sponsorshipCreated}.`
    );
  }

  if (proof.signerState !== expected.signerState) {
    throw new Error(
      `Unexpected signer state: expected ${expected.signerState}, got ${proof.signerState}.`
    );
  }
}

async function main() {
  if (SOLANA_ENV !== "mainnet") {
    throw new Error(
      "This verifier is mainnet-only; set NEXT_PUBLIC_SOLANA_ENV=mainnet."
    );
  }

  const rootSigner = loadKeypair("SOLANA_TESTING_PK");
  const generatedWallet = Keypair.generate();
  const programId = readProgramId();
  const endpoints = getSolanaEndpoints(SOLANA_ENV);
  const connection = new Connection(endpoints.rpcEndpoint, {
    commitment: "confirmed",
    wsEndpoint: endpoints.websocketEndpoint,
  });
  const client = createSmartAccountVaultsClient({
    connection,
    programId,
  });
  const settingsPda = await resolveSettingsPdaForSigner({
    connection,
    programId,
    signer: rootSigner.publicKey,
  });
  const smartAccountAddress = pda.getSmartAccountPda({
    accountIndex: 0,
    programId,
    settingsPda,
  })[0];
  const evidence: Evidence = {
    mode: EXECUTE ? "execute" : "dry-run",
    writesDb: WRITE_DB,
    solanaEnv: SOLANA_ENV,
    programId: programId.toBase58(),
    settingsPda: settingsPda.toBase58(),
    smartAccountAddress: smartAccountAddress.toBase58(),
    rootSigner: rootSigner.publicKey.toBase58(),
    generatedSigner: generatedWallet.publicKey.toBase58(),
  };

  const initialSettings = await fetchSettings(connection, settingsPda);
  if (!signerPermissionMask(initialSettings, rootSigner.publicKey)) {
    throw new Error("SOLANA_TESTING_PK is not an active root Settings signer.");
  }

  if (CLEANUP_SIGNER_ADDRESS) {
    const cleanupSigner = new PublicKey(CLEANUP_SIGNER_ADDRESS);
    const cleanupPrepared = await client.prepareRemoveRootSigner({
      creator: rootSigner.publicKey,
      feePayer: rootSigner.publicKey,
      settingsPda,
      signer: cleanupSigner,
    });
    evidence.cleanupPrepared = {
      instructionCount: cleanupPrepared.prepared.instructions.length,
      signer: cleanupSigner.toBase58(),
      transactionIndex: cleanupPrepared.transactionIndex.toString(),
    };
    const cleanupRequest = WRITE_DB
      ? await (async () => {
          const repository = await getSmartAccountRepository();
          return repository.upsertDraftSmartAccountSettingsChangeRequest({
            action: "remove_root_signer",
            idempotencyKey: `root-signer:cleanup:${settingsPda.toBase58()}:${cleanupSigner.toBase58()}`,
            settingsPda: settingsPda.toBase58(),
            signerAddress: cleanupSigner.toBase58(),
            smartAccountAddress: smartAccountAddress.toBase58(),
            solanaEnv: SOLANA_ENV,
            transactionIndex: cleanupPrepared.transactionIndex,
          });
        })()
      : null;

    if (!EXECUTE) {
      console.log(
        JSON.stringify(
          { ...evidence, verdict: "CLEANUP_DRY_RUN_READY" },
          null,
          2
        )
      );
      return;
    }

    const cleanupSignature = await sendPreparedWithWallet({
      connection,
      prepared: cleanupPrepared.prepared,
      wallet: createWalletAdapter(rootSigner),
    });
    const cleanupSlot = await getSignatureSlot(connection, cleanupSignature);
    await waitForRootSignerState({
      connection,
      expectedPresent: false,
      settingsPda,
      signer: cleanupSigner,
    });

    if (cleanupRequest) {
      const repository = await getSmartAccountRepository();
      await repository.markSmartAccountSettingsChangeRequestSubmitted({
        id: cleanupRequest.id,
        signature: cleanupSignature,
        transactionIndex: cleanupPrepared.transactionIndex,
      });
      await repository.markSmartAccountSettingsChangeRequestConfirmed({
        confirmedSlot: cleanupSlot,
        id: cleanupRequest.id,
        signature: cleanupSignature,
      });
      await repository.markRootSmartAccountSignerRemoved({
        settingsPda: settingsPda.toBase58(),
        signerAddress: cleanupSigner.toBase58(),
        solanaEnv: SOLANA_ENV,
        sourceSignature: cleanupSignature,
        sourceSlot: cleanupSlot,
      });
    }

    console.log(
      JSON.stringify(
        {
          ...evidence,
          cleanupConfirmed: {
            signature: cleanupSignature,
            slot: cleanupSlot,
          },
          verdict: "CLEANUP_PASS",
        },
        null,
        2
      )
    );
    return;
  }

  const addPrepared = await client.prepareAddRootSigner({
    creator: rootSigner.publicKey,
    feePayer: rootSigner.publicKey,
    settingsPda,
    signer: generatedWallet.publicKey,
  });
  evidence.addPrepared = {
    instructionCount: addPrepared.prepared.instructions.length,
    transactionIndex: addPrepared.transactionIndex.toString(),
  };

  const addRequest = WRITE_DB
    ? await (async () => {
        const repository = await getSmartAccountRepository();
        return repository.upsertDraftSmartAccountSettingsChangeRequest({
          action: "add_root_signer",
          idempotencyKey: `root-signer:add:${settingsPda.toBase58()}:${generatedWallet.publicKey.toBase58()}`,
          settingsPda: settingsPda.toBase58(),
          signerAddress: generatedWallet.publicKey.toBase58(),
          smartAccountAddress: smartAccountAddress.toBase58(),
          solanaEnv: SOLANA_ENV,
          transactionIndex: addPrepared.transactionIndex,
        });
      })()
    : null;

  if (!EXECUTE) {
    console.log(
      JSON.stringify({ ...evidence, verdict: "DRY_RUN_READY" }, null, 2)
    );
    return;
  }

  const addSignature = await sendPreparedWithWallet({
    connection,
    prepared: addPrepared.prepared,
    wallet: createWalletAdapter(rootSigner),
  });
  const addSlot = await getSignatureSlot(connection, addSignature);
  if (addRequest) {
    const repository = await getSmartAccountRepository();
    await repository.markSmartAccountSettingsChangeRequestSubmitted({
      id: addRequest.id,
      signature: addSignature,
      transactionIndex: addPrepared.transactionIndex,
    });
    await repository.markSmartAccountSettingsChangeRequestConfirmed({
      confirmedSlot: addSlot,
      id: addRequest.id,
      signature: addSignature,
    });
  }

  async function removeGeneratedRootSigner(reason: string) {
    const removePrepared = await client.prepareRemoveRootSigner({
      creator: rootSigner.publicKey,
      feePayer: rootSigner.publicKey,
      settingsPda,
      signer: generatedWallet.publicKey,
    });
    evidence.removePrepared = {
      instructionCount: removePrepared.prepared.instructions.length,
      reason,
      transactionIndex: removePrepared.transactionIndex.toString(),
    };
    const removeRequest = WRITE_DB
      ? await (async () => {
          const repository = await getSmartAccountRepository();
          return repository.upsertDraftSmartAccountSettingsChangeRequest({
            action: "remove_root_signer",
            idempotencyKey: `root-signer:remove:${settingsPda.toBase58()}:${generatedWallet.publicKey.toBase58()}`,
            settingsPda: settingsPda.toBase58(),
            signerAddress: generatedWallet.publicKey.toBase58(),
            smartAccountAddress: smartAccountAddress.toBase58(),
            solanaEnv: SOLANA_ENV,
            transactionIndex: removePrepared.transactionIndex,
          });
        })()
      : null;
    const removeSignature = await sendPreparedWithWallet({
      connection,
      prepared: removePrepared.prepared,
      wallet: createWalletAdapter(rootSigner),
    });
    const removeSlot = await getSignatureSlot(connection, removeSignature);
    if (removeRequest) {
      const repository = await getSmartAccountRepository();
      await repository.markSmartAccountSettingsChangeRequestSubmitted({
        id: removeRequest.id,
        signature: removeSignature,
        transactionIndex: removePrepared.transactionIndex,
      });
      await repository.markSmartAccountSettingsChangeRequestConfirmed({
        confirmedSlot: removeSlot,
        id: removeRequest.id,
        signature: removeSignature,
      });
    }
    await waitForRootSignerState({
      connection,
      expectedPresent: false,
      settingsPda,
      signer: generatedWallet.publicKey,
    });
    if (WRITE_DB) {
      const repository = await getSmartAccountRepository();
      await repository.markRootSmartAccountSignerRemoved({
        settingsPda: settingsPda.toBase58(),
        signerAddress: generatedWallet.publicKey.toBase58(),
        solanaEnv: SOLANA_ENV,
        sourceSignature: removeSignature,
        sourceSlot: removeSlot,
      });
    }
    evidence.removeConfirmed = { signature: removeSignature, slot: removeSlot };
    evidence.dbAfterCleanup = await queryDbProof({
      generatedWallet: generatedWallet.publicKey,
      settingsPda,
      smartAccountAddress,
    });
    assertDbProofState(evidence.dbAfterCleanup as DbProof, {
      personalSmartAccountCreated: false,
      signerState: "removed",
      sponsorshipCreated: false,
      walletLinkedAfterAuth: (evidence.dbAfterCleanup as DbProof)
        .walletLinkedAfterAuth,
    });
  }

  let proofFailure: unknown = null;
  let cleanupFailure: unknown = null;

  try {
    const generatedPermissionMask = (
      await waitForRootSignerState({
        connection,
        expectedPresent: true,
        settingsPda,
        signer: generatedWallet.publicKey,
      })
    ).permissionMask;
    if (!generatedPermissionMask) {
      throw new Error(
        "Generated wallet was not present after AddSigner confirmation."
      );
    }
    if (WRITE_DB) {
      const repository = await getSmartAccountRepository();
      await repository.upsertActiveRootSmartAccountSigner({
        permissionMask: generatedPermissionMask,
        settingsPda: settingsPda.toBase58(),
        signerAddress: generatedWallet.publicKey.toBase58(),
        smartAccountAddress: smartAccountAddress.toBase58(),
        solanaEnv: SOLANA_ENV,
        sourceSignature: addSignature,
        sourceSlot: addSlot,
      });
    }
    evidence.addConfirmed = { signature: addSignature, slot: addSlot };
    evidence.dbBeforeAuth = await queryDbProof({
      generatedWallet: generatedWallet.publicKey,
      settingsPda,
      smartAccountAddress,
    });
    assertDbProofState(evidence.dbBeforeAuth as DbProof, {
      personalSmartAccountCreated: false,
      signerState: "active",
      sponsorshipCreated: false,
      walletLinkedAfterAuth: false,
    });

    if (FRONTEND_BASE_URL) {
      evidence.frontendAuth = await authenticateGeneratedWallet({
        expectedSettingsPda: settingsPda,
        expectedSmartAccount: smartAccountAddress,
        generatedWallet,
      });
    } else {
      evidence.backendAuth = await authenticateGeneratedWalletWithBackend({
        expectedSettingsPda: settingsPda,
        expectedSmartAccount: smartAccountAddress,
        generatedWallet,
      });
    }
    evidence.dbAfterAuth = await queryDbProof({
      generatedWallet: generatedWallet.publicKey,
      settingsPda,
      smartAccountAddress,
    });
    assertDbProofState(evidence.dbAfterAuth as DbProof, {
      personalSmartAccountCreated: false,
      signerState: "active",
      sponsorshipCreated: false,
      walletLinkedAfterAuth: true,
    });
  } catch (error) {
    proofFailure = error;
    evidence.proofFailure = serializeError(error);
  }

  try {
    await removeGeneratedRootSigner(
      proofFailure ? "proof-failed-cleanup" : "post-proof-cleanup"
    );
  } catch (error) {
    cleanupFailure = error;
    evidence.cleanupFailure = serializeError(error);
  }

  if (proofFailure || cleanupFailure) {
    console.error(JSON.stringify({ ...evidence, verdict: "FAIL" }, null, 2));
    if (proofFailure && cleanupFailure) {
      throw new AggregateError(
        [proofFailure, cleanupFailure],
        "Verifier proof failed and cleanup also failed."
      );
    }
    throw proofFailure ?? cleanupFailure;
  }

  console.log(JSON.stringify({ ...evidence, verdict: "PASS" }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
