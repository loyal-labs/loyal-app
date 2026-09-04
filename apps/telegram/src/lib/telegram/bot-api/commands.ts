import {
  admins,
  communities,
  type Community,
  userSettings,
} from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";
import type { CommandContext, Context } from "grammy";
import { Bot, InlineKeyboard } from "grammy";

import { getDatabase } from "@/lib/core/database";
import { fetchTokenMetricsByMint } from "@/lib/jupiter/server";
import { captureCommunityPhotoToCdn } from "@/lib/telegram/community-photo-service";
import { MINI_APP_LINK } from "@/lib/telegram/constants";
import { getOrCreateUser } from "@/lib/telegram/user-service";
import { getTelegramDisplayName, isCommunityChat } from "@/lib/telegram/utils";

import {
  createBotTrackingProperties,
  type MixpanelTrackProperties,
  trackBotEvent,
} from "./analytics";
import {
  createCaCommandKeyboard,
  formatCaCommandMessage,
  LOYAL_CA_ADDRESS,
} from "./ca-command";
import { LOYAL_COMMUNITY_CHAT_ID } from "./constants";
import { replyWithAutoCleanup } from "./helper-message-cleanup";
import { evictActiveCommunityCache } from "./message-handlers";
import { sendNotificationSettingsMessage } from "./notification-settings";
import { formatStatsCommandMessage } from "./stats-command";
import {
  claimStatsCommand,
  completeStatsCommand,
  loadLoyalStatsSnapshot,
  type LoyalStatsSnapshotResult,
  type StatsCommandClaim,
  type StatsCommandCompletion,
} from "./stats-persistence.server";
import { sendLatestSummary } from "./summaries";
import type { HandleSummaryCommandOptions } from "./types";
import { sendUserSettingsMessage } from "./user-settings";

const SETTINGS_LOAD_ERROR_REPLY_TEXT =
  "Unable to load your settings right now. Please try again.";
type CommunityCommandName =
  | "/activate_community"
  | "/deactivate_community"
  | "/hide"
  | "/unhide"
  | "/summary"
  | "/notifications";

const BOT_START_COMMAND_EVENT = "Bot /start Command";
const BOT_SUMMARY_COMMAND_EVENT = "Bot /summary Command";

function createCommandTrackingProperties(
  ctx: CommandContext<Context>
): MixpanelTrackProperties {
  return createBotTrackingProperties({
    chatId: ctx.chat?.id,
    chatType: ctx.chat?.type,
    userId: ctx.from?.id,
  });
}

async function isWhitelistedAdmin(
  db: ReturnType<typeof getDatabase>,
  telegramUserId: bigint
): Promise<boolean> {
  const admin = await db.query.admins.findFirst({
    where: eq(admins.telegramId, telegramUserId),
  });

  return Boolean(admin);
}

type CommunityReplyOptions = Parameters<typeof replyWithAutoCleanup>[2];

async function replyCommunitySuccess(
  ctx: CommandContext<Context>,
  text: string,
  options?: CommunityReplyOptions
): Promise<void> {
  await replyWithAutoCleanup(ctx, text, options);
}

