import type { FlagDefinition, FlagEvaluationContext } from "./types";

export function evaluateFlag(
  flag: FlagDefinition,
  context: FlagEvaluationContext,
): boolean {
  if (!flag.enabled) return false;
  if (!flag.targetApps.includes(context.app)) return false;
  if (!flag.targetEnvironments.includes(context.environment)) return false;

  switch (flag.audience) {
    case "all":
      return true;
    case "public":
      return context.isTeam === false;
    case "team":
      return context.isTeam === true;
  }
}
