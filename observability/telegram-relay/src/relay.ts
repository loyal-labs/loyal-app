import { redactBotToken } from "./redact.ts";

export interface ClickStackWebhookPayload {
  eventId: string;
  state: string;
  title: string;
  body: string;
  link: string;
  startTime: number;
  endTime: number;
}

export type RelayOutcome =
  | "sent"
  | "suppressed"
  | "duplicate"
  | "resolved"
  | "deferred";

export interface RelayResult {
  outcome: RelayOutcome;
}

export type AlertMessageKind = "new" | "escalation" | "digest" | "restart";

/**
 * Everything the sender needs beyond the raw payload. `new` and `escalation`
 * carry the live window, `digest` the window being closed, and `restart` the
 * set of signatures that were already firing when the process came up.
 */
export interface AlertContext {
  kind: AlertMessageKind;
  window?: WindowSummary;
  windows?: WindowSummary[];
  /** Recaps are informational; they must not buzz every phone in the chat. */
  silent: boolean;
}

export type TelegramSender = (
  payload: ClickStackWebhookPayload,
  context: AlertContext
) => Promise<void>;

export interface SignatureSummary {
  count: number;
  service: string;
  severity: string;
  headline: string;
}

export interface WindowSummary {
  key: string;
  title: string;
  link: string;
  services: string[];
  openedAt: number;
  expiresAt: number;
  firstEventAt: number;
  lastEventAt: number;
  /** Matched log lines, as reported by ClickStack, summed over the window. */
  eventCount: number;
  /** Webhook deliveries that were answered without posting to Telegram. */
  suppressedAlerts: number;
  /**
   * Rows the relay could actually read. ClickStack truncates the row block, so
   * this falls below `eventCount` during a burst, and any per-row statistic
   * derived from it is a lower bound rather than an exact count.
   */
  sampledRows: number;
  signatures: SignatureSummary[];
  uniqueValues: Record<string, number>;
  buckets: number[];
  peakBucket: number;
  bucketMs: number;
}

/** One row's contribution, as read out of the ClickStack row block. */
export interface SignatureInput {
  key: string;
  service: string;
  severity: string;
  headline: string;
}

export interface AlertAnalysis {
  /** ClickStack's own matched-line count for this delivery. */
  eventCount: number;
  signatures: SignatureInput[];
  /** Column label to the distinct values seen in this delivery. */
  uniqueValues: Record<string, string[]>;
}

export type AlertAnalyzer = (
  payload: ClickStackWebhookPayload
) => AlertAnalysis;

export interface AlertRelayOptions {
  cooldownMs: number;
  idempotencyTtlMs: number;
  maxCacheEntries: number;
  now?: () => number;
  analyze?: AlertAnalyzer;
  /** Post a recap when a window closes having suppressed anything. */
  digestEnabled?: boolean;
  /**
   * Break the cooldown when volume grows by this factor, so an escalating
   * incident is not invisible for a whole window. `0` disables escalation.
   */
  escalationMultiplier?: number;
  /**
   * ClickStack re-fires every live alert seconds after the relay restarts. For
   * this long after boot, hold those alerts and post one recap instead of one
   * message per signature.
   */
  restartGraceMs?: number;
  startedAt?: number;
  /** Cap on how many sweeps will retry a recap that Telegram rejected. */
  maxFlushAttempts?: number;
}

/** Keeps a digest readable when a storm produces hundreds of distinct rows. */
const MAX_TRACKED_SIGNATURES = 20;
/** Distinct values retained per cardinality column, purely to bound memory. */
const MAX_TRACKED_VALUES = 500;
const BUCKET_COUNT = 6;
const MAX_ESCALATIONS_PER_WINDOW = 2;
const DEFAULT_MAX_FLUSH_ATTEMPTS = 5;

interface SignatureState {
  count: number;
  service: string;
  severity: string;
  headline: string;
}

