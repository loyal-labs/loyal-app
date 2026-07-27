import type {
  AlertAnalysis,
  AlertContext,
  ClickStackWebhookPayload,
  DailySummary,
  SignatureInput,
  WindowSummary,
} from "./relay.ts";

export const TELEGRAM_MESSAGE_LIMIT = 4096;

/** Columns ClickStack projects by default when a saved search sets no `select`. */
export const DEFAULT_ALERT_COLUMNS = [
  "Timestamp",
  "ServiceName",
  "SeverityText",
  "Body",
];

/**
 * ClickStack renders alert rows as a CSV block with no header line, so the
 * relay has to be told which saved-search columns it is looking at. Keep this
 * list in the same order as the saved search `select`.
 */
export interface FormatOptions {
  alertColumns: string[];
  /**
   * Columns whose distinct values are worth counting, such as a wallet
   * address. Rendered as "N unique <column>" rather than as a value list.
   */
  cardinalityColumns?: string[];
  context?: AlertContext;
}

export interface FormattedMessage {
  text: string;
  parseMode?: "HTML";
}

/** Enough rows to see a pattern, few enough to stay readable in a chat. */
const MAX_RENDERED_ROWS = 8;
/** Headroom for the "and N more" footer while rows are being fitted. */
const FOOTER_RESERVE = 48;
const SPARKLINE = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export function formatTelegramMessage(
  payload: ClickStackWebhookPayload,
  options: FormatOptions
): FormattedMessage {
  const context = options.context;

  if (context?.kind === "daily" && context.daily) {
    return formatDailyRecap(context.daily);
  }

  return (
    formatPrettyMessage(payload, options) ?? {
      text: formatPlainTelegramMessage(payload),
    }
  );
}

/**
 * Verbatim ClickStack text. Used when the payload does not carry a parseable
 * CSV block and as the resend body when Telegram rejects HTML entities.
 */
export function formatPlainTelegramMessage(
  payload: ClickStackWebhookPayload
): string {
  const main = [payload.title.trim(), payload.body.trim()]
    .filter(Boolean)
    .join("\n\n");
  const suffix = payload.link.trim() ? `\n\n${payload.link.trim()}` : "";
  const fullMessage = `${main}${suffix}`;

  if (fullMessage.length <= TELEGRAM_MESSAGE_LIMIT) {
    return fullMessage;
  }

  // A partial URL is worse than none: it looks clickable, resolves nowhere, and
  // hides the alert title behind it. When the link cannot fit whole, drop it and
  // keep the text; otherwise reserve it in full and truncate only the text.
  if (suffix.length + 1 > TELEGRAM_MESSAGE_LIMIT) {
    return `${sliceWholeCodePoints(main, TELEGRAM_MESSAGE_LIMIT - 1)}…`;
  }

  const availableMainLength = TELEGRAM_MESSAGE_LIMIT - suffix.length - 1;
  return `${sliceWholeCodePoints(main, availableMainLength)}…${suffix}`;
}

/**
 * Everything the relay needs to count a delivery: how many lines matched, what
 * each row is about, and the distinct values of the cardinality columns.
 */
export function analyzeAlert(
  payload: ClickStackWebhookPayload,
  options: Pick<FormatOptions, "alertColumns" | "cardinalityColumns">
): AlertAnalysis {
  const parsed = parseAlertBody(payload.body);
  const rows =
    parsed &&
    parsed.rows.every((row) => row.length === options.alertColumns.length)
      ? parsed.rows
      : [];

  const signatures: SignatureInput[] = [];
  const uniqueValues: Record<string, string[]> = {};
  const cardinality = new Set(
    (options.cardinalityColumns ?? []).map((column) => column.trim())
  );

  for (const row of rows) {
    const fields = readFields(row, options.alertColumns);
    signatures.push(signatureOf(fields));

    for (const field of fields) {
      if (!cardinality.has(field.label) || !field.value) {
        continue;
      }
      const values = uniqueValues[field.label] ?? [];
      values.push(field.value);
      uniqueValues[field.label] = values;
    }
  }

  return {
    eventCount: matchedLineCount(payload) ?? rows.length,
    signatures,
    uniqueValues,
  };
}

