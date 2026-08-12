import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { DEFAULT_STORAGE_DIR } from "./env";

function normalizeStorageDir(storageDir: string | undefined): string {
  const normalized = storageDir?.trim();
  if (!normalized) {
    return resolve(DEFAULT_STORAGE_DIR);
  }

  return resolve(normalized);
}

export function resolveStorageDir(
  storageDir: string | undefined = process.env.USERBOT_STORAGE_DIR
): string {
  return normalizeStorageDir(storageDir);
}

export function resolveSessionSqlitePath(
  accountKey: string,
  storageDir: string | undefined = process.env.USERBOT_STORAGE_DIR
): string {
  return join(resolveStorageDir(storageDir), `mtcute-${accountKey}.sqlite`);
}

export async function ensureStorageReady(
  storageDir: string | undefined = process.env.USERBOT_STORAGE_DIR
): Promise<string> {
  const resolved = resolveStorageDir(storageDir);
  await mkdir(resolved, { recursive: true });
  return resolved;
}
