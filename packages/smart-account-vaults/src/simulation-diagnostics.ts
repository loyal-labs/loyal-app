import {
  generated,
  pda,
  toBigInt,
} from "@loyal-labs/loyal-smart-accounts-core";
import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts-core";
import { PublicKey } from "@solana/web3.js";
import type { Connection, VersionedTransaction } from "@solana/web3.js";

const SQUADS_MISSING_ACCOUNT_ERROR_CODE = 0x1788;

type SimulationDiagnosticContext = {
  connection: Connection;
  logs: readonly string[];
  originalError: unknown;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  simulationErr: unknown;
  transaction: VersionedTransaction;
  translatedError: Error | null;
};

export type EarnPolicyCreateSimulationDiagnosticsMetadata = Readonly<{
  includedPolicyAccounts: readonly string[];
  kind: "earnPolicyCreateMissingAccount";
  policyAccount: string;
  policySeed: string;
  policyStage: "route" | "setup";
  programId: string;
  settingsPda: string;
}>;

function createErrorWithCause(args: {
  cause: unknown;
  logs?: readonly string[];
  message: string;
  name: string;
}): Error {
  const error = new Error(args.message);
  error.name = args.name;
  (error as Error & { cause?: unknown; logs?: readonly string[] }).cause =
    args.cause;
  if (args.logs) {
    (error as Error & { cause?: unknown; logs?: readonly string[] }).logs =
      args.logs;
  }
  return error;
}

function formatPubkeys(pubkeys: readonly string[]): string {
  return pubkeys.length > 0 ? pubkeys.join(", ") : "none";
}

function isEarnPolicyCreateMetadata(
  metadata: PreparedLoyalSmartAccountsOperation<string>["simulationDiagnostics"]
): metadata is EarnPolicyCreateSimulationDiagnosticsMetadata {
  return (
    !!metadata &&
    metadata.kind === "earnPolicyCreateMissingAccount" &&
    typeof metadata.policyAccount === "string" &&
    typeof metadata.policySeed === "string" &&
    typeof metadata.programId === "string" &&
    typeof metadata.settingsPda === "string" &&
    (metadata.policyStage === "route" || metadata.policyStage === "setup") &&
    Array.isArray(metadata.includedPolicyAccounts) &&
    metadata.includedPolicyAccounts.every(
      (account) => typeof account === "string"
    )
  );
}

export function simulationIndicatesMissingAccount(args: {
  logs: readonly string[];
  simulationErr: unknown;
  translatedError: Error | null;
}): boolean {
  if (args.translatedError?.name === "MissingAccount") {
    return true;
  }

  const haystack = [
    args.translatedError?.name,
    args.translatedError?.message,
    JSON.stringify(args.simulationErr),
    args.logs.join("\n"),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    /\bMissingAccount\b/i.test(haystack) ||
    /custom program error:\s*0x1788/i.test(haystack) ||
    new RegExp(`"Custom"\\s*:\\s*${SQUADS_MISSING_ACCOUNT_ERROR_CODE}`).test(
      haystack
    )
  );
}

function policyPdaForSeed(args: {
  policySeed: bigint;
  programId: PublicKey;
  settingsPda: PublicKey;
}): string | null {
  if (args.policySeed > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  return pda
    .getPolicyPda({
      programId: args.programId,
      settingsPda: args.settingsPda,
      policySeed: Number(args.policySeed),
    })[0]
    .toBase58();
}

async function fetchNextPolicySeed(args: {
  connection: Connection;
  settingsPda: PublicKey;
}): Promise<bigint | null> {
  if (typeof args.connection.getAccountInfo !== "function") {
    return null;
  }

  const account = await args.connection.getAccountInfo(
    args.settingsPda,
    "confirmed"
  );
  if (!account) {
    return null;
  }

  const [settings] = generated.Settings.fromAccountInfo({
    ...account,
    data: Buffer.from(account.data),
  });
  const currentPolicySeed =
    settings.policySeed == null ? BigInt(0) : toBigInt(settings.policySeed);
  return currentPolicySeed + BigInt(1);
}

async function getEarnPolicyCreateMissingAccountMessage(args: {
  connection: Connection;
  metadata: EarnPolicyCreateSimulationDiagnosticsMetadata;
}): Promise<string> {
  const settingsPda = new PublicKey(args.metadata.settingsPda);
  const programId = new PublicKey(args.metadata.programId);
  const policySeed = BigInt(args.metadata.policySeed);
  const policyDescription =
    args.metadata.policyStage === "setup" ? "setup policy" : "route policy";
  const includedAccounts = args.metadata.includedPolicyAccounts;
  const includedAccountSet = new Set(includedAccounts);
  const nextPolicySeed = await fetchNextPolicySeed({
    connection: args.connection,
    settingsPda,
  }).catch(() => null);

  if (nextPolicySeed != null) {
    const expectedPolicyPda = policyPdaForSeed({
      policySeed: nextPolicySeed,
      programId,
      settingsPda,
    });
    if (expectedPolicyPda && !includedAccountSet.has(expectedPolicyPda)) {
      return (
        `Squads could not find the policy account required by PolicyCreate. ` +
        `Missing policy account ${expectedPolicyPda} for expected next policy seed ${nextPolicySeed.toString()}. ` +
        `The prepared Earn ${policyDescription} action uses seed ${policySeed.toString()} ` +
        `and includes policy account(s): ${formatPubkeys(includedAccounts)}. ` +
        `This usually means the route/setup policy stage is stale or a resumed onboarding flow is sending the setup-policy transaction before the route policy exists on chain.`
      );
    }
  }

  if (!includedAccountSet.has(args.metadata.policyAccount)) {
    return (
      `Squads could not find the policy account required by PolicyCreate. ` +
      `Missing policy account ${
        args.metadata.policyAccount
      } for prepared ${policyDescription} seed ${policySeed.toString()}. ` +
      `The transaction includes policy account(s): ${formatPubkeys(
        includedAccounts
      )}.`
    );
  }

  return (
    `Squads reported MissingAccount while creating the prepared Earn ${policyDescription}. ` +
    `The transaction includes the action-derived policy PDA ${
      args.metadata.policyAccount
    } for seed ${policySeed.toString()}, ` +
    `so the most likely missing account is the current next policy PDA from on-chain settings. Refresh the Earn policy state and retry.`
  );
}

export async function getPreparedSimulationDiagnosticError(
  context: SimulationDiagnosticContext
): Promise<Error | null> {
  if (
    !simulationIndicatesMissingAccount({
      logs: context.logs,
      simulationErr: context.simulationErr,
      translatedError: context.translatedError,
    })
  ) {
    return null;
  }

  const metadata = context.prepared.simulationDiagnostics;
  if (!isEarnPolicyCreateMetadata(metadata)) {
    return null;
  }

  const message = await getEarnPolicyCreateMissingAccountMessage({
    connection: context.connection,
    metadata,
  });

  return createErrorWithCause({
    cause: context.originalError,
    logs: context.logs,
    message,
    name: "SquadsMissingAccountSimulationError",
  });
}
