const DECIMAL_CURSOR_PATTERN = /^\d+$/;

export type EarnRealtimeCursorStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

const memoryCursors = new Map<string, string>();
const primaryCursorTombstones = new Set<string>();

function isCursor(value: string | null): value is string {
  return value !== null && DECIMAL_CURSOR_PATTERN.test(value);
}

function latestCursor(
  left: string | null,
  right: string | null
): string | null {
  if (!isCursor(left)) return isCursor(right) ? right : null;
  if (!isCursor(right)) return left;
  return BigInt(left) >= BigInt(right) ? left : right;
}

export function earnRealtimeCursorStorageKey(identity: {
  earnVaultAddress: string;
  settingsPda: string;
  solanaEnv: string;
  walletAddress: string;
}): string {
  return [
    "loyal:earn-realtime-cursor:v1",
    identity.solanaEnv,
    identity.walletAddress,
    identity.settingsPda,
    identity.earnVaultAddress,
  ].join(":");
}

export class SafeEarnRealtimeCursorStore {
  constructor(
    private readonly key: string,
    private readonly primary: EarnRealtimeCursorStorage | null,
    private readonly memory: Map<string, string> = memoryCursors
  ) {}

  get(): string | null {
    let primaryCursor: string | null = null;
    if (!primaryCursorTombstones.has(this.key)) {
      try {
        const stored = this.primary?.getItem(this.key) ?? null;
        primaryCursor = isCursor(stored) ? stored : null;
      } catch {
        // Browser storage can be unavailable even when the property exists.
      }
    }

    const cursor = latestCursor(
      primaryCursor,
      this.memory.get(this.key) ?? null
    );
    if (cursor) {
      this.memory.set(this.key, cursor);
    }
    return cursor;
  }

  acknowledge(cursor: string): void {
    if (!isCursor(cursor)) return;
    const next = latestCursor(this.get(), cursor);
    if (!next) return;

    this.memory.set(this.key, next);
    if (!this.primary) return;
    try {
      this.primary.setItem(this.key, next);
      primaryCursorTombstones.delete(this.key);
    } catch {
      // The identity-scoped in-memory cursor remains authoritative this session.
      primaryCursorTombstones.add(this.key);
    }
  }

  clear(): void {
    this.memory.delete(this.key);
    if (!this.primary) {
      primaryCursorTombstones.add(this.key);
      return;
    }
    try {
      this.primary.removeItem(this.key);
      primaryCursorTombstones.delete(this.key);
    } catch {
      // Keep the tombstone across hook unmount/remount so a readable-but-not-
      // removable stale cursor cannot be resurrected by a new store instance.
      primaryCursorTombstones.add(this.key);
    }
  }
}

export function createEarnRealtimeCursorStore(
  key: string
): SafeEarnRealtimeCursorStore {
  let primary: EarnRealtimeCursorStorage | null = null;
  try {
    primary = globalThis.sessionStorage;
  } catch {
    // Use the module-local identity-scoped fallback.
  }
  return new SafeEarnRealtimeCursorStore(key, primary);
}
