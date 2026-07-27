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

export type AlertMessageKind = "new" | "escalation" | "daily" | "restart";

/**
 * Everything the sender needs beyond the raw payload. `new` and `escalation`
 * carry the live window, `daily` the tally for the reporting period, and
 * `restart` the set of signatures that were already firing when the process
 * came up.
 */
export interface AlertContext {
  kind: AlertMessageKind;
  window?: WindowSummary;
  windows?: WindowSummary[];
  daily?: DailySummary;
  /** Recaps are informational; they must not buzz every phone in the chat. */
  silent: boolean;
}

/** One error signature's frequency over the reporting period. */
export interface DailySignatureSummary {
  count: number;
  service: string;
  headline: string;
  firstAt: number;
  lastAt: number;
}

export interface DailySummary {
  /** Start of the period being reported. */
  since: number;
  until: number;
  /** Matched log lines over the period, deduplicated per evaluation range. */
  eventCount: number;
  /**
   * Rows the relay could actually read over the period. Below `eventCount`
   * whenever ClickStack truncated a row block, which makes every per-row
   * statistic a lower bound rather than a total.
   */
  sampledRows: number;
  /** Webhook deliveries ClickStack made over the period. */
  deliveries: number;
  /** Alerts posted to the chat over the period, recaps excluded. */
  alertsPosted: number;
  signatures: DailySignatureSummary[];
  /** Signatures dropped from `signatures` because the tally is bounded. */
  omittedSignatures: number;
  uniqueValues: Record<string, number>;
  /** Columns whose value set hit its cap, so their count is a floor. */
  cappedValues: string[];
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
  /** Matched log lines across distinct ClickStack evaluation ranges. */
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
  /**
   * Columns whose value set hit its cap, so their count is a floor. Separate
   * from the truncation `sampledRows` reveals: a column can be capped even
   * when every row ClickStack sent was read.
   */
  cappedValues: string[];
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
  /**
   * Post one recap per day listing every signature and how often it fired.
   * Windows themselves always close silently: a per-window recap repeated what
   * its own opening alert had already said, and half of them summarized a
   * single suppressed delivery.
   */
  dailyRecapEnabled?: boolean;
  /** Minutes past UTC midnight at which the daily recap is posted. */
  dailyRecapAtMinutes?: number;
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

const DEFAULT_DAILY_RECAP_AT_MINUTES = 6 * 60;
const DAY_MS = 86_400_000;

/** Keeps a window readable when a storm produces hundreds of distinct rows. */
const MAX_TRACKED_SIGNATURES = 20;
/**
 * A day sees far more distinct signatures than one window, and the recap is
 * the only place they are reported now, so the daily tally is allowed to hold
 * many more of them than a window is.
 */
const MAX_DAILY_SIGNATURES = 200;
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

interface DailySignatureState extends SignatureState {
  firstAt: number;
  lastAt: number;
}

/**
 * Counts every signature seen since the last recap, independently of windows.
 * Windows exist to decide what to post right now; this exists to report what
 * happened, so an error that never repeated still shows up with a count of 1.
 */
interface DailyTally {
  since: number;
  eventCount: number;
  sampledRows: number;
  deliveries: number;
  alertsPosted: number;
  signatures: Map<string, DailySignatureState>;
  uniqueValues: Map<string, Set<string>>;
  /** Cardinality columns whose distinct-value set hit its cap. */
  cappedValues: Set<string>;
  omittedSignatures: Set<string>;
  /** Most recent delivery counted, used as the recap's link target. */
  lastPayload?: ClickStackWebhookPayload;
}

function emptyTally(since: number): DailyTally {
  return {
    since,
    eventCount: 0,
    sampledRows: 0,
    deliveries: 0,
    alertsPosted: 0,
    signatures: new Map(),
    uniqueValues: new Map(),
    cappedValues: new Set(),
    omittedSignatures: new Set(),
  };
}

interface AlertWindow {
  key: string;
  payload: ClickStackWebhookPayload;
  openedAt: number;
  expiresAt: number;
  firstEventAt: number;
  lastEventAt: number;
  eventCount: number;
  /** Highest matched-line snapshot seen for each ClickStack evaluation range. */
  evaluationCounts: Map<string, number>;
  /** Highest matched-line count reported by one evaluation. */
  peakEvaluationEventCount: number;
  /** Events in the delivery that opened the window, the escalation baseline. */
  openingEventCount: number;
  suppressedAlerts: number;
  sampledRows: number;
  signatures: Map<string, SignatureState>;
  uniqueValues: Map<string, Set<string>>;
  /** Cardinality columns whose distinct-value set hit its cap. */
  cappedValues: Set<string>;
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
  private daily: DailyTally;
  private nextRecapAt: number;
  private recapAttempts = 0;
  private recapInFlight = false;
  /**
   * A period that has closed but whose recap Telegram has not accepted yet.
   * Held separately from the live tally so a retry re-sends the period that
   * came due rather than a period that keeps growing underneath it.
   */
  private pendingRecap: { tally: DailyTally; until: number } | null = null;

