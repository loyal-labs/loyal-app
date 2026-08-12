import {
  type Bot,
  type CallbackQueryContext,
  type CommandContext,
  type Context,
  InlineKeyboard,
} from "grammy";

import { resolveEndpoint } from "@/lib/core/api";
import { MINI_APP_LINK } from "@/lib/telegram/constants";

type StartCarouselAction = "prev" | "next";

export type StartCarouselSlide = {
  imagePath: string;
  caption: string;
};

type ParsedStartCarouselCallback = {
  action: StartCarouselAction;
  currentIndex: number;
};

export const START_CAROUSEL_CALLBACK_PREFIX = "start_carousel";
export const START_CAROUSEL_CALLBACK_DATA_REGEX =
  /^start_carousel:(prev|next):(\d+)$/;

export const START_CAROUSEL_SLIDES: StartCarouselSlide[] = [
  {
    imagePath: "/bot/start-carousel-1.png",
    caption: "See what’s happening in group chats you don’t have time to read.",
  },
  // {
  //   imagePath: "/bot/start-carousel-2.png",
  //   caption: "Quickly review and manage your Telegram DMs in one place.",
  // },
  {
    imagePath: "/bot/start-carousel-3.png",
    caption:
      "Securely hold and manage your digital assets with privacy protection built into the system.",
  },
  {
    imagePath: "/bot/start-carousel-4.png",
    caption: "Send and receive funds without exposing balances or history.",
  },
  {
    imagePath: "/bot/start-carousel-5.png",
    caption:
      "A private AI chat where your questions and conversations stay confidential.",
  },
];

export function encodeStartCarouselCallbackData(
  action: StartCarouselAction,
  currentIndex: number
): string {
  return `${START_CAROUSEL_CALLBACK_PREFIX}:${action}:${currentIndex}`;
}

export function parseStartCarouselCallbackData(
  data: string
): ParsedStartCarouselCallback | null {
  const matches = START_CAROUSEL_CALLBACK_DATA_REGEX.exec(data);
  if (!matches) {
    return null;
  }

  const rawAction = matches[1];
  const rawIndex = matches[2];

  if (rawAction !== "prev" && rawAction !== "next") {
    return null;
  }

  const currentIndex = Number(rawIndex);
  if (
    !Number.isInteger(currentIndex) ||
    currentIndex < 0 ||
    currentIndex >= START_CAROUSEL_SLIDES.length
  ) {
    return null;
  }

  return {
    action: rawAction,
    currentIndex,
  };
}

export function calculateNextCarouselIndex(
  currentIndex: number,
  action: StartCarouselAction
): number {
  const slideCount = START_CAROUSEL_SLIDES.length;
  if (action === "prev") {
    return (currentIndex - 1 + slideCount) % slideCount;
  }
  return (currentIndex + 1) % slideCount;
}

export function buildStartCarouselKeyboard(
  currentIndex: number
): InlineKeyboard {
  return new InlineKeyboard()
    .text("⬅️", encodeStartCarouselCallbackData("prev", currentIndex))
    .text("➡️", encodeStartCarouselCallbackData("next", currentIndex))
    .row()
    .url("Go Loyal", MINI_APP_LINK);
}

function getSlideImageUrl(index: number): string {
  return resolveEndpoint(START_CAROUSEL_SLIDES[index].imagePath);
}

export async function sendStartCarousel(
  ctx: CommandContext<Context>,
  bot: Bot
): Promise<void> {
  const chatId = ctx.chat?.id ?? ctx.from?.id;
  const messageThreadId = ctx.message?.message_thread_id;
  if (!chatId) {
    console.error("Chat ID not found in start command");
    return;
  }

  const initialIndex = 0;
  const initialSlide = START_CAROUSEL_SLIDES[initialIndex];

  await bot.api.sendPhoto(chatId, getSlideImageUrl(initialIndex), {
    caption: initialSlide.caption,
    message_thread_id: messageThreadId,
    reply_markup: buildStartCarouselKeyboard(initialIndex),
  });
}

export async function handleStartCarouselCallback(
  ctx: CallbackQueryContext<Context>
): Promise<void> {
  const callbackData = ctx.callbackQuery.data;
  const parsedCallback = parseStartCarouselCallbackData(callbackData);
  if (!parsedCallback) {
    return;
  }

  const callbackMessage = ctx.callbackQuery.message;
  const chatId = callbackMessage?.chat.id;
  const messageId = callbackMessage?.message_id;

  if (!chatId || !messageId) {
    await ctx.answerCallbackQuery();
    return;
  }

  const nextIndex = calculateNextCarouselIndex(
    parsedCallback.currentIndex,
    parsedCallback.action
  );
  const nextSlide = START_CAROUSEL_SLIDES[nextIndex];

  try {
    await ctx.api.editMessageMedia(
      chatId,
      messageId,
      {
        type: "photo",
        media: getSlideImageUrl(nextIndex),
        caption: nextSlide.caption,
      },
      {
        reply_markup: buildStartCarouselKeyboard(nextIndex),
      }
    );
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error("Failed to update start carousel slide", error);
    await ctx.answerCallbackQuery({
      text: "Unable to update onboarding slide right now.",
    });
  }
}
