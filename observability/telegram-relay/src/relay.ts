export interface ClickStackWebhookPayload {
  eventId: string;
  state: string;
  title: string;
  body: string;
  link: string;
  startTime: number;
  endTime: number;
}

export type RelayOutcome = "sent" | "suppressed" | "duplicate" | "resolved";

export interface RelayResult {
  outcome: RelayOutcome;
}

export type TelegramSender = (
  payload: ClickStackWebhookPayload
) => Promise<void>;

export interface AlertRelayOptions {
  cooldownMs: number;
  idempotencyTtlMs: number;
  maxCacheEntries: number;
  now?: () => number;
}

class ExpiringCache {
  private readonly entries = new Map<string, number>();

  constructor(private readonly maxEntries: number) {}

  has(key: string, now: number): boolean {
    const expiresAt = this.entries.get(key);
    if (expiresAt === undefined) {
      return false;
    }

    if (expiresAt <= now) {
      this.entries.delete(key);
      return false;
    }

    return true;
  }

  set(key: string, expiresAt: number, now: number): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      this.evictExpired(now);
    }

    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.delete(key);
    this.entries.set(key, expiresAt);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /**
   * Full O(n) sweep. Kept off the request path: `has` expires entries lazily,
   * and the periodic timer reclaims whatever is never read again.
   */
  evictExpired(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export class AlertRelay {
  private readonly cooldowns: ExpiringCache;
  private readonly idempotencyKeys: ExpiringCache;
  private readonly eventLocks = new Map<string, Promise<void>>();
  private readonly idempotencyLocks = new Map<string, Promise<void>>();
  private readonly now: () => number;

  constructor(
    private readonly sender: TelegramSender,
    private readonly options: AlertRelayOptions
  ) {
    this.cooldowns = new ExpiringCache(options.maxCacheEntries);
    this.idempotencyKeys = new ExpiringCache(options.maxCacheEntries);
    this.now = options.now ?? Date.now;
  }

  async handle(
    payload: ClickStackWebhookPayload,
    idempotencyKey: string
  ): Promise<RelayResult> {
    return this.withLock(this.idempotencyLocks, idempotencyKey, () =>
      this.withLock(this.eventLocks, payload.eventId, async () => {
        const now = this.now();

        if (this.idempotencyKeys.has(idempotencyKey, now)) {
          return { outcome: "duplicate" };
        }

        // Recoveries are not actionable in chat and must not shorten the
        // cooldown either: a flapping alert resolves and re-fires every
        // evaluation interval, so clearing it here would post that event on
        // every cycle instead of once per cooldown.
        if (payload.state === "OK") {
          this.rememberIdempotencyKey(idempotencyKey, now);
          return { outcome: "resolved" };
        }

        if (this.cooldowns.has(payload.eventId, now)) {
          this.rememberIdempotencyKey(idempotencyKey, now);
          return { outcome: "suppressed" };
        }

        await this.sender(payload);
        this.cooldowns.set(payload.eventId, now + this.options.cooldownMs, now);
        this.rememberIdempotencyKey(idempotencyKey, now);
        return { outcome: "sent" };
      })
    );
  }

  cleanup(now = this.now()): void {
    this.cooldowns.evictExpired(now);
    this.idempotencyKeys.evictExpired(now);
  }

  /**
   * O(1) and non-mutating, so the unauthenticated health route cannot be used
   * to force repeated full-cache sweeps. Counts may briefly include entries
   * that have expired but not yet been reclaimed.
   */
  stats(): { cooldowns: number; idempotencyKeys: number } {
    return {
      cooldowns: this.cooldowns.size,
      idempotencyKeys: this.idempotencyKeys.size,
    };
  }

  private rememberIdempotencyKey(key: string, now: number): void {
    this.idempotencyKeys.set(key, now + this.options.idempotencyTtlMs, now);
  }

  private async withLock<T>(
    locks: Map<string, Promise<void>>,
    key: string,
    action: () => Promise<T>
  ): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    locks.set(key, tail);

    // `await previous` sits inside the try so that a rejection can never skip
    // `release()` and strand every later waiter on this key.
    try {
      await previous;
      return await action();
    } finally {
      release();
      if (locks.get(key) === tail) {
        locks.delete(key);
      }
    }
  }
}
