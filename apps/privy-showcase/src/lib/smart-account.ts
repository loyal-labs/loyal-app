import {
  accounts,
  codecs,
  createLoyalSmartAccountsClient,
  pda,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts";
import type { WalletAdapterLike } from "@loyal-labs/smart-account-vaults";
import { sendPreparedWithWallet } from "@loyal-labs/smart-account-vaults";
import { Connection, PublicKey } from "@solana/web3.js";
import { findSmartAccountsForSigner } from "./discovery";
import { SQUADS_PROGRAM_ID } from "./constants";
import { waitForFinalized } from "./rpc";

export type PreparedSmartAccountCreation = {
  accountIndex: bigint;
  settings: PublicKey;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
};

export function shouldReprepareCreation(args: {
  error: unknown;
  attempt: number;
  maxAttempts: number;
}): boolean {
  const mayHaveSubmitted = Boolean(
    args.error &&
      typeof args.error === "object" &&
      (args.error as { transactionWasSubmitted?: unknown })
        .transactionWasSubmitted
  );
  const message =
    args.error instanceof Error
      ? `${args.error.name}: ${args.error.message}`.toLowerCase()
      : String(args.error).toLowerCase();
  const isDeterministicIndexCollision = [
    "account already in use",
    "accountalreadyinuse",
    "already been allocated",
    "settings account already exists",
  ].some((marker) => message.includes(marker));
  return (
    isDeterministicIndexCollision &&
    !mayHaveSubmitted &&
    args.attempt + 1 < args.maxAttempts
  );
}

export function assertCreatedSettingsBoundary(args: {
  wallet: PublicKey;
  threshold: number;
  timeLock: number;
  signers: Array<{ key: PublicKey; permissionMask: number }>;
}): void {
  if (args.threshold !== 1)
    throw new Error("Created Settings threshold is not 1.");
  if (args.timeLock !== 0)
    throw new Error("Created Settings timelock is not zero.");
  if (args.signers.length !== 1)
    throw new Error("Created Settings must contain exactly one root signer.");
  const [signer] = args.signers;
  if (!signer?.key.equals(args.wallet))
    throw new Error("Created Settings root signer is not the Privy wallet.");
  if ((signer.permissionMask & 0b111) !== 0b111)
    throw new Error("Created Settings signer permissions are incomplete.");
}

export async function prepareSmartAccountCreation(args: {
  connection: Connection;
  wallet: PublicKey;
}): Promise<PreparedSmartAccountCreation> {
  const client = createLoyalSmartAccountsClient({
    connection: args.connection,
    programId: SQUADS_PROGRAM_ID,
  });
  const programConfigPda = pda.getProgramConfigPda({
    programId: SQUADS_PROGRAM_ID,
  })[0];
  const programConfig = await client.programConfig.queries.fetchProgramConfig(
    programConfigPda,
    "finalized"
  );
  const accountIndex = BigInt(programConfig.smartAccountIndex.toString()) + 1n;
  const settings = pda.getSettingsPda({
    accountIndex,
    programId: SQUADS_PROGRAM_ID,
  })[0];
  const prepared = await client.features.smartAccounts.prepare.create({
    programId: SQUADS_PROGRAM_ID,
    treasury: programConfig.treasury,
    creator: args.wallet,
    settings,
    settingsAuthority: null,
    threshold: 1,
    signers: [{ key: args.wallet, permissions: codecs.Permissions.all() }],
    timeLock: 0,
    rentCollector: null,
    memo: "Loyal Privy compatibility showcase",
  });
  return { accountIndex, settings, prepared };
}

export async function createSmartAccountWithCollisionRecovery(args: {
  connection: Connection;
  wallet: WalletAdapterLike;
  maxAttempts?: number;
}): Promise<{
  settings: PublicKey;
  signature: string | null;
  discovered: boolean;
}> {
  const existing = await findSmartAccountsForSigner(
    args.connection,
    args.wallet.publicKey
  );
  const eligibleExisting = existing.find((account) => account.eligible);
  if (eligibleExisting)
    return {
      settings: eligibleExisting.settings,
      signature: null,
      discovered: true,
    };

  const maxAttempts = args.maxAttempts ?? 2;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const creation = await prepareSmartAccountCreation({
      connection: args.connection,
      wallet: args.wallet.publicKey,
    });
    try {
      const signature = await sendPreparedWithWallet({
        connection: args.connection,
        wallet: args.wallet,
        prepared: creation.prepared,
        confirm: false,
      });
      await waitForFinalized(args.connection, signature);
      const settings = await accounts.Settings.fromAccountAddress(
        args.connection,
        creation.settings,
        "finalized"
      );
      assertCreatedSettingsBoundary({
        wallet: args.wallet.publicKey,
        threshold: settings.threshold,
        timeLock: settings.timeLock,
        signers: settings.signers.map((signer) => ({
          key: signer.key,
          permissionMask: signer.permissions.mask,
        })),
      });
      return { settings: creation.settings, signature, discovered: false };
    } catch (error) {
      lastError = error;
      const rescanned = await findSmartAccountsForSigner(
        args.connection,
        args.wallet.publicKey
      );
      const eligibleRescan = rescanned.find((account) => account.eligible);
      if (eligibleRescan)
        return {
          settings: eligibleRescan.settings,
          signature: null,
          discovered: true,
        };
      if (!shouldReprepareCreation({ error, attempt, maxAttempts }))
        throw error;
      // A global Settings index may have been consumed between prepare and send.
      // Re-read ProgramConfig and build a fresh transaction; never replay bytes.
    }
  }
  throw lastError;
}
