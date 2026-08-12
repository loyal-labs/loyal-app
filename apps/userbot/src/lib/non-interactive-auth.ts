import type { UserbotConfig } from "./env";

const DEFAULT_NON_INTERACTIVE_MESSAGE =
  "Session is missing or invalid. Run bun run auth:bootstrap to re-authenticate.";

export type UserNonInteractiveAuthCallbacks = {
  code: () => Promise<string>;
  password: () => Promise<string>;
  phone: () => Promise<string>;
};

export type AuthStartParams =
  | { botToken: string }
  | UserNonInteractiveAuthCallbacks;

export function createNonInteractiveAuthCallbacks(
  message: string = DEFAULT_NON_INTERACTIVE_MESSAGE
): UserNonInteractiveAuthCallbacks {
  const throwAuthError = async (): Promise<string> => {
    throw new Error(message);
  };

  return {
    code: throwAuthError,
    password: throwAuthError,
    phone: throwAuthError,
  };
}

export function createBotTokenStartParams(config: UserbotConfig): {
  botToken: string;
} {
  if (!config.botToken) {
    throw new Error(
      "Bot auth mode selected but bot token is missing. Set TELEGRAM_USERBOT_BOT_TOKEN or ASKLOYAL_TGBOT_KEY."
    );
  }

  return {
    botToken: config.botToken,
  };
}

export function createNonInteractiveStartParams(
  config: UserbotConfig,
  userModeMessage: string = DEFAULT_NON_INTERACTIVE_MESSAGE
): AuthStartParams {
  if (config.authMode === "bot") {
    return createBotTokenStartParams(config);
  }

  return createNonInteractiveAuthCallbacks(userModeMessage);
}

export function buildReauthGuidance(config: UserbotConfig): string {
  if (config.authMode === "bot") {
    return "Check TELEGRAM_USERBOT_BOT_TOKEN or ASKLOYAL_TGBOT_KEY.";
  }

  return "Run bun run auth:bootstrap.";
}