interface AlertWindow {
  key: string;
  payload: ClickStackWebhookPayload;
  openedAt: number;
  expiresAt: number;
  firstEventAt: number;
  lastEventAt: number;
  eventCount: number;
  /** Events in the delivery that opened the window, the escalation baseline. */
  openingEventCount: number;
  suppressedAlerts: number;
  sampledRows: number;
  signatures: Map<string, SignatureState>;
  uniqueValues: Map<string, Set<string>>;
  buckets: number[];
  escalations: number;
  flushAttempts: number;
  /** Opened during the restart grace period and not yet recapped. */
  deferred: boolean;
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
  private readonly windows = new Map<string, AlertWindow>();
  private readonly idempotencyKeys: ExpiringCache;
  private readonly eventLocks = new Map<string, Promise<void>>();
  private readonly idempotencyLocks = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private readonly analyze: AlertAnalyzer;
  private readonly startedAt: number;
  private restartRecapDone: boolean;

  constructor(
    private readonly sender: TelegramSender,
    private readonly options: AlertRelayOptions
  ) {
    this.idempotencyKeys = new ExpiringCache(options.maxCacheEntries);
    this.now = options.now ?? Date.now;
    this.analyze = options.analyze ?? emptyAnalysis;
    this.startedAt = options.startedAt ?? this.now();
    this.restartRecapDone = (options.restartGraceMs ?? 0) <= 0;
  }

  async handle(
    payload: ClickStackWebhookPayload,
    idempotencyKey: string
  ): Promise<RelayResult> {
    return this.withLock(this.idempotencyLocks, idempotencyKey, async () => {
      const now = this.now();

      if (this.idempotencyKeys.has(idempotencyKey, now)) {
        return { outcome: "duplicate" as const };
      }

      // Recoveries are not actionable in chat and must not shorten the window
      // either: a flapping alert resolves and re-fires every evaluation
      // interval, so clearing it here would post that event on every cycle
      // instead of once per window.
      if (payload.state === "OK") {
        this.rememberIdempotencyKey(idempotencyKey, now);
        return { outcome: "resolved" as const };
      }

      const analysis = this.analyze(payload);
      const key = dedupKey(payload, analysis);

      return this.withLock(this.eventLocks, key, async () => {
        const existing = this.windows.get(key);

        // A window whose digest is still owed is flushed before the alert that
        // reopens it, so the recap can never arrive after the message it
        // summarizes.
        if (existing && existing.expiresAt <= now && !existing.deferred) {
          await this.flushWindow(existing);
        }

        const window = this.windows.get(key);
        if (!window) {
          const opened = openWindow(key, payload, analysis, now, this.options);

          if (this.inRestartGrace(now)) {
            opened.deferred = true;
            this.windows.set(key, opened);
            this.trimWindows(now);
            this.rememberIdempotencyKey(idempotencyKey, now);
            return { outcome: "deferred" as const };
          }

          // Registered only once Telegram has accepted. A failed send must
          // leave no window behind, or the retry would be suppressed as a
          // repeat of a message that was never delivered.
          await this.sender(payload, {
            kind: "new",
            window: summarize(opened),
            silent: false,
          });
          this.windows.set(key, opened);
          this.trimWindows(now);
          this.rememberIdempotencyKey(idempotencyKey, now);
          return { outcome: "sent" as const };
        }

        accumulate(window, payload, analysis, now);
        this.rememberIdempotencyKey(idempotencyKey, now);

        // The escalation is an extra notification inside an already-open
        // window, not part of ingest. Failing the webhook for it would be
        // worse than useless: the delivery is already counted, and ClickStack's
        // retry carries the same Idempotency-Key, so it would be answered as a
        // duplicate without ever resending the escalation. Swallowing the
        // failure and leaving `escalations` untouched makes the next
        // over-threshold delivery try again.
        if (!this.inRestartGrace(now) && this.shouldEscalate(window)) {
          await reportFailure("alert_escalation_failed", async () => {
            await this.sender(payload, {
              kind: "escalation",
              window: summarize(window),
              silent: false,
            });
            window.escalations += 1;
          });
        }

        return { outcome: "suppressed" as const };
      });
    });
  }

  /**
   * Posts whatever is due: the restart recap once the grace period is over,
   * then a digest for every window that has closed. A failed send is retried
   * on the next sweep rather than dropping the counters it carries.
   */
  async sweep(now = this.now()): Promise<void> {
    this.idempotencyKeys.evictExpired(now);
    await reportFailure("restart_recap_failed", () =>
      this.flushRestartRecap(now)
    );

    for (const [key, window] of [...this.windows]) {
      if (window.expiresAt > now || window.deferred) {
        continue;
      }
      // One undeliverable digest must not hold up the rest of the sweep; it is
      // retried on the next tick with its counters intact.
      await reportFailure("alert_digest_failed", () =>
        this.withLock(this.eventLocks, key, async () => {
          // `handle` may have flushed and replaced this window while the sweep
          // waited for the lock.
          if (this.windows.get(key) === window) {
            await this.flushWindow(window);
          }
        })
      );
    }
  }

