import { stripSecrets } from "./redact.ts";

export interface CredentialValues {
  clickStackWebhookSecret: string;
  telegramBotToken: string;
  telegramChatId: string;
  slackWebhookUrl: string;
}

/**
 * Every credential the relay holds, together with the redaction built over
 * them, as one value that cannot be taken apart.
 *
 * The binding is the point. A sender posts with `telegramBotToken` and logs
 * through `redactLogText`, and both come from this same object, so redaction
 * always covers the credentials actually in use. Holding them as separate
 * config fields did not: `{ ...config, telegramBotToken: other }` type-checked
 * and kept redaction built over the previous token, which would then print the
 * new one in full.
 *
 * The private field is what enforces it. It makes the class nominal, so no
 * object literal and no spread of an existing instance is assignable to
 * `RelayCredentials` — swapping one credential means constructing a new
 * instance, which rebuilds the secret set from the values it was given. Every
 * instance is therefore self-consistent by construction, whoever built it.
 */
export class RelayCredentials {
  readonly #secrets: string[];

  readonly clickStackWebhookSecret: string;
  readonly telegramBotToken: string;
  readonly telegramChatId: string;
  readonly slackWebhookUrl: string;

  constructor(values: CredentialValues) {
    this.clickStackWebhookSecret = values.clickStackWebhookSecret;
    this.telegramBotToken = values.telegramBotToken;
    this.telegramChatId = values.telegramChatId;
    this.slackWebhookUrl = values.slackWebhookUrl;

    // The chat id is not a secret: it is in the Blueprint and in every alert's
    // delivery target. Redacting it would only make logs harder to read.
    this.#secrets = [
      values.clickStackWebhookSecret,
      values.telegramBotToken,
      values.slackWebhookUrl,
    ];
  }

  /**
   * Strips these credentials out of text the relay did not author. Called as a
   * method, never detached: it reads `#secrets` off `this`.
   */
  redactLogText(text: string): string {
    return stripSecrets(text, this.#secrets);
  }
}