function suppressCommunityFailure(
  command: CommunityCommandName,
  reason: string,
  ctx: CommandContext<Context>,
  error?: unknown
): void {
  const details = {
    command,
    reason,
    telegram_chat_id: ctx.chat ? String(ctx.chat.id) : null,
    telegram_chat_type: ctx.chat?.type ?? null,
    telegram_user_id: ctx.from ? String(ctx.from.id) : null,
  };

  if (error) {
    console.error("Suppressed community command reply", {
      ...details,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  console.warn("Suppressed community command reply", details);
}

async function findActiveCommunity(
  ctx: CommandContext<Context>,
  db: ReturnType<typeof getDatabase>
) {
  if (!ctx.chat) {
    return null;
  }

  const chatId = BigInt(ctx.chat.id);
  const existingCommunity = await db.query.communities.findFirst({
    where: eq(communities.chatId, chatId),
  });

  if (!existingCommunity || !existingCommunity.isActive) {
    return null;
  }

  return existingCommunity;
}

function mergeCommunitySettings(
  existingSettings: unknown,
  nextSettings: Record<string, unknown>
): Record<string, unknown> {
  const current =
    existingSettings && typeof existingSettings === "object"
      ? (existingSettings as Record<string, unknown>)
      : {};

  const mergedSettings: Record<string, unknown> = {
    ...current,
    ...nextSettings,
  };

  if (
    typeof nextSettings.photoUrl === "string" &&
    nextSettings.photoUrl.length > 0
  ) {
    delete mergedSettings.photoBase64;
    delete mergedSettings.photoMimeType;
  }

  return mergedSettings;
}

async function syncActivationForExistingCommunity(params: {
  ctx: CommandContext<Context>;
  db: ReturnType<typeof getDatabase>;
  existingCommunity: Community;
  settings: Record<string, unknown>;
}): Promise<void> {
  const mergedSettings = mergeCommunitySettings(
    params.existingCommunity.settings,
    params.settings
  );

  if (params.existingCommunity.isActive) {
    await params.db
      .update(communities)
      .set({
        chatTitle: params.ctx.chat?.title || "Untitled",
        settings: mergedSettings,
        updatedAt: new Date(),
      })
      .where(eq(communities.id, params.existingCommunity.id));
    await replyCommunitySuccess(
      params.ctx,
      "Community is already activated. Data updated!"
    );
    return;
  }

  await params.db
    .update(communities)
    .set({
      isActive: true,
      chatTitle: params.ctx.chat?.title || "Untitled",
      settings: mergedSettings,
      updatedAt: new Date(),
    })
    .where(eq(communities.id, params.existingCommunity.id));
  await replyCommunitySuccess(
    params.ctx,
    "Community reactivated for message tracking!"
  );
}

const SUNSET_MESSAGE =
  "The Loyal Telegram app is sunset. Loyal now lives at askloyal.com.\n\n" +
  "If you have a wallet in the Telegram app, open the app to export your private key.";

export async function handleStartCommand(
  ctx: CommandContext<Context>,
  _bot: Bot
): Promise<void> {
  const keyboard = new InlineKeyboard()
    .url("Open askloyal.com", "https://askloyal.com")
    .row()
    .url("Export wallet key", MINI_APP_LINK);
  await ctx.reply(SUNSET_MESSAGE, {
    reply_markup: keyboard,
    message_thread_id: ctx.message?.message_thread_id,
  });
  trackBotEvent(BOT_START_COMMAND_EVENT, createCommandTrackingProperties(ctx));
}

export async function handleCaCommand(
  ctx: CommandContext<Context>,
  bot: Bot
): Promise<void> {
  const caAddress = LOYAL_CA_ADDRESS;
  const keyboard = createCaCommandKeyboard(caAddress);

  const chatId = ctx.chat?.id;
  if (!chatId) {
    console.error("Chat ID not found in ca command");
    return;
  }

  // Only respond in the designated community chat
  if (chatId !== Number(LOYAL_COMMUNITY_CHAT_ID)) {
    return;
  }

  let metrics = null;

  try {
    metrics = await fetchTokenMetricsByMint(caAddress);
  } catch (error) {
    console.error("Failed to fetch Jupiter data for ca command", error);
  }

  await bot.api.sendMessage(
    chatId,
    formatCaCommandMessage(caAddress, metrics),
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    }
  );
}

const STATS_COMMAND_DEADLINE_MS = 7_000;
const STATS_COMMAND_COMPLETION_TIMEOUT_MS = 500;

export type StatsCommandDependencies = {
  claimCommand: (input: StatsCommandClaim) => Promise<boolean>;
  completeCommand: (input: StatsCommandCompletion) => Promise<void>;
  loadSnapshot: () => Promise<LoyalStatsSnapshotResult>;
  now: () => number;
};

const statsCommandDependencies: StatsCommandDependencies = {
  claimCommand: claimStatsCommand,
  completeCommand: completeStatsCommand,
  loadSnapshot: loadLoyalStatsSnapshot,
  now: Date.now,
};

function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function getRemainingStatsCommandTime(
  deadlineAt: number,
  now: () => number
): number {
  return Math.max(1, deadlineAt - now());
}

function getStatsCommandUpdateId(ctx: CommandContext<Context>): number | null {
  const updateId = ctx.update.update_id;
  return Number.isSafeInteger(updateId) && updateId >= 0 ? updateId : null;
}

function getStatsCommandLogContext(params: {
  chatId: number;
  dependencies: StatsCommandDependencies;
  startedAt: number;
  updateId: number | null;
}) {
  return {
    chatId: String(params.chatId),
    command: "/stats",
    elapsedMs: Math.max(0, params.dependencies.now() - params.startedAt),
    updateId: params.updateId === null ? null : String(params.updateId),
  };
}

export async function handleStatsCommand(
  ctx: CommandContext<Context>,
  bot: Bot,
  dependencies: StatsCommandDependencies = statsCommandDependencies
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || chatId !== Number(LOYAL_COMMUNITY_CHAT_ID)) {
    return;
  }

  const startedAt = dependencies.now();
  const deadlineAt = startedAt + STATS_COMMAND_DEADLINE_MS;
  const updateId = getStatsCommandUpdateId(ctx);
  if (updateId === null) {
    console.error("/stats command failed", {
      ...getStatsCommandLogContext({
        chatId,
        dependencies,
        startedAt,
        updateId,
      }),
      errorMessage: "Telegram update ID is missing or invalid",
      errorName: "InvalidTelegramUpdateError",
      outcome: "failed",
      stage: "validate",
    });
    return;
  }

  let claimed = false;
  let stage = "claim";

  try {
    claimed = await runWithTimeout(
      dependencies.claimCommand({
        chatId,
        telegramUserId: ctx.from?.id,
        updateId,
      }),
      getRemainingStatsCommandTime(deadlineAt, dependencies.now),
      "/stats command claim"
    );

    if (!claimed) {
      console.info("/stats command duplicate skipped", {
        ...getStatsCommandLogContext({
          chatId,
          dependencies,
          startedAt,
          updateId,
        }),
        outcome: "duplicate",
      });
      return;
    }

    console.info("/stats command claimed", {
      ...getStatsCommandLogContext({
        chatId,
        dependencies,
        startedAt,
        updateId,
      }),
      outcome: "claimed",
    });

    stage = "load_snapshot";
    const snapshot = await runWithTimeout(
      dependencies.loadSnapshot(),
      getRemainingStatsCommandTime(deadlineAt, dependencies.now),
      "/stats snapshot load"
    );

    stage = "send";
    const message = await runWithTimeout(
      bot.api.sendMessage(chatId, formatStatsCommandMessage(snapshot.stats), {
        parse_mode: "Markdown",
      }),
      getRemainingStatsCommandTime(deadlineAt, dependencies.now),
      "/stats response send"
    );

    stage = "complete";
    await runWithTimeout(
      dependencies.completeCommand({
        messageId: message.message_id,
        status: "completed",
        updateId,
      }),
      STATS_COMMAND_COMPLETION_TIMEOUT_MS,
      "/stats receipt completion"
    );

    console.info("/stats command completed", {
      ...getStatsCommandLogContext({
        chatId,
        dependencies,
        startedAt,
        updateId,
      }),
      messageId: message.message_id,
      outcome: "completed",
      snapshotAgeMs: snapshot.ageMs,
    });
  } catch (error) {
    console.error("/stats command failed", {
      ...getStatsCommandLogContext({
        chatId,
        dependencies,
        startedAt,
        updateId,
      }),
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "UnknownError",
      outcome: "failed",
      stage,
    });

    if (!claimed) {
      return;
    }

    if (stage === "complete") {
      return;
    }

    let failureMessageId: number | undefined;
    if (stage === "load_snapshot") {
      try {
        const failureMessage = await runWithTimeout(
          bot.api.sendMessage(
            chatId,
            "Loyal stats are unavailable right now. Please try again shortly."
          ),
          getRemainingStatsCommandTime(deadlineAt, dependencies.now),
          "/stats failure response send"
        );
        failureMessageId = failureMessage.message_id;
      } catch (sendError) {
        console.error("/stats failure response send failed", {
          ...getStatsCommandLogContext({
            chatId,
            dependencies,
            startedAt,
            updateId,
          }),
          error: sendError,
          errorMessage:
            sendError instanceof Error ? sendError.message : String(sendError),
          errorName:
            sendError instanceof Error ? sendError.name : "UnknownError",
          outcome: "failed",
          stage: "send_failure",
        });
      }
    }

    try {
      await runWithTimeout(
        dependencies.completeCommand({
          messageId: failureMessageId,
          status: "failed",
          updateId,
        }),
        STATS_COMMAND_COMPLETION_TIMEOUT_MS,
        "/stats failed receipt completion"
      );
    } catch (completionError) {
      console.error("/stats failed receipt completion failed", {
        ...getStatsCommandLogContext({
          chatId,
          dependencies,
          startedAt,
          updateId,
        }),
        error: completionError,
        errorMessage:
          completionError instanceof Error
            ? completionError.message
            : String(completionError),
        errorName:
          completionError instanceof Error
            ? completionError.name
            : "UnknownError",
        outcome: "failed",
        stage: "complete_failure",
      });
    }
  }
}

export async function handleActivateCommunityCommand(
  ctx: CommandContext<Context>
): Promise<void> {
  if (!ctx.from || !ctx.chat) return;

  // Delete the command message to keep chat clean
  try {
    await ctx.deleteMessage();
  } catch (error) {
    console.warn("Failed to delete /activate_community command message", error);
  }

  if (!isCommunityChat(ctx.chat.type)) {
    await replyWithAutoCleanup(
      ctx,
      "This command can only be used in group chats."
    );
    return;
  }

  const telegramUserId = BigInt(ctx.from.id);

  try {
    const db = getDatabase();

    if (!(await isWhitelistedAdmin(db, telegramUserId))) {
      suppressCommunityFailure("/activate_community", "unauthorized", ctx);
      return;
    }

    const chatId = BigInt(ctx.chat.id);

    // Fetch community photo (non-blocking on failure)
    const photoUrl = await captureCommunityPhotoToCdn(ctx.chat.id);
    const settings = photoUrl
      ? {
          photoUrl,
          photoUpdatedAt: new Date().toISOString(),
        }
      : {};

    // Check if community already exists
    const existingCommunity = await db.query.communities.findFirst({
      where: eq(communities.chatId, chatId),
    });

    if (existingCommunity) {
      await syncActivationForExistingCommunity({
        ctx,
        db,
        existingCommunity,
        settings,
      });
      return;
    }

    // Ensure user exists in the users table
    const displayName = getTelegramDisplayName(ctx.from);
    await getOrCreateUser(telegramUserId, {
      username: ctx.from.username || null,
      displayName,
    });

    // Race-safe insert: another request may activate the same chat concurrently.
    const inserted = await db
      .insert(communities)
      .values({
        chatId,
        chatTitle: ctx.chat.title || "Untitled",
        activatedBy: telegramUserId,
        isPublic: false,
        settings,
      })
      .onConflictDoNothing()
      .returning({ id: communities.id });

    if (inserted.length > 0) {
      await replyCommunitySuccess(
        ctx,
        "Community activated for message tracking!"
      );
      return;
    }

    const racedCommunity = await db.query.communities.findFirst({
      where: eq(communities.chatId, chatId),
    });
    if (!racedCommunity) {
      suppressCommunityFailure(
        "/activate_community",
        "insert_conflict_community_missing",
        ctx
      );
      return;
    }

    await syncActivationForExistingCommunity({
      ctx,
      db,
      existingCommunity: racedCommunity,
      settings,
    });
  } catch (error) {
    suppressCommunityFailure(
      "/activate_community",
      "internal_error",
      ctx,
      error
    );
  }
}

export async function handleSummaryCommand(
  ctx: CommandContext<Context>,
  bot: Bot,
  options?: HandleSummaryCommandOptions
): Promise<void> {
  if (!ctx.chat) return;

  if (!isCommunityChat(ctx.chat.type)) {
    await replyWithAutoCleanup(
      ctx,
      "This command can only be used in group chats."
    );
    return;
  }

  const requestChatId = BigInt(ctx.chat.id);
  const summarySourceChatId = options?.summarySourceChatId ?? requestChatId;

  try {
    const result = await sendLatestSummary(bot, summarySourceChatId, {
      destinationChatId: requestChatId,
      replyToMessageId: ctx.msg?.message_id,
    });

    if (result.sent) {
      trackBotEvent(BOT_SUMMARY_COMMAND_EVENT, {
        ...createCommandTrackingProperties(ctx),
        summary_destination_chat_id: requestChatId.toString(),
        summary_source_chat_id: summarySourceChatId.toString(),
      });
      return;
    }

    suppressCommunityFailure("/summary", result.reason, ctx);
  } catch (error) {
    suppressCommunityFailure("/summary", "internal_error", ctx, error);
  }
}

export async function handleNotificationsCommand(
  ctx: CommandContext<Context>
): Promise<void> {
  if (!ctx.chat) return;

  if (!isCommunityChat(ctx.chat.type)) {
    await replyWithAutoCleanup(
      ctx,
      "This command can only be used in group chats."
    );
    return;
  }

  try {
    const db = getDatabase();
    if (!ctx.from) {
      suppressCommunityFailure("/notifications", "missing_user_context", ctx);
      return;
    }

    const telegramUserId = BigInt(ctx.from.id);
    if (!(await isWhitelistedAdmin(db, telegramUserId))) {
      suppressCommunityFailure("/notifications", "unauthorized", ctx);
      return;
    }

    const chatId = BigInt(ctx.chat.id);
    const community = await db.query.communities.findFirst({
      where: eq(communities.chatId, chatId),
    });

    if (!community || !community.isActive) {
      suppressCommunityFailure("/notifications", "not_activated", ctx);
      return;
    }

    await sendNotificationSettingsMessage(ctx, community);
  } catch (error) {
    suppressCommunityFailure("/notifications", "internal_error", ctx, error);
  }
}

export async function handleSettingsCommand(
  ctx: CommandContext<Context>
): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  if (ctx.chat.type !== "private") return;

  try {
    const db = getDatabase();
    const telegramUserId = BigInt(ctx.from.id);
    const userId = await getOrCreateUser(telegramUserId, {
      username: ctx.from.username || null,
      displayName: getTelegramDisplayName(ctx.from),
    });

    await db.insert(userSettings).values({ userId }).onConflictDoNothing();

    const settings = await db.query.userSettings.findFirst({
      where: eq(userSettings.userId, userId),
    });

    if (!settings) {
      await ctx.reply(SETTINGS_LOAD_ERROR_REPLY_TEXT);
      return;
    }

    await sendUserSettingsMessage(ctx, settings);
  } catch (error) {
    console.error("Failed to send user settings", error);
    await ctx.reply(SETTINGS_LOAD_ERROR_REPLY_TEXT);
  }
}

