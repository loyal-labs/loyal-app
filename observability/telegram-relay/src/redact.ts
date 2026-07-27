/**
 * The bot token is embedded in the request URL, so any error that quotes the
 * URL - fetch connection errors especially - would carry it into the logs.
 */
export function redactBotToken(text: string): string {
  return text.replace(/bot\d+:[\w-]+/g, "bot<redacted>");
}

/**
 * A Postgres driver quotes the connection string in most of its errors, and
 * that string carries the database password. Same reasoning as the bot token:
 * the relay logs to Render's stdout, so a credential in an error message is a
 * credential in the log.
 */
export function redactConnectionCredentials(text: string): string {
  return text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1<redacted>@");
}

/** Both redactions, for anywhere an error of unknown origin is logged. */
export function redactSecrets(text: string): string {
  return redactConnectionCredentials(redactBotToken(text));
}
