import { evaluateFlag } from "./evaluate-flag.js";
import type { FlagDefinition, FlagEvaluationContext } from "./types.js";

export function evaluateFlags(
  flags: FlagDefinition[],
  context: FlagEvaluationContext,
): Record<string, boolean> {
  return Object.fromEntries(
    flags.map((flag) => [flag.key, evaluateFlag(flag, context)]),
  );
}