export async function handleDeactivateCommunityCommand(
  ctx: CommandContext<Context>
): Promise<void> {
  if (!ctx.from || !ctx.chat) return;

  // Delete the command message to keep chat clean
  try {
    await ctx.deleteMessage();
  } catch (error) {
    console.warn(
      "Failed to delete /deactivate_community command message",
      error
    );
  }

  if (!isCommunityChat(ctx.chat.type)) {
    await replyWithAutoCleanup(
      ctx,
      "This command can only be used in group chats."
    );
    return;
  }

  const telegramUserId = BigInt(ctx.from.id);

  try {
    const db = getDatabase();

    if (!(await isWhitelistedAdmin(db, telegramUserId))) {
      suppressCommunityFailure("/deactivate_community", "unauthorized", ctx);
      return;
    }

    const chatId = BigInt(ctx.chat.id);

    // Find the community
    const existingCommunity = await db.query.communities.findFirst({
      where: eq(communities.chatId, chatId),
    });

    if (!existingCommunity) {
      suppressCommunityFailure("/deactivate_community", "not_activated", ctx);
      return;
    }

    if (!existingCommunity.isActive) {
      suppressCommunityFailure(
        "/deactivate_community",
        "already_deactivated",
        ctx
      );
      return;
    }

    // Deactivate the community
    await db
      .update(communities)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(communities.id, existingCommunity.id));

    evictActiveCommunityCache(chatId);
    await replyCommunitySuccess(
      ctx,
      "Community deactivated. Message tracking has been disabled."
    );
  } catch (error) {
    suppressCommunityFailure(
      "/deactivate_community",
      "internal_error",
      ctx,
      error
    );
  }
}

