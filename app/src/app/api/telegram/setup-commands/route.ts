import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/core/config/server";
import { getBot } from "@/lib/telegram/bot-api/bot";
import { LOYAL_COMMUNITY_CHAT_ID } from "@/lib/telegram/bot-api/constants";
import { registerBotCommands } from "@/lib/telegram/bot-api/register-commands";

export async function POST(request: Request) {
  let expectedToken: string;
  try {
    expectedToken = serverEnv.telegramSetupSecret;
  } catch {
    console.error("TELEGRAM_SETUP_SECRET environment variable is not set");
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use timing-safe comparison to prevent timing attacks
  const expected = Buffer.from(`Bearer ${expectedToken}`);
  const provided = Buffer.from(authHeader);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const bot = await getBot();
    await registerBotCommands(bot);
    const [groupCommands, chatCommands, adminCommands] = await Promise.all([
      bot.api.getMyCommands({ scope: { type: "all_group_chats" } }),
      bot.api.getMyCommands({
        scope: { type: "chat", chat_id: LOYAL_COMMUNITY_CHAT_ID },
      }),
      bot.api.getMyCommands({
        scope: {
          type: "chat_administrators",
          chat_id: LOYAL_COMMUNITY_CHAT_ID,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      message: "Commands registered",
      commands: {
        administrators: adminCommands.map(({ command }) => command),
        chat: chatCommands.map(({ command }) => command),
        groups: groupCommands.map(({ command }) => command),
      },
    });
  } catch (error) {
    console.error("Failed to register commands:", error);
    return NextResponse.json(
      { error: "Failed to register commands" },
      { status: 500 }
    );
  }
}
