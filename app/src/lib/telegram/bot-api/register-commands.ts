import type { Bot } from "grammy";

import { LOYAL_COMMUNITY_CHAT_ID } from "./constants";

type BotCommand = { command: string; description: string };

export const LOYAL_CHAT_USER_COMMANDS: BotCommand[] = [
  { command: "summary", description: "Get the latest chat summary" },
  { command: "ca", description: "Show $LOYAL contract address" },
  { command: "stats", description: "Show Loyal performance stats" },
];

export const LOYAL_CHAT_ADMIN_ONLY_COMMANDS: BotCommand[] = [
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

export const LOYAL_CHAT_ADMIN_COMMANDS: BotCommand[] = [
  ...LOYAL_CHAT_USER_COMMANDS,
  ...LOYAL_CHAT_ADMIN_ONLY_COMMANDS,
];

export async function registerCommandsForLoyalChat(bot: Bot): Promise<void> {
  await bot.api.setMyCommands(LOYAL_CHAT_USER_COMMANDS, {
    scope: { type: "chat", chat_id: LOYAL_COMMUNITY_CHAT_ID },
  });
  await bot.api.setMyCommands(LOYAL_CHAT_ADMIN_COMMANDS, {
    scope: {
      type: "chat_administrators",
      chat_id: LOYAL_COMMUNITY_CHAT_ID,
    },
  });
}

export async function registerBotCommands(bot: Bot): Promise<void> {
  // Commands for private chats
  await bot.api.setMyCommands(
    [
      { command: "start", description: "Start the bot and get help" },
      {
        command: "settings",
        description: "Manage your private notification settings",
      },
    ],
    { scope: { type: "all_private_chats" } }
  );

  // Commands for group chats
  await bot.api.setMyCommands(LOYAL_CHAT_ADMIN_COMMANDS, {
    scope: { type: "all_group_chats" },
  });

  await registerCommandsForLoyalChat(bot);
}