/**
 * ClickStack puts the matched-line count in the title and repeats it in the
 * body preamble. It is authoritative even when the row block that follows has
 * been truncated, so it is the only honest event count available.
 */
function matchedLineCount(payload: ClickStackWebhookPayload): number | null {
  const fromTitle = /(\d+)\s+lines?\s+found/i.exec(payload.title);
  if (fromTitle?.[1]) {
    return Number(fromTitle[1]);
  }
  const fromBody = /(\d+)\s+lines?\s+found/i.exec(payload.body);
  return fromBody?.[1] ? Number(fromBody[1]) : null;
}

interface RowField {
  label: string;
  role: ColumnRole;
  value: string;
}

function readFields(row: string[], columns: string[]): RowField[] {
  return columns.map((column, index) => ({
    label: column.trim(),
    role: roleOf(column),
    value: (row[index] ?? "").trim(),
  }));
}

function fieldValue(fields: RowField[], role: ColumnRole): string {
  return (
    fields.find((field) => field.role === role && field.value)?.value ?? ""
  );
}

function signatureOf(fields: RowField[]): SignatureInput {
  const service = fieldValue(fields, "service");
  const severity = fieldValue(fields, "severity");
  const headline =
    fieldValue(fields, "headline") ||
    fields.find((field) => field.role === "detail" && field.value)?.value ||
    "";

  return {
    key: `${service}|${severity}|${normalizeHeadline(headline)}`,
    service,
    severity,
    headline,
  };
}

/**
 * Two messages describing the same failure differ only in identifiers, so
 * addresses, hashes and numbers are collapsed before they are compared.
 */
export function normalizeHeadline(headline: string): string {
  return headline
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, "<address>")
    .replace(/\b[\da-f]{8,}\b/gi, "<hex>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function formatPrettyMessage(
  payload: ClickStackWebhookPayload,
  options: FormatOptions
): FormattedMessage | null {
  const columns = options.alertColumns;
  if (columns.length === 0) {
    return null;
  }

  const parsed = parseAlertBody(payload.body);
  if (!parsed || parsed.rows.length === 0) {
    return null;
  }

  // A column list that disagrees with what ClickStack actually sent would
  // mislabel every field, which is worse than the raw block.
  if (parsed.rows.some((row) => row.length !== columns.length)) {
    return null;
  }

  const blocks = parsed.rows
    .slice(0, MAX_RENDERED_ROWS)
    .map((row) => renderRow(row, columns))
    .filter((block) => block.length > 0);
  if (blocks.length === 0) {
    return null;
  }

  const window = options.context?.window;
  const header = [
    `<b>🚨 ${escapeHtml(alertName(payload.title))}</b>`,
    ...parsed.summaryLines.map((line) => `<i>${escapeHtml(line)}</i>`),
    ...(window ? [`<i>${escapeHtml(openingStats(window))}</i>`] : []),
  ].join("\n");
  const link = payload.link.trim();
  const suffix = link ? `\n\n${escapeHtml(link)}` : "";

  const budget = TELEGRAM_MESSAGE_LIMIT - suffix.length - FOOTER_RESERVE;
  const rendered: string[] = [];
  let used = header.length;
  for (const block of blocks) {
    if (used + block.length + 2 > budget) {
      break;
    }
    rendered.push(block);
    used += block.length + 2;
  }

  if (rendered.length === 0) {
    return null;
  }

  const omitted = parsed.rows.length - rendered.length;
  const footer = omitted > 0 ? `\n\n<i>and ${omitted} more row(s)</i>` : "";

  return {
    text: `${header}\n\n${rendered.join("\n\n")}${footer}${suffix}`,
    parseMode: "HTML",
  };
}

/** "12 events · ≥4 unique wallet · muted 60m" under the first message. */
function openingStats(window: WindowSummary): string {
  const parts = [countLabel(window.eventCount, "event")];
  parts.push(...cardinalityLabels(window));
  parts.push(`muted ${formatDuration(window.expiresAt - window.openedAt)}`);
  return parts.join(" · ");
}

/**
 * The one scheduled message: every signature seen since the last recap, with
 * how often it fired. This is the only place a non-repeating error is ever
 * counted, so it lists frequencies rather than summarizing a single incident.
 */