  constructor(
    private readonly sender: TelegramSender,
    private readonly options: AlertRelayOptions
  ) {
    this.idempotencyKeys = new ExpiringCache(options.maxCacheEntries);
    this.now = options.now ?? Date.now;
    this.analyze = options.analyze ?? emptyAnalysis;
    this.startedAt = options.startedAt ?? this.now();
    this.restartRecapDone = (options.restartGraceMs ?? 0) <= 0;
    this.daily = emptyTally(this.startedAt);
    this.nextRecapAt = nextRecapTime(this.startedAt, this.recapAtMinutes());
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

        // Closing is silent now, but it still has to happen before the alert
        // that reopens the key, or the reopened window would inherit a
        // cooldown that has already expired.
        if (existing && existing.expiresAt <= now && !existing.deferred) {
          this.closeWindow(existing);
        }

        const window = this.windows.get(key);
        if (!window) {
          const opened = openWindow(
            key,
            payload,
            analysis,
            now,
            this.options,
            this.nextRecapAt
          );

          if (this.inRestartGrace(now)) {
            opened.deferred = true;
            this.windows.set(key, opened);
            this.countDelivery(payload, analysis, now, opened.eventCount);
            this.trimWindows(now);
            this.rememberIdempotencyKey(idempotencyKey, now);
            return { outcome: "deferred" as const };
          }

          // Registered only once Telegram has accepted. A failed send must
          // leave no window behind, or the retry would be suppressed as a
          // repeat of a message that was never delivered. The daily tally is
          // folded in on the same terms: counting before the send would count
          // the delivery again when ClickStack retries it under a fresh key.
          await this.sender(payload, {
            kind: "new",
            window: summarize(opened),
            silent: false,
          });
          this.windows.set(key, opened);
          this.countDelivery(payload, analysis, now, opened.eventCount);
          this.daily.alertsPosted += 1;
          this.trimWindows(now);
          this.rememberIdempotencyKey(idempotencyKey, now);
          return { outcome: "sent" as const };
        }

        const addedEvents = accumulate(window, payload, analysis, now);
        this.countDelivery(payload, analysis, now, addedEvents);
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
            this.daily.alertsPosted += 1;
          });
        }

        return { outcome: "suppressed" as const };
      });
    });
  }

  /**
   * Posts whatever is due: the restart recap once the grace period is over,
   * and the daily recap once its scheduled time has passed. Closing expired
   * windows is silent. A failed recap is retried on the next sweep rather than
   * dropping the counters it carries.
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
      await this.withLock(this.eventLocks, key, async () => {
        // `handle` may have closed and replaced this window while the sweep
        // waited for the lock.
        if (this.windows.get(key) === window) {
          this.closeWindow(window);
        }
      });
    }

    await reportFailure("daily_recap_failed", () => this.flushDailyRecap(now));
  }

  /**
   * O(1) per window and non-mutating, so the unauthenticated health route
   * cannot be used to force repeated full-cache sweeps. Counts may briefly
   * include entries that have expired but not yet been reclaimed.
   */
  stats(): {
    windows: number;
    idempotencyKeys: number;
    dailySignatures: number;
    dailyEvents: number;
    nextRecapAt: number;
    /** Events sitting in a recap Telegram has not accepted yet. */
    pendingRecapEvents: number;
  } {
    return {
      windows: this.windows.size,
      idempotencyKeys: this.idempotencyKeys.size,
      dailySignatures: this.daily.signatures.size,
      dailyEvents: this.daily.eventCount,
      nextRecapAt: this.nextRecapAt,
      pendingRecapEvents: this.pendingRecap?.tally.eventCount ?? 0,
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
    return {
      version: STATE_VERSION,
      savedAt: now,
      windows,
      daily: serializeTally(this.daily),
      nextRecapAt: this.nextRecapAt,
      ...(this.pendingRecap
        ? {
            pendingRecap: {
              tally: serializeTally(this.pendingRecap.tally),
              until: this.pendingRecap.until,
            },
          }
        : {}),
    };
  }

  /**
   * Restores windows saved before a restart. Entries that have already expired
   * are dropped, so a stale snapshot cannot mute a signature indefinitely.
   *
   * Total: this runs during boot against bytes the process did not write and
   * cannot re-validate — a half-written file, a row from a build whose shape
   * has since changed, a truncated JSON column. A throw here would take the
   * relay down before it binds a port, so every piece is restored
   * independently and a malformed one is skipped. Losing a window costs a
   * duplicate message; losing the process costs every alert until someone
   * notices.
   */
  importState(state: PersistedState, now = this.now()): number {
    if (!state || state.version !== STATE_VERSION) {
      return 0;
    }

    let restored = 0;
    for (const saved of Array.isArray(state.windows) ? state.windows : []) {
      if (!saved || saved.expiresAt <= now || this.windows.has(saved.key)) {
        continue;
      }
      const window = recover("state_window_restore_failed", () =>
        deserializeWindow(saved)
      );
      if (!window) {
        continue;
      }
      this.windows.set(saved.key, window);
      restored += 1;
    }

    // The tally is what a deploy would otherwise erase. A deadline that passed
    // while the process was down is kept, not dropped: the next sweep posts
    // the recap late, which beats losing the period entirely. Only a snapshot
    // older than a full period is discarded, since nobody could place its
    // counts against a date by then.
    if (state.daily && state.nextRecapAt && now - state.nextRecapAt < DAY_MS) {
      const saved = state.daily;
      const daily = recover("state_tally_restore_failed", () =>
        deserializeTally(saved)
      );
      if (daily) {
        this.daily = daily;
        this.nextRecapAt = state.nextRecapAt;
      }
    }

    if (state.pendingRecap && now - state.pendingRecap.until < DAY_MS) {
      const saved = state.pendingRecap;
      const tally = recover("state_pending_recap_restore_failed", () =>
        deserializeTally(saved.tally)
      );
      if (tally) {
        this.pendingRecap = { tally, until: saved.until };
      }
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

  /**
   * A window's only job is to keep the chat quiet while an incident repeats.
   * Everything it counted has already been folded into the daily tally at
   * ingest, so closing it posts nothing.
   */
  private closeWindow(window: AlertWindow): void {
    this.windows.delete(window.key);
  }

  /**
   * Folds an accepted delivery into the reporting period. Separate from the
   * window bookkeeping because a delivery whose alert Telegram rejected is not
   * accepted: it will arrive again, and must be counted then, not twice.
   */
  private countDelivery(
    payload: ClickStackWebhookPayload,
    analysis: AlertAnalysis,
    now: number,
    addedEvents: number
  ): void {
    this.daily.deliveries += 1;
    this.daily.lastPayload = payload;
    if (addedEvents > 0) {
      recordDaily(this.daily, analysis, now, addedEvents);
    }
  }

  private recapAtMinutes(): number {
    return this.options.dailyRecapAtMinutes ?? DEFAULT_DAILY_RECAP_AT_MINUTES;
  }

  private async flushDailyRecap(now: number): Promise<void> {
    // `pendingRecap` is swapped in synchronously below, but the send that
    // follows is not: without this flag two sweeps overlapping on the timer
    // would both reach the same unsent recap and post it twice.
    if (this.recapInFlight) {
      return;
    }

    if (!this.pendingRecap) {
      if (now < this.nextRecapAt) {
        return;
      }

      // Closing the period is synchronous, so a delivery arriving while the
      // recap is in flight is counted against the next period instead of
      // being dropped when the tally is replaced.
      const tally = this.daily;
      const until = this.nextRecapAt;
      this.daily = emptyTally(until);
      this.nextRecapAt = nextRecapTime(now, this.recapAtMinutes());
      this.recapAttempts = 0;

      // Nothing fired: the schedule still advances, but silence is the report.
      if (
        (this.options.dailyRecapEnabled ?? true) === false ||
        tally.signatures.size === 0 ||
        !tally.lastPayload
      ) {
        return;
      }

      this.pendingRecap = { tally, until };
    }

    const pending = this.pendingRecap;
    const payload = pending.tally.lastPayload;
    if (!payload) {
      this.pendingRecap = null;
      return;
    }

    this.recapInFlight = true;
    try {
      await this.sender(payload, {
        kind: "daily",
        daily: summarizeDaily(pending.tally, pending.until),
        silent: true,
      });
      this.pendingRecap = null;
      this.recapAttempts = 0;
    } catch (error) {
      this.recapAttempts += 1;
      const maxAttempts =
        this.options.maxFlushAttempts ?? DEFAULT_MAX_FLUSH_ATTEMPTS;
      if (this.recapAttempts < maxAttempts) {
        throw error;
      }

      // Give up rather than retry forever, and say so: the counts in this
      // recap are gone, and only the log records that they existed.
      console.error(
        JSON.stringify({
          event: "daily_recap_dropped",
          since: pending.tally.since,
          until: pending.until,
          signatures: pending.tally.signatures.size,
          events: pending.tally.eventCount,
          attempts: this.recapAttempts,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: redactBotToken(
            error instanceof Error ? error.message : String(error)
          ).slice(0, 300),
        })
      );
      this.pendingRecap = null;
      this.recapAttempts = 0;
    } finally {
      this.recapInFlight = false;
    }
  }

  private shouldEscalate(window: AlertWindow): boolean {
    const multiplier = this.options.escalationMultiplier ?? 0;
    if (multiplier <= 1 || window.escalations >= MAX_ESCALATIONS_PER_WINDOW) {
      return false;
    }

    const baseline = Math.max(window.openingEventCount, 1);
    return (
      window.peakEvaluationEventCount >=
      baseline * multiplier ** (window.escalations + 1)
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
/**
 * Synchronous counterpart to `reportFailure`, for restoring one piece of a
 * snapshot. Returns `null` instead of throwing so the caller can skip that
 * piece and keep the rest.
 */
function recover<T>(event: string, action: () => T): T | null {
  try {
    return action();
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
    return null;
  }
}

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

/**
 * A signature stays quiet until the next recap, so an incident that lasts all
 * day is announced once and its volume is reported once, rather than being
 * re-announced every hour. `cooldownMs` is the floor: an error that first
 * fires minutes before a recap would otherwise be free to alert again almost
 * immediately, so the window rolls to the following period instead.
 */
function windowExpiry(
  now: number,
  options: AlertRelayOptions,
  recapAt: number
): number {
  const floor = now + options.cooldownMs;
  let expiresAt = recapAt;
  while (expiresAt < floor) {
    expiresAt += DAY_MS;
  }
  return expiresAt;
}

function openWindow(
  key: string,
  payload: ClickStackWebhookPayload,
  analysis: AlertAnalysis,
  now: number,
  options: AlertRelayOptions,
  recapAt: number
): AlertWindow {
  const window: AlertWindow = {
    key,
    payload,
    openedAt: now,
    expiresAt: windowExpiry(now, options, recapAt),
    firstEventAt: now,
    lastEventAt: now,
    eventCount: 0,
    evaluationCounts: new Map(),
    peakEvaluationEventCount: 0,
    openingEventCount: Math.max(analysis.eventCount, 1),
    suppressedAlerts: 0,
    sampledRows: 0,
    signatures: new Map(),
    uniqueValues: new Map(),
    cappedValues: new Set(),
    buckets: new Array<number>(BUCKET_COUNT).fill(0),
    escalations: 0,
    flushAttempts: 0,
    deferred: false,
  };
  record(window, payload, analysis, now);
  return window;
}

/** Returns the matched lines this delivery added beyond what was known. */
function accumulate(
  window: AlertWindow,
  payload: ClickStackWebhookPayload,
  analysis: AlertAnalysis,
  now: number
): number {
  window.suppressedAlerts += 1;
  return record(window, payload, analysis, now);
}

function record(
  window: AlertWindow,
  payload: ClickStackWebhookPayload,
  analysis: AlertAnalysis,
  now: number
): number {
  const events = Math.max(analysis.eventCount, 1);
  const key = evaluationKey(payload);
  const previousEvents = window.evaluationCounts.get(key) ?? 0;
  const addedEvents = Math.max(events - previousEvents, 0);

  window.payload = payload;
  window.lastEventAt = now;
  window.evaluationCounts.set(key, Math.max(previousEvents, events));
  window.peakEvaluationEventCount = Math.max(
    window.peakEvaluationEventCount,
    events
  );
  window.eventCount += addedEvents;
  window.buckets[bucketIndex(window, now)] += addedEvents;

  // The row block is part of the same evaluation snapshot. Reprocessing it
  // would inflate signature/sample statistics just like re-adding its count.
  if (addedEvents > 0) {
    window.sampledRows += analysis.signatures.length;

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
  }

  // Keep the union even when ClickStack returns a different truncated row
  // sample for the same evaluation range and matched-line count.
  mergeBoundedValues(
    window.uniqueValues,
    window.cappedValues,
    analysis.uniqueValues
  );

  return addedEvents;
}

/**
 * Merges distinct values into bounded sets, recording every column that had to
 * drop one. A column that hit the cap can only be reported as a floor: saying
 * "500 unique wallets" when the 501st was thrown away is a wrong number, not a
 * rounded one.
 */
function mergeBoundedValues(
  target: Map<string, Set<string>>,
  capped: Set<string>,
  incoming: Record<string, string[]>
): void {
  for (const [label, values] of Object.entries(incoming)) {
    let seen = target.get(label);
    if (!seen) {
      seen = new Set<string>();
      target.set(label, seen);
    }
    for (const value of values) {
      if (seen.has(value)) {
        continue;
      }
      if (seen.size >= MAX_TRACKED_VALUES) {
        capped.add(label);
        continue;
      }
      seen.add(value);
    }
  }
}

/**
 * Folds one counted delivery into the reporting period. Called from the same
 * branch that updates the window, so the evaluation-range deduplication that
 * keeps a window's counters honest keeps the daily frequencies honest too.
 */
function recordDaily(
  daily: DailyTally,
  analysis: AlertAnalysis,
  now: number,
  addedEvents: number
): void {
  daily.eventCount += addedEvents;
  daily.sampledRows += analysis.signatures.length;

  for (const signature of analysis.signatures) {
    const existing = daily.signatures.get(signature.key);
    if (existing) {
      existing.count += 1;
      existing.lastAt = now;
      continue;
    }
    if (daily.signatures.size >= MAX_DAILY_SIGNATURES) {
      // Remembered by key so the recap can say how much it is not showing.
      daily.omittedSignatures.add(signature.key);
      continue;
    }
    daily.signatures.set(signature.key, {
      count: 1,
      service: signature.service,
      severity: signature.severity,
      headline: signature.headline,
      firstAt: now,
      lastAt: now,
    });
  }

  mergeBoundedValues(
    daily.uniqueValues,
    daily.cappedValues,
    analysis.uniqueValues
  );
}

function summarizeDaily(daily: DailyTally, until: number): DailySummary {
  const signatures = [...daily.signatures.values()].sort(
    (left, right) => right.count - left.count || right.lastAt - left.lastAt
  );
  const uniqueValues: Record<string, number> = {};
  for (const [label, values] of daily.uniqueValues) {
    uniqueValues[label] = values.size;
  }

  return {
    since: daily.since,
    until,
    eventCount: daily.eventCount,
    sampledRows: daily.sampledRows,
    deliveries: daily.deliveries,
    alertsPosted: daily.alertsPosted,
    signatures: signatures.map((signature) => ({
      count: signature.count,
      service: signature.service,
      headline: signature.headline,
      firstAt: signature.firstAt,
      lastAt: signature.lastAt,
    })),
    omittedSignatures: daily.omittedSignatures.size,
    uniqueValues,
    cappedValues: [...daily.cappedValues],
  };
}

/**
 * The next occurrence of the configured wall-clock minute, strictly after
 * `from`. Strictly, so a relay that starts exactly on the boundary does not
 * immediately post a recap for a period it did not observe.
 */
export function nextRecapTime(from: number, atMinutes: number): number {
  const offset = ((atMinutes % 1440) + 1440) % 1440;
  const midnight = Math.floor(from / DAY_MS) * DAY_MS;
  const candidate = midnight + offset * 60_000;
  return candidate > from ? candidate : candidate + DAY_MS;
}

function evaluationKey(payload: ClickStackWebhookPayload): string {
  return `${payload.startTime}:${payload.endTime}`;
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
    cappedValues: [...window.cappedValues],
    buckets: [...window.buckets],
    peakBucket: window.buckets.indexOf(Math.max(...window.buckets)),
    bucketMs: bucketMsOf(window),
  };
}

const STATE_VERSION = 2;

export interface PersistedWindow {
  key: string;
  payload: ClickStackWebhookPayload;
  openedAt: number;
  expiresAt: number;
  firstEventAt: number;
  lastEventAt: number;
  eventCount: number;
  openingEventCount: number;
  /** Optional only for snapshots written before evaluation deduplication. */
  evaluationCounts?: [string, number][];
  /** Optional only for snapshots written before evaluation deduplication. */
  peakEvaluationEventCount?: number;
  suppressedAlerts: number;
  sampledRows: number;
  signatures: (SignatureState & { key: string })[];
  uniqueValues: Record<string, string[]>;
  cappedValues?: string[];
  buckets: number[];
  escalations: number;
}

export interface PersistedTally {
  since: number;
  eventCount: number;
  sampledRows?: number;
  deliveries: number;
  alertsPosted: number;
  signatures: (DailySignatureState & { key: string })[];
  uniqueValues: Record<string, string[]>;
  cappedValues?: string[];
  omittedSignatures: string[];
  lastPayload?: ClickStackWebhookPayload;
}

export interface PersistedState {
  version: number;
  savedAt: number;
  windows: PersistedWindow[];
  daily?: PersistedTally;
  nextRecapAt?: number;
  /** A closed period whose recap Telegram had not accepted before shutdown. */
  pendingRecap?: { tally: PersistedTally; until: number };
}

function serializeTally(daily: DailyTally): PersistedTally {
  const uniqueValues: Record<string, string[]> = {};
  for (const [label, values] of daily.uniqueValues) {
    uniqueValues[label] = [...values];
  }

  return {
    since: daily.since,
    eventCount: daily.eventCount,
    sampledRows: daily.sampledRows,
    deliveries: daily.deliveries,
    alertsPosted: daily.alertsPosted,
    signatures: [...daily.signatures].map(([key, state]) => ({
      key,
      ...state,
    })),
    uniqueValues,
    cappedValues: [...daily.cappedValues],
    omittedSignatures: [...daily.omittedSignatures],
    lastPayload: daily.lastPayload,
  };
}

function deserializeTally(saved: PersistedTally): DailyTally {
  const uniqueValues = new Map<string, Set<string>>();
  for (const [label, values] of Object.entries(saved.uniqueValues ?? {})) {
    uniqueValues.set(label, new Set(values));
  }

  return {
    since: saved.since,
    eventCount: saved.eventCount,
    sampledRows: saved.sampledRows ?? 0,
    deliveries: saved.deliveries,
    alertsPosted: saved.alertsPosted,
    signatures: new Map(
      (saved.signatures ?? []).map(({ key, ...state }) => [key, state])
    ),
    uniqueValues,
    cappedValues: new Set(saved.cappedValues ?? []),
    omittedSignatures: new Set(saved.omittedSignatures ?? []),
    lastPayload: saved.lastPayload,
  };
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
    evaluationCounts: [...window.evaluationCounts],
    peakEvaluationEventCount: window.peakEvaluationEventCount,
    suppressedAlerts: window.suppressedAlerts,
    sampledRows: window.sampledRows,
    signatures: [...window.signatures].map(([key, state]) => ({
      key,
      ...state,
    })),
    uniqueValues,
    cappedValues: [...window.cappedValues],
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

  const evaluationCounts = new Map<string, number>(
    saved.evaluationCounts ?? [[evaluationKey(saved.payload), saved.eventCount]]
  );

  return {
    key: saved.key,
    payload: saved.payload,
    openedAt: saved.openedAt,
    expiresAt: saved.expiresAt,
    firstEventAt: saved.firstEventAt,
    lastEventAt: saved.lastEventAt,
    eventCount: saved.eventCount,
    openingEventCount: saved.openingEventCount,
    evaluationCounts,
    peakEvaluationEventCount:
      saved.peakEvaluationEventCount ?? Math.max(saved.openingEventCount, 1),
    suppressedAlerts: saved.suppressedAlerts,
    sampledRows: saved.sampledRows,
    signatures,
    uniqueValues,
    cappedValues: new Set(saved.cappedValues ?? []),
    buckets: [...saved.buckets],
    escalations: saved.escalations,
    flushAttempts: 0,
    deferred: false,
  };
}