  /**
   * O(1) per window and non-mutating, so the unauthenticated health route
   * cannot be used to force repeated full-cache sweeps. Counts may briefly
   * include entries that have expired but not yet been reclaimed.
   */
  stats(): {
    windows: number;
    idempotencyKeys: number;
    pendingDigests: number;
  } {
    let pendingDigests = 0;
    for (const window of this.windows.values()) {
      if (window.suppressedAlerts > 0) {
        pendingDigests += 1;
      }
    }

    return {
      windows: this.windows.size,
      idempotencyKeys: this.idempotencyKeys.size,
      pendingDigests,
    };
  }

  /** Serializable window state, for the optional restart snapshot. */
  exportState(now = this.now()): PersistedState {
    const windows: PersistedWindow[] = [];
    for (const window of this.windows.values()) {
      if (window.expiresAt > now) {
        windows.push(serializeWindow(window));
      }
    }
    return { version: STATE_VERSION, savedAt: now, windows };
  }

  /**
   * Restores windows saved before a restart. Entries that have already expired
   * are dropped, so a stale snapshot cannot mute a signature indefinitely.
   */
  importState(state: PersistedState, now = this.now()): number {
    if (state.version !== STATE_VERSION) {
      return 0;
    }

    let restored = 0;
    for (const saved of state.windows) {
      if (saved.expiresAt <= now || this.windows.has(saved.key)) {
        continue;
      }
      this.windows.set(saved.key, deserializeWindow(saved));
      restored += 1;
    }
    return restored;
  }

  private inRestartGrace(now: number): boolean {
    const grace = this.options.restartGraceMs ?? 0;
    return grace > 0 && now < this.startedAt + grace;
  }

  private async flushRestartRecap(now: number): Promise<void> {
    if (this.restartRecapDone || this.inRestartGrace(now)) {
      return;
    }

    const deferred = [...this.windows.values()].filter(
      (window) => window.deferred
    );
    if (deferred.length === 0) {
      this.restartRecapDone = true;
      return;
    }

    const newest = deferred.reduce((latest, window) =>
      window.lastEventAt >= latest.lastEventAt ? window : latest
    );
    await this.sender(newest.payload, {
      kind: "restart",
      windows: deferred.map(summarize),
      silent: true,
    });

    // Cleared only once Telegram has accepted, so a failed recap is retried on
    // the next sweep instead of leaving the post-deploy burst unreported.
    this.restartRecapDone = true;
    for (const window of deferred) {
      window.deferred = false;
    }
  }

  private async flushWindow(window: AlertWindow): Promise<void> {
    const digestable =
      (this.options.digestEnabled ?? true) && window.suppressedAlerts > 0;

    // Silence is the signal that nothing repeated: a window that suppressed
    // nothing closes without a message.
    if (!digestable) {
      this.windows.delete(window.key);
      return;
    }

    try {
      await this.sender(window.payload, {
        kind: "digest",
        window: summarize(window),
        silent: true,
      });
      this.windows.delete(window.key);
    } catch (error) {
      window.flushAttempts += 1;
      const maxAttempts =
        this.options.maxFlushAttempts ?? DEFAULT_MAX_FLUSH_ATTEMPTS;
      if (window.flushAttempts < maxAttempts) {
        throw error;
      }

      // Give up rather than retry forever: the window would otherwise pin the
      // signature silent, suppressing every later alert for it.
      this.windows.delete(window.key);
      console.error(
        JSON.stringify({
          event: "alert_digest_dropped",
          key: window.key,
          suppressedAlerts: window.suppressedAlerts,
          attempts: window.flushAttempts,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: redactBotToken(
            error instanceof Error ? error.message : String(error)
          ).slice(0, 300),
        })
      );
    }
  }

