import type { Bot } from "grammy";

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
  await bot.api.setMyCommands(
    [
      { command: "summary", description: "Get the latest chat summary" },
      { command: "ca", description: "Show $LOYAL contract address" },
      { command: "stats", description: "Show Loyal performance stats" },
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
    ],
    { scope: { type: "all_group_chats" } }
  );
}
