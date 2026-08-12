import { Bot } from "grammy";

import { serverEnv } from "@/lib/core/config/server";

let bot: Bot | null = null;

export const getBot = async (): Promise<Bot> => {
  const token = serverEnv.askLoyalBotToken;

  if (bot) return bot;
  bot = new Bot(token);
  return bot;
};
