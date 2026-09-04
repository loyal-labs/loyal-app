import type { UserSettings } from "@loyal-labs/db-core/schema";
import { userSettings } from "@loyal-labs/db-core/schema";
import { users } from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";
import {
  type CallbackQueryContext,
  type CommandContext,
  type Context,
  InlineKeyboard,
} from "grammy";

import { getDatabase } from "@/lib/core/database";
import { getOrCreateUser } from "@/lib/telegram/user-service";

import { isMessageNotModifiedError } from "./callback-query-utils";

export const USER_SETTINGS_CALLBACK_PREFIX = "usr";
export const USER_SETTINGS_CONTEXT = "settings";
export const USER_SETTINGS_CALLBACK_DATA_REGEX =
  /^usr:settings:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}):(notif):(on|off)$/;

export const UNAUTHORIZED_USER_SETTINGS_ALERT_TEXT =
  "This settings panel belongs to a different user account.";
export const OUTDATED_USER_SETTINGS_ALERT_TEXT =
  "This settings panel is outdated. Run /settings again.";

type UserSettingsCallbackData = {
  userId: string;
  dimension: "notif";
  value: "off" | "on";
};

type UserSettingsState = Pick<
  UserSettings,
  "model" | "notifications" | "userId"
>;

export type UserSettingsUpdateValues = {
  notifications: boolean;
  updatedAt: Date;
};

export type DisableNotificationsForTelegramUserInput = {
  telegramUserId: bigint;
  username?: string | null;
  displayName?: string | null;
};

export function encodeUserSettingsCallbackData(
  callbackData: UserSettingsCallbackData
): string {
  return `${USER_SETTINGS_CALLBACK_PREFIX}:${USER_SETTINGS_CONTEXT}:${callbackData.userId}:${callbackData.dimension}:${callbackData.value}`;
}

export function parseUserSettingsCallbackData(
  data: string
): UserSettingsCallbackData | null {
  const matches = USER_SETTINGS_CALLBACK_DATA_REGEX.exec(data);
  if (!matches) {
    return null;
  }

  const userId = matches[1];
  const dimension = matches[2];
  const rawValue = matches[3];

  if (dimension !== "notif") {
    return null;
  }

  if (rawValue !== "off" && rawValue !== "on") {
    return null;
  }

  return {
    userId,
    dimension: "notif",
    value: rawValue,
  };
}

export function buildUserSettingsMessageText(model: string): string {
  return [
    "Your notification settings",
    "",
    "Toggle sound notifications for this bot in your private chat.",
    "",
    `Current model: <code>${escapeHtml(model)}</code>`,
  ].join("\n");
}

export function buildUserSettingsKeyboard(
  userId: string,
  notifications: boolean
): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      renderButtonLabel("🔕 Off", !notifications),
      encodeUserSettingsCallbackData({
        userId,
        dimension: "notif",
        value: "off",
      })
    )
    .text(
      renderButtonLabel("🔔 On", notifications),
      encodeUserSettingsCallbackData({
        userId,
        dimension: "notif",
        value: "on",
      })
    );
}

export function buildUserSettingsUpdateValues(
  callbackData: UserSettingsCallbackData
): UserSettingsUpdateValues {
  return {
    notifications: callbackData.value === "on",
    updatedAt: new Date(),
  };
}

function resolveDisplayName(
  input: DisableNotificationsForTelegramUserInput
): string {
  if (input.displayName && input.displayName.trim().length > 0) {
    return input.displayName;
  }

  if (input.username && input.username.trim().length > 0) {
    return input.username;
  }

  return `Telegram User ${input.telegramUserId.toString()}`;
}

export async function disableNotificationsForTelegramUser(
  input: DisableNotificationsForTelegramUserInput
): Promise<void> {
  const userId = await getOrCreateUser(
    input.telegramUserId,
    {
      displayName: resolveDisplayName(input),
      username: input.username ?? null,
    },
    {
      backfillAvatar: false,
    }
  );
  const now = new Date();
  const db = getDatabase();

  await db
    .insert(userSettings)
    .values({
      notifications: false,
      updatedAt: now,
      userId,
    })
    .onConflictDoUpdate({
      set: {
        notifications: false,
        updatedAt: now,
      },
      target: userSettings.userId,
    });
}

