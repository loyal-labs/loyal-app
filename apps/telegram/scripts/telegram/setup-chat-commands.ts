import type { Bot } from "grammy";

import { getBot } from "@/lib/telegram/bot-api/bot";
import {
  LOYAL_CHAT_ADMIN_COMMANDS,
  LOYAL_CHAT_ADMIN_ONLY_COMMANDS,
  LOYAL_CHAT_USER_COMMANDS,
  registerCommandsForLoyalChat,
} from "@/lib/telegram/bot-api/register-commands";

export const DEFAULT_CHAT_ID = "-1002981429221";
export const CHAT_USER_COMMANDS = LOYAL_CHAT_USER_COMMANDS;
export const CHAT_ADMIN_ONLY_COMMANDS = LOYAL_CHAT_ADMIN_ONLY_COMMANDS;
export const CHAT_ADMIN_COMMANDS = LOYAL_CHAT_ADMIN_COMMANDS;

export async function registerCommandsForChat(
  bot: Bot,
  chatId: string = DEFAULT_CHAT_ID
): Promise<void> {
  if (chatId !== DEFAULT_CHAT_ID) {
    throw new Error(`Unsupported Telegram command chat: ${chatId}`);
  }

  await registerCommandsForLoyalChat(bot);
}

export async function runSetupChatCommands(
  chatId: string = DEFAULT_CHAT_ID
): Promise<void> {
  const bot = await getBot();
  await registerCommandsForChat(bot, chatId);
}

export async function runSetupChatCommandsCli(
  chatId: string = DEFAULT_CHAT_ID
): Promise<number> {
  try {
    await runSetupChatCommands(chatId);
    console.info(`Telegram bot commands registered for chat ${chatId}.`);
    return 0;
  } catch (error) {
    console.error(
      `Failed to register Telegram bot commands for chat ${chatId}.`,
      error
    );
    return 1;
  }
}

function isDirectExecution(scriptName: string): boolean {
  const entrypoint = process.argv[1];
  return typeof entrypoint === "string" && entrypoint.endsWith(scriptName);
}

if (isDirectExecution("setup-chat-commands.ts")) {
  const chatId = process.argv[2] ?? DEFAULT_CHAT_ID;
  process.exit(await runSetupChatCommandsCli(chatId));
}
