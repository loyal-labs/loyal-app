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

const cusper = initCusper(errorFromCode);

export function translateAndThrowAnchorError(err: unknown): never {
  if (!isErrorWithLogs(err)) {
    throw err;
  }

  const translatedError = cusper.errorFromProgramLogs(err.logs) ?? err;

  if (typeof Error.captureStackTrace === "function") {
    Error.captureStackTrace(translatedError, translateAndThrowAnchorError);
  }

  (translatedError as unknown as ErrorWithLogs).logs = err.logs;

  throw translatedError;
}

export const isErrorWithLogs = (err: unknown): err is ErrorWithLogs => {
  return Boolean(
    err && typeof err === "object" && "logs" in err && Array.isArray(err.logs)
  );
};