export async function handleHideCommunityCommand(
  ctx: CommandContext<Context>
): Promise<void> {
  if (!ctx.from || !ctx.chat) return;

  try {
    await ctx.deleteMessage();
  } catch (error) {
    console.warn("Failed to delete /hide command message", error);
  }

  if (!isCommunityChat(ctx.chat.type)) {
    await replyWithAutoCleanup(
      ctx,
      "This command can only be used in group chats."
    );
    return;
  }

  const telegramUserId = BigInt(ctx.from.id);

  try {
    const db = getDatabase();
    if (!(await isWhitelistedAdmin(db, telegramUserId))) {
      suppressCommunityFailure("/hide", "unauthorized", ctx);
      return;
    }

    const existingCommunity = await findActiveCommunity(ctx, db);
    if (!existingCommunity) {
      suppressCommunityFailure("/hide", "not_activated", ctx);
      return;
    }

    if (!existingCommunity.isPublic) {
      suppressCommunityFailure("/hide", "already_hidden", ctx);
      return;
    }

    await db
      .update(communities)
      .set({ isPublic: false, updatedAt: new Date() })
      .where(eq(communities.id, existingCommunity.id));

    await replyCommunitySuccess(ctx, "Community hidden from public summaries.");
  } catch (error) {
    suppressCommunityFailure("/hide", "internal_error", ctx, error);
  }
}

