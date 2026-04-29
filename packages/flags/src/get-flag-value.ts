export function getFlagValue(
  evaluatedFlags: Record<string, boolean>,
  key: string,
): boolean {
  return evaluatedFlags[key] ?? false;
}
