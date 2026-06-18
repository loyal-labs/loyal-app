import type { Bot } from "grammy";

import { getBot } from "@/lib/telegram/bot-api/bot";

type BotCommand = { command: string; description: string };

export const DEFAULT_CHAT_ID = "-1002981429221";

export const CHAT_USER_COMMANDS: BotCommand[] = [
  { command: "summary", description: "Get the latest chat summary" },
  { command: "ca", description: "Show $LOYAL contract address" },
];

export const CHAT_ADMIN_ONLY_COMMANDS: BotCommand[] = [
  {
    command: "notifications",
    description: "Configure summary notifications (admins only)",
  },
  {
    command: "activate_community",
    description: "Enable message tracking (admins only)",
  },
  {
    command: "deactivate_community",
    description: "Disable message tracking (admins only)",
  },
  {
    command: "hide",
    description: "Hide this community from public summaries (admins only)",
  },
  {
    command: "unhide",
    description: "Show this community in public summaries (admins only)",
  },
];

export const CHAT_ADMIN_COMMANDS: BotCommand[] = [
  ...CHAT_USER_COMMANDS,
  ...CHAT_ADMIN_ONLY_COMMANDS,
];

export async function registerCommandsForChat(
  bot: Bot,
  chatId: string = DEFAULT_CHAT_ID
): Promise<void> {
  await bot.api.setMyCommands(CHAT_USER_COMMANDS, {
    scope: { type: "chat", chat_id: chatId },
  });
  await bot.api.setMyCommands(CHAT_ADMIN_COMMANDS, {
    scope: { type: "chat_administrators", chat_id: chatId },
  });
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