export async function handleUnhideCommunityCommand(
  ctx: CommandContext<Context>
): Promise<void> {
  if (!ctx.from || !ctx.chat) return;

  try {
    await ctx.deleteMessage();
  } catch (error) {
    console.warn("Failed to delete /unhide command message", error);
  }

  if (!isCommunityChat(ctx.chat.type)) {
    await replyWithAutoCleanup(
      ctx,
      "This command can only be used in group chats."
    );
    return;
  }

  const telegramUserId = BigInt(ctx.from.id);

  try {
    const db = getDatabase();
    if (!(await isWhitelistedAdmin(db, telegramUserId))) {
      suppressCommunityFailure("/unhide", "unauthorized", ctx);
      return;
    }

    const existingCommunity = await findActiveCommunity(ctx, db);
    if (!existingCommunity) {
      suppressCommunityFailure("/unhide", "not_activated", ctx);
      return;
    }

    if (existingCommunity.isPublic) {
      suppressCommunityFailure("/unhide", "already_visible", ctx);
      return;
    }

    await db
      .update(communities)
      .set({ isPublic: true, updatedAt: new Date() })
      .where(eq(communities.id, existingCommunity.id));

    await replyCommunitySuccess(
      ctx,
      "Community is now visible in public summaries."
    );
  } catch (error) {
    suppressCommunityFailure("/unhide", "internal_error", ctx, error);
  }
}
