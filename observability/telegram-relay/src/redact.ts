import { escapeHtml } from "./format.ts";

const REDACTED = "<redacted>";

/** Matches the token only where it sits in the Telegram API URL. */
const BOT_TOKEN_URL_SOURCE = String.raw`bot\d+:[\w-]+`;
const SLACK_WEBHOOK_URL_SOURCE = String.raw`https://hooks\.slack\.com/services/[A-Za-z0-9/_-]+`;
/**
 * A bot token is `<numeric id>:<35-character secret>`. Delivered alert text is
 * other services' log output, which can carry a token with no `bot` prefix in
 * front of it — a config dump, or a message quoting the raw value — so shape
 * alone has to be enough there. The length floor keeps ordinary `12:34` text
 * out of it.
 */
const BARE_BOT_TOKEN_SOURCE = String.raw`(?<![\w-])\d{5,16}:[A-Za-z0-9_-]{30,}(?![\w-])`;

const BOT_TOKEN_URL = new RegExp(BOT_TOKEN_URL_SOURCE, "g");
const SLACK_WEBHOOK_URL = new RegExp(SLACK_WEBHOOK_URL_SOURCE, "g");
const BARE_BOT_TOKEN = new RegExp(BARE_BOT_TOKEN_SOURCE, "g");

/**
 * The bot token is embedded in the request URL, so any error that quotes the
 * URL - fetch connection errors especially - would carry it into the logs.
 */
export function redactBotToken(text: string): string {
  return text
    .replace(BOT_TOKEN_URL, `bot${REDACTED}`)
    .replace(SLACK_WEBHOOK_URL, `https://hooks.slack.com/services/${REDACTED}`);
}

/**
 * For text this relay did not author: the rendered alert message, assembled
 * from whatever the alerted services logged. On top of the URL forms it strips
 * bare bot tokens by shape, and `secrets` by exact value — the shape rules are a
 * best effort against any token, the literal match is the guarantee that this
 * relay's own secrets cannot appear in its logs.
 *
 * Every occurrence is located against the original text, and overlapping ones
 * are merged into a single span before anything is rewritten. Rewriting as it
 * scanned was not enough on two counts. Replacing in sequence let each pass read
 * the markers earlier passes had written, so a secret as short as `red` turned a
 * redacted bot token into `bot<<redacted>acted>`. Replacing in one left-to-right
 * pass fixed that but still consumed the start of an overlapping credential and
 * left its tail behind: two secrets sharing a boundary redacted as
 * `<redacted>-BBBB`. Merging spans first means no character of any credential
 * survives, whatever order the credentials are in and however they overlap.
 *
 * The only caller is `RelayCredentials.redactLogText`, which owns the secret
 * set. Redaction is not offered as a standalone function elsewhere: a caller
 * choosing its own secret list is how a credential gets left out.
 */
export function stripSecrets(text: string, secrets: string[]): string {
  const spans = [
    ...patternSpans(text, BOT_TOKEN_URL, `bot${REDACTED}`, 0),
    ...patternSpans(
      text,
      SLACK_WEBHOOK_URL,
      `https://hooks.slack.com/services/${REDACTED}`,
      1
    ),
    ...patternSpans(text, BARE_BOT_TOKEN, REDACTED, 2),
    ...literalSpans(text, secrets),
  ];

  return redactSpans(text, spans);
}

/**
 * A stretch of text to remove. `priority` decides which marker a merged span
 * keeps: the URL forms name what was redacted (`bot<redacted>`), which is worth
 * preserving when one of them is the outermost match of the merge.
 */
interface RedactionSpan {
  start: number;
  end: number;
  marker: string;
  priority: number;
}

function patternSpans(
  text: string,
  pattern: RegExp,
  marker: string,
  priority: number
): RedactionSpan[] {
  return [...text.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    marker,
    priority,
  }));
}

/**
 * Every occurrence of every credential, overlapping ones included — the search
 * advances by one character rather than past the match it just found, so a
 * secret that overlaps itself is fully covered too.
 */
function literalSpans(text: string, secrets: string[]): RedactionSpan[] {
  const spans: RedactionSpan[] = [];

  for (const form of new Set(secrets.flatMap(secretForms))) {
    for (let from = 0; from <= text.length - form.length; from += 1) {
      const at = text.indexOf(form, from);
      if (at === -1) {
        break;
      }
      spans.push({
        start: at,
        end: at + form.length,
        marker: REDACTED,
        priority: 3,
      });
      from = at;
    }
  }

  return spans;
}

function redactSpans(text: string, spans: RedactionSpan[]): string {
  if (spans.length === 0) {
    return text;
  }

  // Leftmost first; at the same start the widest match leads, and between equals
  // the more specific pattern does, so a bot-token URL keeps its marker even
  // though the token literal inside it matches at the same time.
  const ordered = [...spans].sort(
    (left, right) =>
      left.start - right.start ||
      right.end - left.end ||
      left.priority - right.priority
  );

  let result = "";
  let cursor = 0;
  let index = 0;

  while (index < ordered.length) {
    const span = ordered[index];
    let end = span.end;
    let next = index + 1;

    // Touching counts as overlapping: contiguous credential material must not be
    // broken into two markers with a fragment of text conjured between them.
    while (next < ordered.length && ordered[next].start <= end) {
      end = Math.max(end, ordered[next].end);
      next += 1;
    }

    result += text.slice(cursor, span.start) + span.marker;
    cursor = end;
    index = next;
  }

  return result + text.slice(cursor);
}

/**
 * Every spelling of a credential that can reach a log line. Alert text is HTML
 * escaped before it is logged, so a secret containing `&`, `<` or `>` arrives in
 * escaped form and the raw literal would miss it entirely. The Slack rendering
 * reverses that escaping, so both forms have to go.
 *
 * There is no minimum length. A short or word-like secret makes log lines noisy
 * — every innocent occurrence of that word is redacted too — and that is the
 * intended direction: skipping it to keep logs readable is what turns "every
 * credential is redacted" into a claim that quietly does not hold. An empty
 * secret is the one exclusion: it matches at every position, and redacting it
 * would replace the whole message with markers.
 */
function secretForms(secret: string): string[] {
  const literal = secret.trim();
  if (literal.length === 0) {
    return [];
  }

  const escaped = escapeHtml(literal);
  return escaped === literal ? [literal] : [literal, escaped];
}
