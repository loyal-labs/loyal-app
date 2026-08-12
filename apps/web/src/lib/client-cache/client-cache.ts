"use client";

export const CLIENT_REOPEN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type ClientCacheEnvelope<T> = {
  version: number;
  solanaEnv: string;
  walletAddress?: string | null;
  settingsPda?: string | null;
  savedAt: number;
  expiresAt: number;
  data: T;
};

type ClientCacheStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export function getClientCacheStorage(): ClientCacheStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type ClientCacheEntry<T> = {
  data: T;
  savedAt: number;
};

export function readClientCacheEntry<T>(args: {
  key: string;
  version: number;
  solanaEnv: string;
  walletAddress?: string | null;
  settingsPda?: string | null;
  now?: number;
  storage?: Pick<Storage, "getItem"> | null;
  validate?: (data: unknown) => data is T;
}): ClientCacheEntry<T> | null {
  const storage =
    args.storage === undefined ? getClientCacheStorage() : args.storage;
  if (!storage) {
    return null;
  }

  let raw: string | null = null;
  try {
    raw = storage.getItem(args.key);
  } catch {
    return null;
  }

  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  if (parsed.version !== args.version || parsed.solanaEnv !== args.solanaEnv) {
    return null;
  }

  if (
    args.walletAddress !== undefined &&
    parsed.walletAddress !== args.walletAddress
  ) {
    return null;
  }

  if (
    args.settingsPda !== undefined &&
    parsed.settingsPda !== args.settingsPda
  ) {
    return null;
  }

  const now = args.now ?? Date.now();
  if (typeof parsed.expiresAt !== "number" || parsed.expiresAt <= now) {
    return null;
  }

  if (!("data" in parsed)) {
    return null;
  }

  if (args.validate && !args.validate(parsed.data)) {
    return null;
  }

  if (typeof parsed.savedAt !== "number") {
    return null;
  }

  return {
    data: parsed.data as T,
    savedAt: parsed.savedAt,
  };
}

export function readClientCache<T>(args: {
  key: string;
  version: number;
  solanaEnv: string;
  walletAddress?: string | null;
  settingsPda?: string | null;
  now?: number;
  storage?: Pick<Storage, "getItem"> | null;
  validate?: (data: unknown) => data is T;
}): T | null {
  return readClientCacheEntry(args)?.data ?? null;
}

export function writeClientCache<T>(args: {
  key: string;
  version: number;
  solanaEnv: string;
  data: T;
  walletAddress?: string | null;
  settingsPda?: string | null;
  ttlMs?: number;
  now?: number;
  storage?: Pick<Storage, "setItem"> | null;
}) {
  const storage =
    args.storage === undefined ? getClientCacheStorage() : args.storage;
  if (!storage) {
    return;
  }

  const savedAt = args.now ?? Date.now();
  const envelope: ClientCacheEnvelope<T> = {
    version: args.version,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    settingsPda: args.settingsPda,
    savedAt,
    expiresAt: savedAt + (args.ttlMs ?? CLIENT_REOPEN_CACHE_TTL_MS),
    data: args.data,
  };

  try {
    storage.setItem(args.key, JSON.stringify(envelope));
  } catch {
    // Cache writes are best-effort only.
  }
}

export function removeClientCache(args: {
  key: string;
  storage?: Pick<Storage, "removeItem"> | null;
}) {
  const storage =
    args.storage === undefined ? getClientCacheStorage() : args.storage;
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(args.key);
  } catch {
    // Cache removal is best-effort only.
  }
}