function formatDailyRecap(daily: DailySummary): FormattedMessage {
  const span = formatDuration(daily.until - daily.since);
  const lines = [
    `<b>📊 Error recap · last ${escapeHtml(span)}</b>`,
    `<i>${escapeHtml(
      [
        countLabel(daily.eventCount, "event"),
        `${daily.signatures.length} distinct error(s)`,
        `${daily.alertsPosted} alert(s) posted`,
        ...dailyCardinalityLabels(daily),
      ].join(" · ")
    )}</i>`,
    "",
  ];

  const rendered: string[] = [];
  let used = lines.join("\n").length;
  let shown = 0;

  for (const signature of daily.signatures) {
    // One line per signature, so an embedded newline (a stack trace, a chunk
    // load error carrying its URL) must not break the layout.
    const line = `<b>×${signature.count}</b> ${escapeHtml(
      truncate(signature.headline.replace(/\s+/g, " ").trim(), 110)
    )}${
      signature.service ? `\n<i>${escapeHtml(signature.service)} · ` : "\n<i>"
    }${escapeHtml(
      `${formatClock(signature.firstAt)}–${formatClock(signature.lastAt)} UTC`
    )}</i>`;

    if (used + line.length + FOOTER_RESERVE > TELEGRAM_MESSAGE_LIMIT) {
      break;
    }
    rendered.push(line);
    used += line.length + 1;
    shown += 1;
  }

  lines.push(...rendered);

  const omitted =
    daily.signatures.length - shown + Math.max(daily.omittedSignatures, 0);
  if (omitted > 0) {
    lines.push("", `<i>and ${omitted} more distinct error(s)</i>`);
  }

  return { text: lines.join("\n"), parseMode: "HTML" };
}

/**
 * "≥3 unique wallets" across the whole reporting period. The floor marker
 * matters as much here as on an alert: ClickStack truncates row blocks, so a
 * period can match far more lines than the relay was ever able to read.
 */
function dailyCardinalityLabels(daily: DailySummary): string[] {
  return renderCardinality(
    daily.uniqueValues,
    daily.cappedValues,
    daily.sampledRows < daily.eventCount
  );
}

/**
 * ClickStack truncates the row block it sends, so distinct values counted from
 * those rows are a floor, not a total. Say so rather than implying precision
 * the relay does not have.
 */
function cardinalityLabels(window: WindowSummary): string[] {
  return renderCardinality(
    window.uniqueValues,
    window.cappedValues,
    window.sampledRows < window.eventCount
  );
}

/**
 * A count is a floor when ClickStack truncated the rows it sent, and also when
 * the relay itself stopped retaining distinct values. Both have to show, or a
 * capped column reads as an exact total.
 */
function renderCardinality(
  uniqueValues: Record<string, number>,
  cappedValues: string[],
  truncated: boolean
): string[] {
  const capped = new Set(cappedValues);
  return Object.entries(uniqueValues)
    .filter(([, count]) => count > 0)
    .map(
      ([label, count]) =>
        `${
          truncated || capped.has(label) ? "≥" : ""
        }${count} unique ${pluralize(label, count)}`
    );
}

function countLabel(count: number, noun: string): string {
  return `${count} ${pluralize(noun, count)}`;
}

function pluralize(noun: string, count: number): string {
  return count === 1 || noun.endsWith("s") ? noun : `${noun}s`;
}

/**
 * Strips ClickStack's matched-line suffix and its leading siren, leaving just
 * the alert name. Each message type supplies its own icon, so keeping the
 * original would double them up.
 */
