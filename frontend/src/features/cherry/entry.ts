export const CHERRY_ENTRY_PATH = "/app/cherry";

export function isCherryEntryPath(pathname: string): boolean {
  return pathname === CHERRY_ENTRY_PATH;
}