  private shouldEscalate(window: AlertWindow): boolean {
    const multiplier = this.options.escalationMultiplier ?? 0;
    if (multiplier <= 1 || window.escalations >= MAX_ESCALATIONS_PER_WINDOW) {
      return false;
    }

    const baseline = Math.max(window.openingEventCount, 1);
    return (
      window.eventCount >= baseline * multiplier ** (window.escalations + 1)
    );
  }

  /**
   * Windows are bounded like the other caches. Closed windows that owe nothing
   * go first, so a flood of new signatures cannot evict one still holding an
   * unsent digest.
   */
  private trimWindows(now: number): void {
    if (this.windows.size <= this.options.maxCacheEntries) {
      return;
    }

    for (const [key, window] of this.windows) {
      if (this.windows.size <= this.options.maxCacheEntries) {
        return;
      }
      if (window.expiresAt <= now && window.suppressedAlerts === 0) {
        this.windows.delete(key);
      }
    }

    for (const key of [...this.windows.keys()]) {
      if (this.windows.size <= this.options.maxCacheEntries) {
        return;
      }
      this.windows.delete(key);
    }
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

function emptyAnalysis(): AlertAnalysis {
  return { eventCount: 1, signatures: [], uniqueValues: {} };
}

/**
 * The sweep runs on a timer with nobody to return an error to, so a failed
 * send is logged and swallowed. State is left untouched for the next tick.
 */
async function reportFailure(
  event: string,
  action: () => Promise<void>
): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(
      JSON.stringify({
        event,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: redactBotToken(
          error instanceof Error ? error.message : String(error)
        ).slice(0, 300),
      })
    );
  }
}

/**
 * ClickStack groups alerts by service but sends a row block that is not
 * filtered to that group, so one incident arrives as several deliveries with
 * different `eventId`s and identical rows. Keying on the rows collapses those
 * into a single window. A delivery with no readable rows falls back to the
 * `eventId` and behaves exactly as it did before.
 */
export function dedupKey(
  payload: ClickStackWebhookPayload,
  analysis: AlertAnalysis
): string {
  if (analysis.signatures.length === 0) {
    return payload.eventId;
  }

  const signatures = [
    ...new Set(analysis.signatures.map((signature) => signature.key)),
  ].sort();
  return `${normalizeTitle(payload.title)}::${fnv1a(signatures.join("\n"))}`;
}

