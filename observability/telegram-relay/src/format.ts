import type { ClickStackWebhookPayload } from "./relay.ts";

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
}

export interface FormattedMessage {
  text: string;
  parseMode?: "HTML";
}

/** Enough rows to see a pattern, few enough to stay readable in a chat. */
const MAX_RENDERED_ROWS = 8;
/** Headroom for the "and N more" footer while rows are being fitted. */
const FOOTER_RESERVE = 48;

export function formatTelegramMessage(
  payload: ClickStackWebhookPayload,
  options: FormatOptions
): FormattedMessage {
  return (
    formatPrettyMessage(payload, options.alertColumns) ?? {
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

function formatPrettyMessage(
  payload: ClickStackWebhookPayload,
  columns: string[]
): FormattedMessage | null {
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

  const header = [
    `<b>${escapeHtml(payload.title.trim())}</b>`,
    ...parsed.summaryLines.map((line) => `<i>${escapeHtml(line)}</i>`),
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
  const fields = columns.map((column, index) => ({
    label: column.trim(),
    role: roleOf(column),
    value: (row[index] ?? "").trim(),
  }));
  const valueOf = (role: ColumnRole) =>
    fields.find((field) => field.role === role && field.value)?.value ?? "";

  const severity = valueOf("severity");
  const head = [
    severity ? `${severityIcon(severity)} <b>${escapeHtml(severity)}</b>` : "",
    formatTimestamp(valueOf("time")),
    valueOf("service"),
  ]
    .filter(Boolean)
    .map((part, index) => (index === 0 && severity ? part : escapeHtml(part)))
    .join(" · ");

  const lines: string[] = [];
  if (head) {
    lines.push(head);
  }

  const headline = valueOf("headline");
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
