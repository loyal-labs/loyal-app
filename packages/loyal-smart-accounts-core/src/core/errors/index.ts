import { initCusper } from "@metaplex-foundation/cusper";
import type { ErrorWithLogs } from "@metaplex-foundation/cusper";
export * from "../../generated/errors/index.js";
import { errorFromCode } from "../../generated/index.js";

export class LoyalSmartAccountsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoyalSmartAccountsError";
  }
}

export class MissingOperationConnectionError extends LoyalSmartAccountsError {
  constructor(operation: string) {
    super(
      `Operation "${operation}" requires a Solana connection during prepare, but no connection was provided.`
    );
    this.name = "MissingOperationConnectionError";
  }
}

export class MissingRequiredSignerError extends LoyalSmartAccountsError {
  constructor(operation: string, role: string) {
    super(
      `Operation "${operation}" requires a signer for role "${role}" when sending through the bound client.`
    );
    this.name = "MissingRequiredSignerError";
  }
}

export class InvalidRoleResolutionError extends LoyalSmartAccountsError {
  constructor(operation: string, role: string) {
    super(
      `Operation "${operation}" could not resolve a PublicKey for required role "${role}".`
    );
    this.name = "InvalidRoleResolutionError";
  }
}

export class InvalidPayloadError extends LoyalSmartAccountsError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPayloadError";
  }
}

export class MissingLookupTableAccountError extends LoyalSmartAccountsError {
  constructor(address: string, detail?: string) {
    super(
      detail
        ? `Address lookup table account ${address} ${detail}`
        : `Address lookup table account ${address} not found.`
    );
    this.name = "MissingLookupTableAccountError";
  }
}

export class OperationRegistryCoverageError extends LoyalSmartAccountsError {
  constructor(message: string) {
    super(message);
    this.name = "OperationRegistryCoverageError";
  }
}

export class SolanaTransactionLogError extends LoyalSmartAccountsError {
  readonly logs: string[];

  constructor(message: string, logs: string[]) {
    super(message);
    this.name = "SolanaTransactionLogError";
    this.logs = logs;
  }
}

const cusper = initCusper(errorFromCode);
const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";
const LAMPORTS_PER_SOL = 1_000_000_000n;

function formatLamports(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = lamports % LAMPORTS_PER_SOL;

  if (fraction === 0n) {
    return `${whole.toString()} SOL`;
  }

  const fractionText = fraction.toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionText} SOL`;
}

function getInsufficientLamportsError(
  logs: string[]
): SolanaTransactionLogError | null {
  for (const log of logs) {
    const match = log.match(
      /Transfer: insufficient lamports (\d+), need (\d+)/
    );
    if (!match) {
      continue;
    }

    const availableLamports = BigInt(match[1]);
    const neededLamports = BigInt(match[2]);
    const shortfallLamports = neededLamports - availableLamports;

    return new SolanaTransactionLogError(
      `Insufficient SOL to pay transaction rent or fees at the failing instruction. ` +
        `Available: ${formatLamports(
          availableLamports
        )} (${availableLamports.toString()} lamports). ` +
        `Needed: ${formatLamports(
          neededLamports
        )} (${neededLamports.toString()} lamports). ` +
        `Top up at least ${formatLamports(
          shortfallLamports
        )} plus network fees and retry.`,
      logs
    );
  }

  return null;
}

function getAccountAlreadyInUseError(
  logs: string[]
): SolanaTransactionLogError | null {
  const alreadyInUseLog = logs.find((log) =>
    /\balready in use\b|\balready initialized\b/i.test(log)
  );

  if (!alreadyInUseLog) {
    return null;
  }

  return new SolanaTransactionLogError(
    `Account initialization failed because the target account is already in use. ` +
      `This create flow is one-shot; refresh the on-chain transaction index and retry with the next PDA, ` +
      `or close the existing account first if the program permits it. Runtime log: ${alreadyInUseLog}`,
    logs
  );
}

function getSystemProgramError(
  logs: string[]
): SolanaTransactionLogError | null {
  const systemProgramFailure = logs.find((log) =>
    log.startsWith(`Program ${SYSTEM_PROGRAM_ADDRESS} failed:`)
  );

  if (!systemProgramFailure) {
    return null;
  }

  const reason = systemProgramFailure
    .replace(`Program ${SYSTEM_PROGRAM_ADDRESS} failed:`, "")
    .trim();

  return new SolanaTransactionLogError(
    `System Program failed while processing the transaction: ${reason}. ` +
      `Check the preceding simulation logs for the operation that failed.`,
    logs
  );
}

function getHumanReadableRuntimeError(
  logs: string[]
): SolanaTransactionLogError | null {
  return (
    getInsufficientLamportsError(logs) ??
    getAccountAlreadyInUseError(logs) ??
    getSystemProgramError(logs)
  );
}

export function translateAndThrowAnchorError(err: unknown): never {
  if (!isErrorWithLogs(err)) {
    throw err;
  }

  const translatedError =
    getHumanReadableRuntimeError(err.logs) ??
    cusper.errorFromProgramLogs(err.logs) ??
    err;

  if (typeof Error.captureStackTrace === "function") {
    Error.captureStackTrace(translatedError, translateAndThrowAnchorError);
  }

  if (translatedError !== err) {
    try {
      (translatedError as unknown as ErrorWithLogs).logs = err.logs;
    } catch {
      // Some error types (e.g. web3.js SendTransactionError) expose `logs` as
      // a getter-only accessor; assigning would throw a TypeError that masks
      // the real error. Such errors already carry their own logs.
    }
  }

  throw translatedError;
}

export const isErrorWithLogs = (err: unknown): err is ErrorWithLogs => {
  return Boolean(
    err && typeof err === "object" && "logs" in err && Array.isArray(err.logs)
  );
};
