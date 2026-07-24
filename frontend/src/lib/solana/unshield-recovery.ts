import type { ShieldFlowExecutionResult } from "@loyal-labs/private-transactions";

export type UnshieldAttemptStage =
  | "read-deposit"
  | "build-plan"
  | "execute-plan"
  | "confirm-base";

type DepositAmountAccount = {
  amount: {
    toString(): string;
  };
};

export class UnshieldAttemptError extends Error {
  readonly cause: unknown;
  readonly stage: UnshieldAttemptStage;

  constructor(stage: UnshieldAttemptStage, message: string, cause?: unknown) {
    super(message);
    this.name = "UnshieldAttemptError";
    this.stage = stage;
    this.cause = cause;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "Unknown error";
}

function getNestedErrorText(error: unknown): string {
  if (error instanceof Error) {
    const cause =
      "cause" in error
        ? getNestedErrorText((error as Error & { cause?: unknown }).cause)
        : "";
    return `${error.name} ${error.message} ${cause}`.trim();
  }

  return typeof error === "string" ? error : "";
}

export function isRetryableUnshieldError(error: unknown): boolean {
  const errorText = getNestedErrorText(error);
  if (/user rejected/i.test(errorText)) {
    return false;
  }

  const transientPatterns = [
    /failed to fetch|fetch failed/i,
    /network(?:error| request failed)/i,
    /socket (?:closed|hang up|not connected)/i,
    /\b(?:econnreset|econnrefused|enotfound|err_socket_not_connected|err_connection_refused)\b/i,
    /cors/i,
    /connection (?:closed|refused|reset|timed out)/i,
    /\btimeout(?:error)?\b|\btimed out\b/i,
    /websocket .*failed/i,
    /rpc .*?(?:transport|unavailable|timeout)/i,
    /(?:http|status) (?:408|425|429|500|502|503|504)\b/i,
    /too many requests|service unavailable|gateway timeout/i,
  ];

  return transientPatterns.some((pattern) => pattern.test(errorText));
}

async function runStage<T>(
  stage: UnshieldAttemptStage,
  description: string,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof UnshieldAttemptError) {
      throw error;
    }

    throw new UnshieldAttemptError(
      stage,
      `${description}: ${getErrorMessage(error)}`,
      error
    );
  }
}

export async function readDepositAmountFailClosed(args: {
  readEphemeral: () => Promise<DepositAmountAccount | null>;
  readBase: () => Promise<DepositAmountAccount | null>;
}): Promise<bigint> {
  const [ephemeralRead, baseRead] = await Promise.allSettled([
    args.readEphemeral(),
    args.readBase(),
  ]);

  if (ephemeralRead.status === "fulfilled" && ephemeralRead.value) {
    return BigInt(ephemeralRead.value.amount.toString());
  }
  if (baseRead.status === "fulfilled" && baseRead.value) {
    return BigInt(baseRead.value.amount.toString());
  }
  if (ephemeralRead.status === "fulfilled" && baseRead.status === "fulfilled") {
    return BigInt(0);
  }

  const failure =
    ephemeralRead.status === "rejected"
      ? ephemeralRead.reason
      : baseRead.status === "rejected"
      ? baseRead.reason
      : undefined;
  throw failure instanceof Error
    ? failure
    : new Error("Could not read the current shielded balance");
}

export function getConfirmedBaseUnshieldSignature(
  result: ShieldFlowExecutionResult
): string {
  const confirmedBaseTransaction = result.signatures.findLast(
    (entry) =>
      entry.cluster === "base" &&
      entry.label === "unshield" &&
      entry.signature.trim().length > 0
  );

  if (!confirmedBaseTransaction) {
    throw new UnshieldAttemptError(
      "confirm-base",
      "Unshield did not return a confirmed base-layer signature"
    );
  }

  return confirmedBaseTransaction.signature;
}

export async function runConfirmedUnshieldAttempt<TPlan>(args: {
  resolveAmount: () => Promise<bigint>;
  buildPlan: (amount: bigint) => Promise<TPlan>;
  executePlan: (plan: TPlan) => Promise<ShieldFlowExecutionResult>;
}): Promise<{
  amount: bigint;
  executionResult: ShieldFlowExecutionResult;
  signature: string;
}> {
  const amount = await runStage(
    "read-deposit",
    "Could not read the current shielded balance",
    args.resolveAmount
  );
  if (amount <= BigInt(0)) {
    throw new UnshieldAttemptError(
      "read-deposit",
      "No shielded balance is available to unshield"
    );
  }

  const plan = await runStage(
    "build-plan",
    "Could not prepare the unshield transaction",
    () => args.buildPlan(amount)
  );
  const executionResult = await runStage(
    "execute-plan",
    "Could not execute the unshield transaction",
    () => args.executePlan(plan)
  );
  const signature = getConfirmedBaseUnshieldSignature(executionResult);

  return { amount, executionResult, signature };
}