export async function isNotificationsEnabledForTelegramUser(
  telegramUserId: bigint
): Promise<boolean> {
  const db = getDatabase();
  const user = await db.query.users.findFirst({
    columns: { id: true },
    where: eq(users.telegramId, telegramUserId),
  });

  if (!user) {
    return true;
  }

  return isNotificationsEnabledForUserId(user.id);
}

export async function isNotificationsEnabledForUserId(
  userId: string
): Promise<boolean> {
  const db = getDatabase();
  const settings = await db.query.userSettings.findFirst({
    columns: { notifications: true },
    where: eq(userSettings.userId, userId),
  });

  if (!settings) {
    return true;
  }

  return settings.notifications;
}

export async function sendUserSettingsMessage(
  ctx: CommandContext<Context>,
  settings: UserSettingsState
): Promise<void> {
  await ctx.reply(buildUserSettingsMessageText(settings.model), {
    parse_mode: "HTML",
    reply_markup: buildUserSettingsKeyboard(
      settings.userId,
      settings.notifications
    ),
  });
}

export async function handleUserSettingsCallback(
  ctx: CallbackQueryContext<Context>
): Promise<void> {
  const callbackData = parseUserSettingsCallbackData(ctx.callbackQuery.data);
  if (!callbackData) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (!ctx.from) {
    await ctx.answerCallbackQuery();
    return;
  }

  try {
    const db = getDatabase();
    const actor = await db.query.users.findFirst({
      where: eq(users.telegramId, BigInt(ctx.from.id)),
      columns: {
        id: true,
      },
    });

    if (!actor || actor.id !== callbackData.userId) {
      await ctx.answerCallbackQuery({
        text: UNAUTHORIZED_USER_SETTINGS_ALERT_TEXT,
        show_alert: true,
      });
      return;
    }

    const callbackMessage = ctx.callbackQuery.message;
    if (!callbackMessage || callbackMessage.chat.id !== ctx.from.id) {
      await ctx.answerCallbackQuery({
        text: OUTDATED_USER_SETTINGS_ALERT_TEXT,
        show_alert: true,
      });
      return;
    }

    const currentSettings = await db.query.userSettings.findFirst({
      where: eq(userSettings.userId, callbackData.userId),
    });

    if (!currentSettings) {
      await ctx.answerCallbackQuery({
        text: OUTDATED_USER_SETTINGS_ALERT_TEXT,
        show_alert: true,
      });
      return;
    }

    await db
      .update(userSettings)
      .set(buildUserSettingsUpdateValues(callbackData))
      .where(eq(userSettings.userId, callbackData.userId));

    const updatedSettings = await db.query.userSettings.findFirst({
      where: eq(userSettings.userId, callbackData.userId),
    });

    if (!updatedSettings) {
      await ctx.answerCallbackQuery({
        text: OUTDATED_USER_SETTINGS_ALERT_TEXT,
        show_alert: true,
      });
      return;
    }

    try {
      await ctx.api.editMessageText(
        callbackMessage.chat.id,
        callbackMessage.message_id,
        buildUserSettingsMessageText(updatedSettings.model),
        {
          parse_mode: "HTML",
          reply_markup: buildUserSettingsKeyboard(
            updatedSettings.userId,
            updatedSettings.notifications
          ),
        }
      );
    } catch (error) {
      if (!isMessageNotModifiedError(error)) {
        throw error;
      }
    }

    await ctx.answerCallbackQuery({ text: "Settings updated" });
  } catch (error) {
    console.error("Failed to update user settings", error);
    await ctx.answerCallbackQuery({
      text: "Unable to update settings right now.",
      show_alert: true,
    });
  }
}

function renderButtonLabel(label: string, isActive: boolean): string {
  return isActive ? `✅ ${label}` : label;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