export function alertName(title: string): string {
  return title
    .replace(/\s*-\s*\d+\s+lines?\s+found\s*$/i, "")
    .replace(/^[^\p{L}\p{N}"']+/u, "")
    .trim();
}

function renderSparkline(buckets: number[]): string {
  const peak = Math.max(...buckets);
  if (peak <= 0) {
    return "";
  }
  return buckets
    .map((value) => {
      const index = Math.min(
        Math.floor((value / peak) * (SPARKLINE.length - 1)),
        SPARKLINE.length - 1
      );
      return SPARKLINE[index];
    })
    .join("");
}

function formatDuration(ms: number): string {
  const minutes = Math.max(Math.round(ms / 60_000), 0);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${rest}m`;
}

function formatClock(epochMs: number): string {
  const parsed = new Date(epochMs);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(11, 19);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${sliceWholeCodePoints(value, maxLength - 1)}…`;
}

interface ParsedAlertBody {
  summaryLines: string[];
  rows: string[][];
}

/**
 * ClickStack sends a short preamble (group, line count, time range) followed by
 * a fenced CSV block holding the matched rows.
 */
function parseAlertBody(body: string): ParsedAlertBody | null {
  const lines = body.split("\n");
  const fences: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "```") {
      fences.push(index);
    }
  }

  const start = fences[0];
  const end = fences.at(-1);
  if (start === undefined || end === undefined || end <= start + 1) {
    return null;
  }

  const rows = parseCsv(lines.slice(start + 1, end).join("\n"));
  if (!rows) {
    return null;
  }

  return {
    // The threshold line repeats the count ClickStack already put in `title`.
    summaryLines: lines
      .slice(0, start)
      .map((line) => line.trim())
      .filter((line) => line && !/^\d+ lines found/.test(line)),
    rows,
  };
}

/**
 * RFC 4180 parsing rather than `split(",")`: a log body can legitimately
 * contain commas, quotes, and newlines inside one quoted field.
 */
function parseCsv(input: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let dirty = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (dirty) {
      rows.push(row);
    }
    row = [];
    dirty = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char !== '"') {
        field += char;
      } else if (input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = false;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      dirty = true;
    } else if (char === ",") {
      endField();
      dirty = true;
    } else if (char === "\n") {
      endRow();
    } else if (char !== "\r") {
      field += char;
      dirty = true;
    }
  }

  if (inQuotes) {
    return null;
  }
  endRow();

  return rows;
}

type ColumnRole = "time" | "service" | "severity" | "headline" | "detail";

function roleOf(column: string): ColumnRole {
  switch (column.trim().toLowerCase()) {
    case "timestamp":
    case "time":
      return "time";
    case "servicename":
    case "service":
      return "service";
    case "severitytext":
    case "severity":
    case "level":
      return "severity";
    case "body":
      return "headline";
    default:
      return "detail";
  }
}

function renderRow(row: string[], columns: string[]): string {
  const fields = readFields(row, columns);
  const severity = fieldValue(fields, "severity");
  const head = [
    severity ? `${severityIcon(severity)} <b>${escapeHtml(severity)}</b>` : "",
    formatTimestamp(fieldValue(fields, "time")),
    fieldValue(fields, "service"),
  ]
    .filter(Boolean)
    .map((part, index) => (index === 0 && severity ? part : escapeHtml(part)))
    .join(" · ");

  const lines: string[] = [];
  if (head) {
    lines.push(head);
  }

  const headline = fieldValue(fields, "headline");
  if (headline) {
    lines.push(`<b>${escapeHtml(headline)}</b>`);
  }

  for (const field of fields) {
    if (field.role === "detail" && field.value) {
      lines.push(
        `${escapeHtml(field.label)}: <code>${escapeHtml(field.value)}</code>`
      );
    }
  }

  return lines.join("\n");
}

function severityIcon(severity: string): string {
  switch (severity.toLowerCase()) {
    case "error":
    case "fatal":
    case "critical":
      return "🔴";
    case "warn":
    case "warning":
      return "🟡";
    case "info":
      return "🔵";
    default:
      return "⚪";
  }
}

/**
 * ClickStack timestamps carry nanosecond precision, which `Date` does not
 * accept, so trim to milliseconds before parsing and keep the raw value when
 * the column turns out not to be a timestamp at all.
 */
function formatTimestamp(value: string): string {
  if (!value) {
    return "";
  }

  const trimmed = value.replace(/(\.\d{3})\d+(Z|$)/, "$1$2");
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return `${parsed.toISOString().slice(11, 19)} UTC`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * `String.prototype.slice` cuts on UTF-16 units and can leave a dangling high
 * surrogate, which renders as a replacement character. Drop the split pair.
 */
function sliceWholeCodePoints(value: string, maxLength: number): string {
  const sliced = value.slice(0, maxLength);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    return sliced.slice(0, -1);
  }
  return sliced;
}
