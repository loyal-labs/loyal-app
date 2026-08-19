import { generated } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

type SecurityValue =
  | boolean
  | number
  | string
  | null
  | readonly SecurityValue[]
  | { readonly [key: string]: SecurityValue };

export type ProgramInteractionSpendingLimitSecurity = {
  accumulateUnused: boolean;
  enforceExactQuantity: boolean;
  expiration: string | null;
  maxPerPeriod: string;
  maxPerUse: string;
  mint: string;
  period: SecurityValue;
};

export type ProgramInteractionPolicySecurity = {
  accountIndex: number;
  instructionsConstraints: SecurityValue;
  postHook: SecurityValue;
  preHook: SecurityValue;
  spendingLimits: readonly ProgramInteractionSpendingLimitSecurity[];
};

type ProgramInteractionPolicyInput =
  | generated.PolicyCreationPayload
  | generated.PolicyState;

function integerString(value: unknown): string {
  if (BN.isBN(value)) {
    return value.toString(10);
  }
  if (typeof value === "bigint" || typeof value === "number") {
    return value.toString();
  }
  throw new Error("ProgramInteraction policy contains an invalid integer.");
}

function securityValue(value: unknown): SecurityValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        "ProgramInteraction policy contains a non-finite number."
      );
    }
    return value;
  }
  if (typeof value === "bigint" || BN.isBN(value)) {
    return integerString(value);
  }
  if (value instanceof PublicKey) {
    return value.toBase58();
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) {
    return value.map(securityValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, securityValue(entry)])
    );
  }
  throw new Error("ProgramInteraction policy contains an unsupported value.");
}

export function projectProgramInteractionPolicySecurity(
  policy: ProgramInteractionPolicyInput
): ProgramInteractionPolicySecurity {
  if (policy.__kind !== "ProgramInteraction" || policy.fields.length !== 1) {
    throw new Error("Expected one ProgramInteraction policy payload.");
  }
  const [interaction] = policy.fields;
  const spendingLimits = interaction.spendingLimits.map((limit) => {
    const time = limit.timeConstraints as typeof limit.timeConstraints & {
      accumulateUnused?: boolean;
    };
    const quantity =
      limit.quantityConstraints as typeof limit.quantityConstraints & {
        enforceExactQuantity?: boolean;
        maxPerUse?: unknown;
      };
    return {
      accumulateUnused: time.accumulateUnused ?? false,
      enforceExactQuantity: quantity.enforceExactQuantity ?? false,
      expiration:
        time.expiration === null ? null : integerString(time.expiration),
      maxPerPeriod: integerString(quantity.maxPerPeriod),
      maxPerUse:
        quantity.maxPerUse === undefined
          ? "0"
          : integerString(quantity.maxPerUse),
      mint: limit.mint.toBase58(),
      period: securityValue(time.period),
    } satisfies ProgramInteractionSpendingLimitSecurity;
  });
  spendingLimits.sort((left, right) => left.mint.localeCompare(right.mint));

  return {
    accountIndex: interaction.accountIndex,
    instructionsConstraints: securityValue(interaction.instructionsConstraints),
    postHook: securityValue(interaction.postHook),
    preHook: securityValue(interaction.preHook),
    spendingLimits,
  };
}

export function programInteractionPolicySecurityEquals(
  left: ProgramInteractionPolicyInput,
  right: ProgramInteractionPolicyInput
): boolean {
  return (
    JSON.stringify(projectProgramInteractionPolicySecurity(left)) ===
    JSON.stringify(projectProgramInteractionPolicySecurity(right))
  );
}
