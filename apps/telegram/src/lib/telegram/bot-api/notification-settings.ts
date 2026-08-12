import {
  admins,
  communities,
  type Community,
  type SummaryNotificationMessageCount,
  type SummaryNotificationTimeHours,
} from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";
import type { CallbackQueryContext, CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";

import { getDatabase } from "@/lib/core/database";

import { isMessageNotModifiedError } from "./callback-query-utils";
import { replyWithAutoCleanup } from "./helper-message-cleanup";

export const NOTIFICATION_SETTINGS_CALLBACK_PREFIX = "notif";
export const NOTIFICATION_SETTINGS_CONTEXT = "settings";
export const NOTIFICATION_SETTINGS_CALLBACK_DATA_REGEX =
  /^notif:settings:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}):(time|msg|master):(off|24|48|500|1000|on)$/;

export const UNAUTHORIZED_NOTIFICATION_SETTINGS_ALERT_TEXT =
  "Only authorized users can do this. Text @spacesymmetry if you want to change something.";
export const OUTDATED_NOTIFICATION_SETTINGS_ALERT_TEXT =
  "This settings panel is outdated. Run /notifications again.";

type NotificationDimension = "time" | "msg" | "master";
type NotificationSettingsCallbackData =
  | {
      communityId: string;
      dimension: "time";
      value: SummaryNotificationTimeHours | "off";
    }
  | {
      communityId: string;
      dimension: "msg";
      value: SummaryNotificationMessageCount | "off";
    }
  | {
      communityId: string;
      dimension: "master";
      value: "off" | "on";
    };

type NotificationSettingsState = Pick<
  Community,
  | "id"
  | "summaryNotificationsEnabled"
  | "summaryNotificationTimeHours"
  | "summaryNotificationMessageCount"
>;

export type NotificationSettingsUpdateValues = {
  summaryNotificationTimeHours?: SummaryNotificationTimeHours | null;
  summaryNotificationMessageCount?: SummaryNotificationMessageCount | null;
  summaryNotificationsEnabled?: boolean;
  updatedAt: Date;
};

export function encodeNotificationSettingsCallbackData(
  callbackData: NotificationSettingsCallbackData
): string {
  return `${NOTIFICATION_SETTINGS_CALLBACK_PREFIX}:${NOTIFICATION_SETTINGS_CONTEXT}:${callbackData.communityId}:${callbackData.dimension}:${callbackData.value}`;
}

export function parseNotificationSettingsCallbackData(
  data: string
): NotificationSettingsCallbackData | null {
  const matches = NOTIFICATION_SETTINGS_CALLBACK_DATA_REGEX.exec(data);
  if (!matches) {
    return null;
  }

  const communityId = matches[1];
  const dimension = matches[2] as NotificationDimension;
  const rawValue = matches[3];

  switch (dimension) {
    case "time":
      if (rawValue === "off") {
        return { communityId, dimension, value: "off" };
      }
      if (rawValue === "24" || rawValue === "48") {
        return {
          communityId,
          dimension,
          value: Number(rawValue) as SummaryNotificationTimeHours,
        };
      }
      return null;
    case "msg":
      if (rawValue === "off") {
        return { communityId, dimension, value: "off" };
      }
      if (rawValue === "500" || rawValue === "1000") {
        return {
          communityId,
          dimension,
          value: Number(rawValue) as SummaryNotificationMessageCount,
        };
      }
      return null;
    case "master":
      if (rawValue === "off" || rawValue === "on") {
        return { communityId, dimension, value: rawValue };
      }
      return null;
    default:
      return null;
  }
}

export function buildNotificationSettingsMessageText(): string {
  return [
    "Notification settings for this community",
    "",
    "⏱ <b>Time trigger</b>: Off | 24h | 48h",
    "🔔 <b>Master switch</b>: Off | On",
    "",
    "Only whitelisted admins can change these settings.",
  ].join("\n");
}

