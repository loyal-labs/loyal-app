import { evaluateFlag } from "./evaluate-flag";
import type { FlagDefinition, FlagEvaluationContext } from "./types";

export function evaluateFlags(
  flags: FlagDefinition[],
  context: FlagEvaluationContext,
): Record<string, boolean> {
  return Object.fromEntries(
    flags.map((flag) => [flag.key, evaluateFlag(flag, context)]),
  );
}
