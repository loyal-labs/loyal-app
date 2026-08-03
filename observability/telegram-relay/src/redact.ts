/**
 * The bot token is embedded in the request URL, so any error that quotes the
 * URL - fetch connection errors especially - would carry it into the logs.
 */
export function redactBotToken(text: string): string {
  return text
    .replace(/bot\d+:[\w-]+/g, "bot<redacted>")
    .replace(
      /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g,
      "https://hooks.slack.com/services/<redacted>"
    );
}