export function buildNotificationSettingsKeyboard(
  community: NotificationSettingsState
): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      renderButtonLabel(
        "⏱ Off",
        community.summaryNotificationTimeHours === null
      ),
      encodeNotificationSettingsCallbackData({
        communityId: community.id,
        dimension: "time",
        value: "off",
      })
    )
    .text(
      renderButtonLabel("⏱ 24h", community.summaryNotificationTimeHours === 24),
      encodeNotificationSettingsCallbackData({
        communityId: community.id,
        dimension: "time",
        value: 24,
      })
    )
    .text(
      renderButtonLabel("⏱ 48h", community.summaryNotificationTimeHours === 48),
      encodeNotificationSettingsCallbackData({
        communityId: community.id,
        dimension: "time",
        value: 48,
      })
    )
    .row()
    .text(
      renderButtonLabel("🔕 Off", !community.summaryNotificationsEnabled),
      encodeNotificationSettingsCallbackData({
        communityId: community.id,
        dimension: "master",
        value: "off",
      })
    )
    .text(
      renderButtonLabel("🔔 On", community.summaryNotificationsEnabled),
      encodeNotificationSettingsCallbackData({
        communityId: community.id,
        dimension: "master",
        value: "on",
      })
    );
}

export function buildNotificationSettingsUpdateValues(
  callbackData: NotificationSettingsCallbackData
): NotificationSettingsUpdateValues {
  const baseUpdate: NotificationSettingsUpdateValues = {
    updatedAt: new Date(),
  };

  switch (callbackData.dimension) {
    case "time":
      return {
        ...baseUpdate,
        summaryNotificationTimeHours:
          callbackData.value === "off" ? null : callbackData.value,
      };
    case "msg":
      return {
        ...baseUpdate,
        summaryNotificationMessageCount:
          callbackData.value === "off" ? null : callbackData.value,
      };
    case "master":
      return {
        ...baseUpdate,
        summaryNotificationsEnabled: callbackData.value === "on",
      };
  }
}

export async function sendNotificationSettingsMessage(
  ctx: CommandContext<Context>,
  community: NotificationSettingsState
): Promise<void> {
  await replyWithAutoCleanup(ctx, buildNotificationSettingsMessageText(), {
    parse_mode: "HTML",
    reply_markup: buildNotificationSettingsKeyboard(community),
  });
}

export async function handleNotificationSettingsCallback(
  ctx: CallbackQueryContext<Context>
): Promise<void> {
  const callbackData = parseNotificationSettingsCallbackData(
    ctx.callbackQuery.data
  );
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
    const telegramUserId = BigInt(ctx.from.id);
    const admin = await db.query.admins.findFirst({
      where: eq(admins.telegramId, telegramUserId),
    });

    if (!admin) {
      await ctx.answerCallbackQuery({
        text: UNAUTHORIZED_NOTIFICATION_SETTINGS_ALERT_TEXT,
        show_alert: true,
      });
      return;
    }

    const community = await db.query.communities.findFirst({
      where: eq(communities.id, callbackData.communityId),
    });
    const callbackMessage = ctx.callbackQuery.message;

    if (
      !community ||
      !callbackMessage ||
      String(community.chatId) !== String(callbackMessage.chat.id)
    ) {
      await ctx.answerCallbackQuery({
        text: OUTDATED_NOTIFICATION_SETTINGS_ALERT_TEXT,
        show_alert: true,
      });
      return;
    }

    await db
      .update(communities)
      .set(buildNotificationSettingsUpdateValues(callbackData))
      .where(eq(communities.id, community.id));

    const updatedCommunity = await db.query.communities.findFirst({
      where: eq(communities.id, community.id),
    });

    if (!updatedCommunity) {
      await ctx.answerCallbackQuery({
        text: OUTDATED_NOTIFICATION_SETTINGS_ALERT_TEXT,
        show_alert: true,
      });
      return;
    }

    try {
      await ctx.api.editMessageText(
        callbackMessage.chat.id,
        callbackMessage.message_id,
        buildNotificationSettingsMessageText(),
        {
          parse_mode: "HTML",
          reply_markup: buildNotificationSettingsKeyboard(updatedCommunity),
        }
      );
    } catch (error) {
      if (!isMessageNotModifiedError(error)) {
        throw error;
      }
    }

    await ctx.answerCallbackQuery({ text: "Notification settings updated" });
  } catch (error) {
    console.error("Failed to update notification settings", error);
    await ctx.answerCallbackQuery({
      text: "Unable to update notification settings right now.",
      show_alert: true,
    });
  }
}

function renderButtonLabel(label: string, isActive: boolean): string {
  return isActive ? `✅ ${label}` : label;
}