/** Drops the emoji and the matched-line count so only the alert name is left. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/\s*-\s*\d+\s+lines?\s+found\s*$/i, "")
    .replace(/[^\p{L}\p{N}\s"'._-]/gu, "")
    .trim()
    .toLowerCase();
}

function fnv1a(input: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function openWindow(
  key: string,
  payload: ClickStackWebhookPayload,
  analysis: AlertAnalysis,
  now: number,
  options: AlertRelayOptions
): AlertWindow {
  const window: AlertWindow = {
    key,
    payload,
    openedAt: now,
    expiresAt: now + options.cooldownMs,
    firstEventAt: now,
    lastEventAt: now,
    eventCount: 0,
    openingEventCount: Math.max(analysis.eventCount, 1),
    suppressedAlerts: 0,
    sampledRows: 0,
    signatures: new Map(),
    uniqueValues: new Map(),
    buckets: new Array<number>(BUCKET_COUNT).fill(0),
    escalations: 0,
    flushAttempts: 0,
    deferred: false,
  };
  record(window, payload, analysis, now);
  return window;
}

function accumulate(
  window: AlertWindow,
  payload: ClickStackWebhookPayload,
  analysis: AlertAnalysis,
  now: number
): void {
  window.suppressedAlerts += 1;
  record(window, payload, analysis, now);
}

function record(
  window: AlertWindow,
  payload: ClickStackWebhookPayload,
  analysis: AlertAnalysis,
  now: number
): void {
  const events = Math.max(analysis.eventCount, 1);

  window.payload = payload;
  window.lastEventAt = now;
  window.eventCount += events;
  window.sampledRows += analysis.signatures.length;
  window.buckets[bucketIndex(window, now)] += events;

  for (const signature of analysis.signatures) {
    const existing = window.signatures.get(signature.key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    if (window.signatures.size >= MAX_TRACKED_SIGNATURES) {
      continue;
    }
    window.signatures.set(signature.key, {
      count: 1,
      service: signature.service,
      severity: signature.severity,
      headline: signature.headline,
    });
  }

  for (const [label, values] of Object.entries(analysis.uniqueValues)) {
    let seen = window.uniqueValues.get(label);
    if (!seen) {
      seen = new Set<string>();
      window.uniqueValues.set(label, seen);
    }
    for (const value of values) {
      if (seen.size >= MAX_TRACKED_VALUES) {
        break;
      }
      seen.add(value);
    }
  }
}

function bucketMsOf(window: AlertWindow): number {
  return Math.max(
    Math.floor((window.expiresAt - window.openedAt) / BUCKET_COUNT),
    1
  );
}

function bucketIndex(window: AlertWindow, now: number): number {
  const index = Math.floor((now - window.openedAt) / bucketMsOf(window));
  return Math.min(Math.max(index, 0), BUCKET_COUNT - 1);
}

function summarize(window: AlertWindow): WindowSummary {
  const signatures = [...window.signatures.values()].sort(
    (left, right) => right.count - left.count
  );
  const uniqueValues: Record<string, number> = {};
  for (const [label, values] of window.uniqueValues) {
    uniqueValues[label] = values.size;
  }

  return {
    key: window.key,
    title: window.payload.title,
    link: window.payload.link,
    services: [
      ...new Set(
        signatures.map((signature) => signature.service).filter(Boolean)
      ),
    ],
    openedAt: window.openedAt,
    expiresAt: window.expiresAt,
    firstEventAt: window.firstEventAt,
    lastEventAt: window.lastEventAt,
    eventCount: window.eventCount,
    suppressedAlerts: window.suppressedAlerts,
    sampledRows: window.sampledRows,
    signatures,
    uniqueValues,
    buckets: [...window.buckets],
    peakBucket: window.buckets.indexOf(Math.max(...window.buckets)),
    bucketMs: bucketMsOf(window),
  };
}

const STATE_VERSION = 1;

export interface PersistedWindow {
  key: string;
  payload: ClickStackWebhookPayload;
  openedAt: number;
  expiresAt: number;
  firstEventAt: number;
  lastEventAt: number;
  eventCount: number;
  openingEventCount: number;
  suppressedAlerts: number;
  sampledRows: number;
  signatures: (SignatureState & { key: string })[];
  uniqueValues: Record<string, string[]>;
  buckets: number[];
  escalations: number;
}

export interface PersistedState {
  version: number;
  savedAt: number;
  windows: PersistedWindow[];
}

function serializeWindow(window: AlertWindow): PersistedWindow {
  const uniqueValues: Record<string, string[]> = {};
  for (const [label, values] of window.uniqueValues) {
    uniqueValues[label] = [...values];
  }

  return {
    key: window.key,
    payload: window.payload,
    openedAt: window.openedAt,
    expiresAt: window.expiresAt,
    firstEventAt: window.firstEventAt,
    lastEventAt: window.lastEventAt,
    eventCount: window.eventCount,
    openingEventCount: window.openingEventCount,
    suppressedAlerts: window.suppressedAlerts,
    sampledRows: window.sampledRows,
    signatures: [...window.signatures].map(([key, state]) => ({
      key,
      ...state,
    })),
    uniqueValues,
    buckets: [...window.buckets],
    escalations: window.escalations,
  };
}

function deserializeWindow(saved: PersistedWindow): AlertWindow {
  const signatures = new Map<string, SignatureState>();
  for (const { key, ...state } of saved.signatures) {
    signatures.set(key, state);
  }

  const uniqueValues = new Map<string, Set<string>>();
  for (const [label, values] of Object.entries(saved.uniqueValues)) {
    uniqueValues.set(label, new Set(values));
  }

  return {
    key: saved.key,
    payload: saved.payload,
    openedAt: saved.openedAt,
    expiresAt: saved.expiresAt,
    firstEventAt: saved.firstEventAt,
    lastEventAt: saved.lastEventAt,
    eventCount: saved.eventCount,
    openingEventCount: saved.openingEventCount,
    suppressedAlerts: saved.suppressedAlerts,
    sampledRows: saved.sampledRows,
    signatures,
    uniqueValues,
    buckets: [...saved.buckets],
    escalations: saved.escalations,
    flushAttempts: 0,
    deferred: false,
  };
}
