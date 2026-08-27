import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Telegram Business Bot Rights - permissions granted to the bot.
 * All fields are optional booleans.
 */
export type BusinessBotRights = {
  can_reply?: boolean;
  can_read_messages?: boolean;
  can_delete_sent_messages?: boolean;
  can_delete_all_messages?: boolean;
  can_edit_name?: boolean;
  can_edit_bio?: boolean;
  can_edit_profile_photo?: boolean;
  can_edit_username?: boolean;
  can_manage_stories?: boolean;
};

/**
 * Sender type for bot conversation messages.
 */
export type SenderType = "user" | "bot" | "system";

/**
 * Thread status for bot conversations.
 */
export type ThreadStatus = "active" | "archived" | "closed";

/**
 * Allowed user actions for summary voting.
 */
export type SummaryVoteAction = "LIKE" | "DISLIKE";

/**
 * Delivery state for at-most-once Telegram command responses.
 */
export type TelegramCommandReceiptStatus =
  | "processing"
  | "completed"
  | "failed";

/**
 * Allowed time-based summary notification frequency options.
 */
export type SummaryNotificationTimeHours = 24 | 48;

/**
 * Allowed message-count summary notification frequency options.
 */
export type SummaryNotificationMessageCount = 500 | 1000;

/**
 * Community ingestion parser type.
 */
export type CommunityParserType = "bot" | "userbot";

/**
 * Encrypted message content stored as JSONB.
 * Supports text now, extensible for images/voice later.
 */
export type EncryptedMessageContent = {
  type: "text" | "image" | "voice";
  ciphertext: string; // base64 encoded
  iv: string; // base64 encoded (12 bytes)
  metadata?: {
    fileName?: string;
    fileSize?: number;
    duration?: number; // for voice messages
    mimeType?: string;
  };
};

/**
 * Private transfer analytics flow type
 */
export type PrivateTransferAnalyticsFlow = "shield" | "unshield";

/**
 * Gasless claim analytics transaction type
 */
export type GaslessClaimTransactionType =
  | "store"
  | "verify_telegram_init_data"
  | "top_up_to_0_01_sol";

/**
 * Solana environment recorded for gasless claim analytics
 */
export type GaslessClaimSolanaEnv = "mainnet" | "devnet";

/**
 * Supported app-level user providers.
 */
export type AppUserProvider = "solana";

/**
 * Solana environments tracked for app user smart accounts.
 */
export type AppUserSmartAccountSolanaEnv =
  | "mainnet"
  | "testnet"
  | "devnet"
  | "localnet";

/**
 * Lifecycle state for app user smart account provisioning.
 */
export type AppUserSmartAccountState = "provisioning" | "ready" | "failed";

/**
 * Lifecycle state for wallet auth completion attempts.
 */
export type AppWalletAuthCompletionState =
  | "processing"
  | "completed"
  | "failed";

/**
 * Outcome of env-scoped smart-account ensure/provisioning.
 */
export type AppWalletAuthProvisioningOutcome =
  | "existing_ready"
  | "delegated_root_signer"
  | "reconciled_ready"
  | "sponsored_existing_record"
  | "sponsored_new_record"
  | "retried_failed_record";

/**
 * Lifecycle state for smart-account settings signer changes requested by the app.
 */
export type AppSmartAccountSettingsChangeRequestStatus =
  | "draft"
  | "submitted"
  | "confirmed"
  | "failed"
  | "canceled"
  | "superseded";

/**
 * App-supported root Settings signer request actions.
 */
export type AppSmartAccountSettingsChangeAction =
  | "add_root_signer"
  | "remove_root_signer";

/**
 * Identity-relevant signer scope for app wallet onboarding.
 */
export type AppSmartAccountSignerScope = "root_settings";

/**
 * Read-model state for app smart-account signer membership.
 */
export type AppSmartAccountSignerState = "active" | "removed";

/**
 * Stored app chat message roles.
 */
export type AppChatMessageRole = "user" | "assistant" | "system";

/**
 * Supported apps for feature registry tracking.
 */
export type FeatureApp =
  | "telegram_miniapp"
  | "website"
  | "mobile"
  | "extension";

/**
 * Lifecycle state for a feature in a specific app.
 */
export type FeatureStatus =
  | "missing"
  | "planned"
  | "in_progress"
  | "implemented"
  | "live";

/**
 * Evidence types attached to feature status entries.
 */
export type FeatureEvidenceType =
  | "path"
  | "branch"
  | "pr"
  | "linear"
  | "commit"
  | "doc";

/**
 * Audience classification for runtime flags.
 */
export type FlagAudience = "all" | "public" | "team";

/**
 * Environments that runtime flags can target.
 */
export type FlagTargetEnvironment = "development" | "preview" | "production";

export type ManualPushAudience = "all" | "platform" | "wallet";

export type PushNotificationSendStatus =
  | "sending"
  | "sent"
  | "receipt_checked"
  | "failed";

// ============================================================================
// TABLES
// ============================================================================

/**
 * Global admins whitelist for privileged community actions.
 * Users in this table can activate/deactivate communities and manage
 * notification settings.
 */
export const admins = pgTable(
  "admins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: bigint("telegram_id", { mode: "bigint" }).notNull(),
    username: text("username"),
    displayName: text("display_name").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    addedBy: text("added_by"),
    notes: text("notes"),
  },
  (table) => [uniqueIndex("admins_telegram_id_idx").on(table.telegramId)]
);

/**
 * Telegram users who post messages in communities.
 * Created automatically when a user sends their first message.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: bigint("telegram_id", { mode: "bigint" }).notNull(),
    username: text("username"),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    settings: jsonb("settings").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("users_telegram_id_idx").on(table.telegramId)]
);

/**
 * Per-user bot settings for private chat behavior.
 * Linked one-to-one with users.
 */
export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    model: text("model").default("phala/gpt-oss-120b").notNull(),
    notifications: boolean("notifications").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("user_settings_user_id_idx").on(table.userId)]
);

/**
 * Telegram group chats activated for message tracking.
 * Privileged management actions are controlled by the admins whitelist.
 */
export const communities = pgTable(
  "communities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: bigint("chat_id", { mode: "bigint" }).notNull(),
    chatTitle: text("chat_title").notNull(),
    activatedBy: bigint("activated_by", { mode: "bigint" }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    parserType: text("parser_type")
      .$type<CommunityParserType>()
      .default("bot")
      .notNull(),
    summaryNotificationsEnabled: boolean("summary_notifications_enabled")
      .default(true)
      .notNull(),
    summaryNotificationTimeHours: integer("summary_notification_time_hours")
      .$type<SummaryNotificationTimeHours | null>()
      .default(24),
    summaryNotificationMessageCount: integer(
      "summary_notification_message_count"
    )
      .$type<SummaryNotificationMessageCount | null>()
      .default(null),
    isPublic: boolean("is_public").default(true).notNull(),
    settings: jsonb("settings").default({}).notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("communities_chat_id_idx").on(table.chatId),
    index("communities_is_active_idx").on(table.isActive),
    index("communities_is_active_parser_type_idx").on(
      table.isActive,
      table.parserType
    ),
    check(
      "communities_summary_notification_time_hours_check",
      sql`${table.summaryNotificationTimeHours} IS NULL OR ${table.summaryNotificationTimeHours} IN (24, 48)`
    ),
    check(
      "communities_parser_type_check",
      sql`${table.parserType} IN ('bot', 'userbot')`
    ),
    check(
      "communities_summary_notification_message_count_check",
      sql`${table.summaryNotificationMessageCount} IS NULL OR ${table.summaryNotificationMessageCount} IN (500, 1000)`
    ),
  ]
);

/**
 * Many-to-many relationship between communities and users.
 * Tracks which users are members of which communities.
 */
export const communityMembers = pgTable(
  "community_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("community_members_unique_idx").on(
      table.communityId,
      table.userId
    ),
    index("community_members_user_id_idx").on(table.userId),
  ]
);

/**
 * Chat messages from tracked communities.
 * High-volume table - optimized with composite indexes for date-range queries.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    telegramMessageId: bigint("telegram_message_id", {
      mode: "bigint",
    }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Primary query pattern: messages by community + date range (for summaries)
    index("messages_community_created_idx").on(
      table.communityId,
      table.createdAt
    ),
    // Prevent duplicate telegram messages per community
    uniqueIndex("messages_community_telegram_id_idx").on(
      table.communityId,
      table.telegramMessageId
    ),
    // Secondary: lookup messages by user
    index("messages_user_id_idx").on(table.userId),
  ]
);

/**
 * Daily AI-generated chat summaries organized by topics.
 * Topics stored as JSONB array: [{title, content, sources[]}]
 */
export const summaries = pgTable(
  "summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    chatTitle: text("chat_title").notNull(),
    messageCount: integer("message_count").notNull(),
    fromMessageId: bigint("from_message_id", { mode: "bigint" }),
    toMessageId: bigint("to_message_id", { mode: "bigint" }),
    topics: jsonb("topics")
      .$type<{ title: string; content: string; sources: string[] }[]>()
      .notNull(),
    oneliner: text("oneliner").notNull(),
    triggerType: text("trigger_type"),
    triggerKey: text("trigger_key"),
    notificationSentAt: timestamp("notification_sent_at", {
      withTimezone: true,
    }),
    notificationClaimedAt: timestamp("notification_claimed_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Find latest summary per community (ORDER BY created_at DESC LIMIT 1)
    index("summaries_community_created_idx").on(
      table.communityId,
      table.createdAt
    ),
    uniqueIndex("summaries_community_trigger_key_uidx")
      .on(table.communityId, table.triggerKey)
      .where(sql`${table.triggerKey} IS NOT NULL`),
    index("summaries_trigger_key_idx").on(table.triggerKey),
    index("summaries_notification_sent_idx").on(
      table.triggerKey,
      table.notificationSentAt
    ),
  ]
);

/**
 * User votes for summaries.
 * A user can vote only once per summary.
 */
export const summaryVotes = pgTable(
  "summary_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    summaryId: uuid("summary_id")
      .notNull()
      .references(() => summaries.id, { onDelete: "cascade" }),
    action: text("action").$type<SummaryVoteAction>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("summary_votes_summary_user_uidx").on(
      table.summaryId,
      table.userId
    ),
    index("summary_votes_summary_action_idx").on(table.summaryId, table.action),
    check(
      "summary_votes_action_check",
      sql`${table.action} IN ('LIKE', 'DISLIKE')`
    ),
  ]
);

/**
 * Queue of helper bot messages scheduled for delayed deletion.
 * Entries are consumed by a minutely cron worker.
 */
export const telegramHelperMessageCleanup = pgTable(
  "telegram_helper_message_cleanup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: bigint("chat_id", { mode: "bigint" }).notNull(),
    messageId: integer("message_id").notNull(),
    deleteAfter: timestamp("delete_after", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("telegram_helper_message_cleanup_delete_after_idx").on(
      table.deleteAfter
    ),
    uniqueIndex("telegram_helper_message_cleanup_chat_message_uidx").on(
      table.chatId,
      table.messageId
    ),
  ]
);

/**
 * Durable claims for Telegram commands with public side effects. Telegram
 * webhooks are delivered at least once, so a unique update ID prevents a retry
 * from sending the same command response more than once.
 */
export const telegramCommandReceipts = pgTable(
  "telegram_command_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramUpdateId: bigint("telegram_update_id", {
      mode: "bigint",
    }).notNull(),
    command: text("command").notNull(),
    chatId: bigint("chat_id", { mode: "bigint" }).notNull(),
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }),
    status: text("status")
      .$type<TelegramCommandReceiptStatus>()
      .default("processing")
      .notNull(),
    telegramMessageId: integer("telegram_message_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("telegram_command_receipts_update_uidx").on(
      table.telegramUpdateId
    ),
    index("telegram_command_receipts_status_created_idx").on(
      table.status,
      table.createdAt
    ),
    check(
      "telegram_command_receipts_status_check",
      sql`${table.status} IN ('processing', 'completed', 'failed')`
    ),
  ]
);

/**
 * Singleton read model for /stats. A cron refreshes this row from the canonical
 * app and Yield databases so Telegram webhook handling never runs aggregates.
 */
export type LoyalStatsAumSeriesPoint = {
  aumRaw: string;
  weekEnd: string;
  weekStart: string;
};

export const loyalStatsSnapshots = pgTable(
  "loyal_stats_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotKey: text("snapshot_key").default("current").notNull(),
    totalAumRaw: bigint("total_aum_raw", { mode: "bigint" }).notNull(),
    totalUsers: integer("total_users").notNull(),
    totalOptimizedVolumeRaw: bigint("total_optimized_volume_raw", {
      mode: "bigint",
    }).notNull(),
    activePrincipalRaw: bigint("active_principal_raw", {
      mode: "bigint",
    })
      .default(sql`0`)
      .notNull(),
    uniqueEarnUsers: integer("unique_earn_users").default(0).notNull(),
    uniqueEarnPolicies: integer("unique_earn_policies").default(0).notNull(),
    activeAutodepositPolicies: integer("active_autodeposit_policies")
      .default(0)
      .notNull(),
    earnAumSeries: jsonb("earn_aum_series")
      .$type<LoyalStatsAumSeriesPoint[]>()
      .default([])
      .notNull(),
    lastEarnFlowEventId: bigint("last_earn_flow_event_id", {
      mode: "bigint",
    }),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("loyal_stats_snapshots_key_uidx").on(table.snapshotKey),
    check(
      "loyal_stats_snapshots_current_key_check",
      sql`${table.snapshotKey} = 'current'`
    ),
    check(
      "loyal_stats_snapshots_nonnegative_check",
      sql`${table.totalAumRaw} >= 0 AND ${table.totalUsers} >= 0 AND ${table.totalOptimizedVolumeRaw} >= 0 AND ${table.activePrincipalRaw} >= 0 AND ${table.uniqueEarnUsers} >= 0 AND ${table.uniqueEarnPolicies} >= 0 AND ${table.activeAutodepositPolicies} >= 0`
    ),
  ]
);

/**
 * Telegram Business connections - tracks bot connections to user business accounts.
 * One connection per user; soft-deleted by setting isEnabled to false.
 */
export const businessConnections = pgTable(
  "business_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    businessConnectionId: text("business_connection_id").notNull(),
    userChatId: bigint("user_chat_id", { mode: "bigint" }).notNull(),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    rights: jsonb("rights").$type<BusinessBotRights>().default({}).notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // One business connection per user
    uniqueIndex("business_connections_user_id_idx").on(table.userId),
    // Filter by active/inactive connections
    index("business_connections_is_enabled_idx").on(table.isEnabled),
  ]
);

/**
 * Bot conversation threads - represents a conversation session between user and bot.
 * Supports Telegram's threaded messages via message_thread_id.
 */
export const botThreads = pgTable(
  "bot_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    telegramThreadId: integer("telegram_thread_id"), // Telegram's message_thread_id
    title: text("title"),
    status: text("status").$type<ThreadStatus>().default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Primary query: find user's threads
    index("bot_threads_user_id_idx").on(table.userId),
    // Unique thread per telegram chat + thread combination
    uniqueIndex("bot_threads_telegram_unique_idx").on(
      table.telegramChatId,
      table.telegramThreadId
    ),
    // Filter by status
    index("bot_threads_status_idx").on(table.status),
  ]
);

/**
 * Individual messages within bot threads.
 * Content is encrypted as JSONB with type discriminators for extensibility.
 */
export const botMessages = pgTable(
  "bot_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => botThreads.id, { onDelete: "cascade" }),
    senderType: text("sender_type").$type<SenderType>().notNull(),
    encryptedContent: jsonb("encrypted_content")
      .$type<EncryptedMessageContent>()
      .notNull(),
    telegramMessageId: bigint("telegram_message_id", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Primary query: get thread messages in chronological order
    index("bot_messages_thread_created_idx").on(
      table.threadId,
      table.createdAt
    ),
    // Lookup by telegram message ID (for deduplication)
    index("bot_messages_telegram_id_idx").on(table.telegramMessageId),
  ]
);

/**
 * Push notification tokens for mobile app users. Stores Expo push tokens
 * alongside whichever identities the app can claim — Telegram mini-app
 * installs set telegramUserId, Seeker wallet installs set walletPublicKey.
 * At least one identity must be present (enforced at the API layer).
 */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    token: text("token").notNull(),
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }),
    walletPublicKey: text("wallet_public_key"),
    platform: text("platform").notNull(), // "ios" | "android"
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("push_tokens_token_unique").on(table.token),
    index("push_tokens_telegram_user_id_idx").on(table.telegramUserId),
    index("push_tokens_wallet_public_key_idx").on(table.walletPublicKey),
  ]
);

// Per-wallet bookkeeping for the automated Earn "joy" pushes (ASK-2091).
// One row per wallet holds both halves of the decision: the lifetime earnings
// the user was last told about (so a digest reports the delta, not the total)
// and the one-time pushes already sent. The joy cron is the only writer, so a
// JSON set is enough and keeps this to a single upsert per wallet.
export const earnYieldPushState = pgTable(
  "earn_yield_push_state",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    walletPublicKey: text("wallet_public_key").notNull(),
    lastPushedEarnedUsd: numeric("last_pushed_earned_usd", {
      precision: 20,
      scale: 6,
    })
      .notNull()
      .default("0"),
    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
    sentCampaigns: jsonb("sent_campaigns").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("earn_yield_push_state_wallet_uidx").on(table.walletPublicKey),
  ]
);

export const pushNotificationSends = pgTable(
  "push_notification_sends",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    audience: text("audience").$type<ManualPushAudience>().notNull(),
    platform: text("platform"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data").$type<Record<string, unknown> | null>(),
    createdBy: text("created_by"),
    status: text("status").$type<PushNotificationSendStatus>().notNull(),
    requestedCount: integer("requested_count").default(0).notNull(),
    ticketCount: integer("ticket_count").default(0).notNull(),
    receiptOkCount: integer("receipt_ok_count").default(0).notNull(),
    receiptErrorCount: integer("receipt_error_count").default(0).notNull(),
    deviceNotRegisteredCount: integer("device_not_registered_count")
      .default(0)
      .notNull(),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receiptsCheckedAt: timestamp("receipts_checked_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("push_notification_sends_created_at_idx").on(table.createdAt),
    index("push_notification_sends_status_idx").on(table.status),
    check(
      "push_notification_sends_audience_check",
      sql`${table.audience} IN ('all', 'platform', 'wallet')`
    ),
    check(
      "push_notification_sends_status_check",
      sql`${table.status} IN ('sending', 'sent', 'receipt_checked', 'failed')`
    ),
  ]
);

export const pushNotificationTickets = pgTable(
  "push_notification_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sendId: uuid("send_id")
      .notNull()
      .references(() => pushNotificationSends.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    ticketId: text("ticket_id"),
    ticketStatus: text("ticket_status").notNull(),
    ticketMessage: text("ticket_message"),
    ticketError: text("ticket_error"),
    receiptStatus: text("receipt_status"),
    receiptMessage: text("receipt_message"),
    receiptError: text("receipt_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("push_notification_tickets_send_id_idx").on(table.sendId),
    index("push_notification_tickets_ticket_id_idx").on(table.ticketId),
    index("push_notification_tickets_token_idx").on(table.token),
  ]
);

/**
 * @deprecated 2026-05-22 — superseded by Helius enhanced webhooks
 * (see `heliusWebhooks` / `heliusWebhookAddresses` / `heliusWebhookDeliveries`).
 * The old per-wallet polling cron that populated this cursor has been
 * removed; the table is kept for one release window to preserve a
 * rollback path, then dropped in a follow-up migration.
 */
export const walletPushSyncState = pgTable("wallet_push_sync_state", {
  walletPublicKey: text("wallet_public_key").primaryKey(),
  lastSignature: text("last_signature"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const heliusWebhooks = pgTable(
  "helius_webhooks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    heliusWebhookId: text("helius_webhook_id").notNull(),
    webhookUrl: text("webhook_url").notNull(),
    // Increment when we need to invalidate all existing addresses
    // (e.g. authHeader rotation, environment migration).
    generation: integer("generation").default(0).notNull(),
    addressCount: integer("address_count").default(0).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("helius_webhooks_helius_id_unique").on(table.heliusWebhookId),
  ]
);

export const heliusWebhookAddresses = pgTable(
  "helius_webhook_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => heliusWebhooks.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    walletPublicKey: text("wallet_public_key").notNull(),
    kind: text("kind").$type<"wallet" | "ata">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("helius_webhook_addresses_address_unique").on(table.address),
    index("helius_webhook_addresses_wallet_idx").on(table.walletPublicKey),
    index("helius_webhook_addresses_webhook_idx").on(table.webhookId),
  ]
);

export const heliusWebhookDeliveries = pgTable(
  "helius_webhook_deliveries",
  {
    signature: text("signature").notNull(),
    walletPublicKey: text("wallet_public_key").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.signature, table.walletPublicKey] })]
);

/**
 * Wallet-first users for the Loyal web frontend.
 */
export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").$type<AppUserProvider>().notNull(),
    subjectAddress: text("subject_address").notNull(),
    gridUserId: text("grid_user_id"),
    smartAccountAddress: text("smart_account_address"),
    smartAccountSettingsPda: text("smart_account_settings_pda"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("app_users_provider_subject_uidx").on(
      table.provider,
      table.subjectAddress
    ),
    check("app_users_provider_check", sql`${table.provider} IN ('solana')`),
  ]
);

/**
 * Verified wallet addresses attached to app users.
 */
export const appUserWallets = pgTable(
  "app_user_wallets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    walletAddress: text("wallet_address").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("app_user_wallets_wallet_address_uidx").on(table.walletAddress),
  ]
);

/**
 * Env-scoped Loyal smart accounts attached to app users.
 * The settings PDA is the source of truth for deriving smart account PDAs.
 */
export const appUserSmartAccounts = pgTable(
  "app_user_smart_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    solanaEnv: text("solana_env")
      .$type<AppUserSmartAccountSolanaEnv>()
      .notNull(),
    settingsPda: text("settings_pda").notNull(),
    state: text("state").$type<AppUserSmartAccountState>().notNull(),
    creationSignature: text("creation_signature"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("app_user_smart_accounts_user_env_uidx").on(
      table.userId,
      table.solanaEnv
    ),
    uniqueIndex("app_user_smart_accounts_env_settings_uidx").on(
      table.solanaEnv,
      table.settingsPda
    ),
    index("app_user_smart_accounts_user_id_idx").on(table.userId),
    check(
      "app_user_smart_accounts_solana_env_check",
      sql`${table.solanaEnv} IN ('mainnet', 'testnet', 'devnet', 'localnet')`
    ),
    check(
      "app_user_smart_accounts_state_check",
      sql`${table.state} IN ('provisioning', 'ready', 'failed')`
    ),
  ]
);

/**
 * Individual sponsored smart-account creation transactions observed from the
 * Loyal web frontend. One row per transaction signature and environment.
 */
export const appSmartAccountSponsorshipTransactions = pgTable(
  "app_smart_account_sponsorship_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    solanaEnv: text("solana_env")
      .$type<AppUserSmartAccountSolanaEnv>()
      .notNull(),
    signature: text("signature").notNull(),
    payerAddress: text("payer_address").notNull(),
    userAddress: text("user_address").notNull(),
    settingsPda: text("settings_pda").notNull(),
    smartAccountAddress: text("smart_account_address").notNull(),
    slot: bigint("slot", { mode: "bigint" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    spentLamports: numeric("spent_lamports", {
      precision: 30,
      scale: 0,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("app_smart_account_sponsorship_tx_env_signature_uidx").on(
      table.solanaEnv,
      table.signature
    ),
    index("app_smart_account_sponsorship_tx_occurred_at_idx").on(
      table.occurredAt
    ),
    index("app_smart_account_sponsorship_tx_user_address_idx").on(
      table.userAddress
    ),
    index("app_smart_account_sponsorship_tx_smart_account_idx").on(
      table.smartAccountAddress
    ),
    check(
      "app_smart_account_sponsorship_tx_solana_env_check",
      sql`${table.solanaEnv} IN ('mainnet', 'testnet', 'devnet', 'localnet')`
    ),
  ]
);

/**
 * Durable lifecycle rows for root Settings signer changes requested by the app.
 * Chain Settings accounts remain the source of truth; these rows record request
 * state, idempotency, and confirmed transaction metadata.
 */
export const appSmartAccountSettingsChangeRequests = pgTable(
  "app_smart_account_settings_change_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    solanaEnv: text("solana_env")
      .$type<AppUserSmartAccountSolanaEnv>()
      .notNull(),
    smartAccountAddress: text("smart_account_address").notNull(),
    settingsPda: text("settings_pda").notNull(),
    signerAddress: text("signer_address").notNull(),
    scope: text("scope").$type<AppSmartAccountSignerScope>().notNull(),
    action: text("action")
      .$type<AppSmartAccountSettingsChangeAction>()
      .notNull(),
    status: text("status")
      .$type<AppSmartAccountSettingsChangeRequestStatus>()
      .notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestedByUserId: uuid("requested_by_user_id").references(
      () => appUsers.id,
      {
        onDelete: "set null",
      }
    ),
    transactionIndex: numeric("transaction_index", {
      precision: 30,
      scale: 0,
    }),
    signature: text("signature"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedSlot: bigint("confirmed_slot", { mode: "bigint" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("app_smart_account_settings_change_req_idem_uidx").on(
      table.solanaEnv,
      table.idempotencyKey
    ),
    index("app_smart_account_settings_change_req_settings_idx").on(
      table.solanaEnv,
      table.settingsPda
    ),
    index("app_smart_account_settings_change_req_signer_idx").on(
      table.solanaEnv,
      table.signerAddress
    ),
    index("app_smart_account_settings_change_req_status_idx").on(table.status),
    index("app_smart_account_settings_change_req_user_idx").on(
      table.requestedByUserId
    ),
    check(
      "app_smart_account_settings_change_req_solana_env_check",
      sql`${table.solanaEnv} IN ('mainnet', 'testnet', 'devnet', 'localnet')`
    ),
    check(
      "app_smart_account_settings_change_req_scope_check",
      sql`${table.scope} IN ('root_settings')`
    ),
    check(
      "app_smart_account_settings_change_req_action_check",
      sql`${table.action} IN ('add_root_signer', 'remove_root_signer')`
    ),
    check(
      "app_smart_account_settings_change_req_status_check",
      sql`${table.status} IN ('draft', 'submitted', 'confirmed', 'failed', 'canceled', 'superseded')`
    ),
  ]
);

/**
 * Active/removed root Settings signer read model used by wallet onboarding.
 * A signer row can be linked to an app user only after wallet auth proves
 * ownership of signerAddress.
 */
export const appSmartAccountSigners = pgTable(
  "app_smart_account_signers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    solanaEnv: text("solana_env")
      .$type<AppUserSmartAccountSolanaEnv>()
      .notNull(),
    smartAccountAddress: text("smart_account_address").notNull(),
    settingsPda: text("settings_pda").notNull(),
    signerAddress: text("signer_address").notNull(),
    scope: text("scope").$type<AppSmartAccountSignerScope>().notNull(),
    state: text("state").$type<AppSmartAccountSignerState>().notNull(),
    permissionMask: integer("permission_mask"),
    sourceSignature: text("source_signature"),
    sourceSlot: bigint("source_slot", { mode: "bigint" }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    userId: uuid("user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("app_smart_account_signers_env_settings_scope_signer_uidx").on(
      table.solanaEnv,
      table.settingsPda,
      table.scope,
      table.signerAddress
    ),
    index("app_smart_account_signers_env_signer_state_idx").on(
      table.solanaEnv,
      table.signerAddress,
      table.state
    ),
    index("app_smart_account_signers_settings_idx").on(
      table.solanaEnv,
      table.settingsPda
    ),
    index("app_smart_account_signers_user_idx").on(table.userId),
    check(
      "app_smart_account_signers_solana_env_check",
      sql`${table.solanaEnv} IN ('mainnet', 'testnet', 'devnet', 'localnet')`
    ),
    check(
      "app_smart_account_signers_scope_check",
      sql`${table.scope} IN ('root_settings')`
    ),
    check(
      "app_smart_account_signers_state_check",
      sql`${table.state} IN ('active', 'removed')`
    ),
  ]
);

/**
 * Idempotency and replay records for wallet auth completion.
 * One row per signed challenge token hash.
 */
export const appWalletAuthCompletions = pgTable(
  "app_wallet_auth_completions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    challengeHash: text("challenge_hash").notNull(),
    walletAddress: text("wallet_address").notNull(),
    solanaEnv: text("solana_env")
      .$type<AppUserSmartAccountSolanaEnv>()
      .notNull(),
    state: text("state").$type<AppWalletAuthCompletionState>().notNull(),
    processingToken: text("processing_token"),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
    }),
    userId: uuid("user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    smartAccountAddress: text("smart_account_address"),
    settingsPda: text("settings_pda"),
    provisioningOutcome: text(
      "provisioning_outcome"
    ).$type<AppWalletAuthProvisioningOutcome | null>(),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("app_wallet_auth_completions_challenge_hash_uidx").on(
      table.challengeHash
    ),
    index("app_wallet_auth_completions_wallet_address_idx").on(
      table.walletAddress
    ),
    index("app_wallet_auth_completions_state_idx").on(table.state),
    index("app_wallet_auth_completions_user_id_idx").on(table.userId),
    check(
      "app_wallet_auth_completions_solana_env_check",
      sql`${table.solanaEnv} IN ('mainnet', 'testnet', 'devnet', 'localnet')`
    ),
    check(
      "app_wallet_auth_completions_state_check",
      sql`${table.state} IN ('processing', 'completed', 'failed')`
    ),
    check(
      "app_wallet_auth_completions_provisioning_outcome_check",
      sql`${table.provisioningOutcome} IS NULL OR ${table.provisioningOutcome} IN ('existing_ready', 'delegated_root_signer', 'reconciled_ready', 'sponsored_existing_record', 'sponsored_new_record', 'retried_failed_record')`
    ),
  ]
);

/**
 * Single-use keys for the Cap captcha (challenge nonces + redeem tokens).
 * Rows are consumed by delete-on-read; expiry is enforced at read time.
 */
export const appCaptchaKeys = pgTable("app_captcha_keys", {
  key: text("key").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Persisted chat sessions per app user.
 */
export const appChats = pgTable(
  "app_chats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    clientChatId: text("client_chat_id"),
    title: text("title"),
    model: text("model").notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("app_chats_user_client_chat_uidx")
      .on(table.userId, table.clientChatId)
      .where(sql`${table.clientChatId} IS NOT NULL`),
    index("app_chats_user_last_message_idx").on(
      table.userId,
      table.lastMessageAt
    ),
  ]
);

/**
 * Persisted user and assistant messages for app chats.
 */
export const appChatMessages = pgTable(
  "app_chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => appChats.id, { onDelete: "cascade" }),
    role: text("role").$type<AppChatMessageRole>().notNull(),
    content: text("content").notNull(),
    clientMessageId: text("client_message_id"),
    turnId: text("turn_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("app_chat_messages_chat_client_message_uidx")
      .on(table.chatId, table.clientMessageId)
      .where(sql`${table.clientMessageId} IS NOT NULL`),
    uniqueIndex("app_chat_messages_chat_role_turn_uidx")
      .on(table.chatId, table.role, table.turnId)
      .where(sql`${table.turnId} IS NOT NULL`),
    index("app_chat_messages_chat_created_idx").on(
      table.chatId,
      table.createdAt
    ),
    check(
      "app_chat_messages_role_check",
      sql`${table.role} IN ('user', 'assistant', 'system')`
    ),
  ]
);

/**
 * Sync state for telegram-private-transfer analytics ingestion.
 * Tracks head sync and long-running historical backfill progress.
 */
export const privateTransferAnalyticsSyncState = pgTable(
  "private_transfer_analytics_sync_state",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    syncKey: text("sync_key").notNull(),
    backfillCursor: text("backfill_cursor"),
    latestSeenSignature: text("latest_seen_signature"),
    backfillCompletedAt: timestamp("backfill_completed_at", {
      withTimezone: true,
    }),
    lastRunStartedAt: timestamp("last_run_started_at", { withTimezone: true }),
    lastRunFinishedAt: timestamp("last_run_finished_at", {
      withTimezone: true,
    }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("private_transfer_analytics_sync_state_sync_key_uidx").on(
      table.syncKey
    ),
  ]
);

/**
 * Latest token metadata and pricing for mints observed in private-transfer analytics.
 */
export const privateTransferTokenCatalog = pgTable(
  "private_transfer_token_catalog",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenMint: text("token_mint").notNull(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    decimals: integer("decimals").notNull(),
    lastPriceUsd: numeric("last_price_usd", { precision: 30, scale: 12 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("private_transfer_token_catalog_token_mint_uidx").on(
      table.tokenMint
    ),
  ]
);

/**
 * Raw successful modify_balance instructions observed for telegram-private-transfer.
 */
export const privateTransferModifyBalanceEvents = pgTable(
  "private_transfer_modify_balance_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    signature: text("signature").notNull(),
    instructionIndex: integer("instruction_index").notNull(),
    slot: bigint("slot", { mode: "bigint" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    userAddress: text("user_address").notNull(),
    vaultAddress: text("vault_address").notNull(),
    tokenMint: text("token_mint").notNull(),
    flow: text("flow").$type<PrivateTransferAnalyticsFlow>().notNull(),
    amountRaw: numeric("amount_raw", { precision: 30, scale: 0 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex(
      "private_transfer_modify_balance_events_signature_instruction_uidx"
    ).on(table.signature, table.instructionIndex),
    index("private_transfer_modify_balance_events_occurred_at_idx").on(
      table.occurredAt
    ),
    index("private_transfer_modify_balance_events_token_mint_idx").on(
      table.tokenMint
    ),
    index("private_transfer_modify_balance_events_flow_occurred_at_idx").on(
      table.flow,
      table.occurredAt
    ),
    index("private_transfer_modify_balance_events_vault_address_idx").on(
      table.vaultAddress
    ),
    check(
      "private_transfer_modify_balance_events_flow_check",
      sql`${table.flow} IN ('shield', 'unshield')`
    ),
  ]
);

/**
 * Current vault token balances observed on base layer for telegram-private-transfer.
 * This table is fully replaced on each successful snapshot refresh.
 */
export const privateTransferVaultHoldings = pgTable(
  "private_transfer_vault_holdings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    vaultAddress: text("vault_address").notNull(),
    tokenAccountAddress: text("token_account_address").notNull(),
    tokenMint: text("token_mint").notNull(),
    amountRaw: numeric("amount_raw", { precision: 30, scale: 0 }).notNull(),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("private_transfer_vault_holdings_vault_address_uidx").on(
      table.vaultAddress
    ),
    uniqueIndex(
      "private_transfer_vault_holdings_token_account_address_uidx"
    ).on(table.tokenAccountAddress),
    index("private_transfer_vault_holdings_token_mint_idx").on(table.tokenMint),
  ]
);

/**
 * Individual gasless-payer transactions observed for claim flows.
 * One row per transaction signature and environment.
 */
export const gaslessClaimTransactions = pgTable(
  "gasless_claim_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    solanaEnv: text("solana_env").$type<GaslessClaimSolanaEnv>().notNull(),
    signature: text("signature").notNull(),
    transactionType: text("transaction_type")
      .$type<GaslessClaimTransactionType>()
      .notNull(),
    payerAddress: text("payer_address").notNull(),
    recipientAddress: text("recipient_address"),
    slot: bigint("slot", { mode: "bigint" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    spentLamports: numeric("spent_lamports", {
      precision: 30,
      scale: 0,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("gasless_claim_transactions_env_signature_uidx").on(
      table.solanaEnv,
      table.signature
    ),
    index("gasless_claim_transactions_occurred_at_idx").on(table.occurredAt),
    index("gasless_claim_transactions_type_occurred_at_idx").on(
      table.transactionType,
      table.occurredAt
    ),
    index("gasless_claim_transactions_recipient_address_idx").on(
      table.recipientAddress
    ),
    check(
      "gasless_claim_transactions_type_check",
      sql`${table.transactionType} IN ('store', 'verify_telegram_init_data', 'top_up_to_0_01_sol')`
    ),
    check(
      "gasless_claim_transactions_solana_env_check",
      sql`${table.solanaEnv} IN ('mainnet', 'devnet')`
    ),
  ]
);

/**
 * Canonical feature registry shared across apps.
 */
export const featureRegistry = pgTable(
  "feature_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    owner: text("owner"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("feature_registry_key_idx").on(table.key)]
);

/**
 * Per-app feature status rows.
 */
export const featureAppStatuses = pgTable(
  "feature_app_statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => featureRegistry.id, { onDelete: "cascade" }),
    app: text("app").$type<FeatureApp>().notNull(),
    status: text("status").$type<FeatureStatus>().notNull(),
    statusNote: text("status_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("feature_app_statuses_feature_app_idx").on(
      table.featureId,
      table.app
    ),
    check(
      "feature_app_statuses_app_check",
      sql`${table.app} IN ('telegram_miniapp', 'website', 'mobile', 'extension')`
    ),
    check(
      "feature_app_statuses_status_check",
      sql`${table.status} IN ('missing', 'planned', 'in_progress', 'implemented', 'live')`
    ),
  ]
);

/**
 * Evidence attached to a feature status row.
 */
export const featureEvidence = pgTable(
  "feature_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    featureAppStatusId: uuid("feature_app_status_id")
      .notNull()
      .references(() => featureAppStatuses.id, { onDelete: "cascade" }),
    type: text("type").$type<FeatureEvidenceType>().notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "feature_evidence_type_check",
      sql`${table.type} IN ('path', 'branch', 'pr', 'linear', 'commit', 'doc')`
    ),
    index("feature_evidence_feature_app_status_id_idx").on(
      table.featureAppStatusId
    ),
  ]
);

/**
 * Runtime flags exposed to the frontend.
 */
export const runtimeFlags = pgTable(
  "runtime_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    description: text("description").notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    audience: text("audience").$type<FlagAudience>().notNull(),
    targetEnvironments: jsonb("target_environments")
      .$type<FlagTargetEnvironment[]>()
      .default(["development", "preview", "production"])
      .notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("runtime_flags_key_idx").on(table.key),
    check(
      "runtime_flags_audience_check",
      sql`${table.audience} IN ('all', 'public', 'team')`
    ),
    check(
      "runtime_flags_target_environments_check",
      sql`jsonb_typeof(${table.targetEnvironments}) = 'array' AND ${table.targetEnvironments} <@ '["development","preview","production"]'::jsonb`
    ),
  ]
);

/**
 * Links runtime flags to features.
 */
export const featureFlagLinks = pgTable(
  "feature_flag_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => featureRegistry.id, { onDelete: "cascade" }),
    flagId: uuid("flag_id")
      .notNull()
      .references(() => runtimeFlags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("feature_flag_links_unique_idx").on(
      table.featureId,
      table.flagId
    ),
  ]
);

/**
 * Curated dApps shown on the mobile in-app browser home tile grid.
 * Managed via the admin dashboard. Mobile fetches the active list and
 * falls back to a bundled default if the request fails.
 */
export const trustedDapps = pgTable(
  "trusted_dapps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    origin: text("origin").notNull(),
    name: text("name").notNull(),
    startUrl: text("start_url").notNull(),
    // Free-form category label shown as a section header in the mobile
    // browser. Kept as text (not an enum) so admins can add new categories
    // without a migration; the canonical list lives in
    // `@loyal-labs/shared/dapp-categories`.
    category: text("category"),
    displayOrder: integer("display_order").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("trusted_dapps_origin_uidx").on(table.origin),
    index("trusted_dapps_active_order_idx").on(
      table.isActive,
      table.displayOrder
    ),
    index("trusted_dapps_active_category_order_idx").on(
      table.isActive,
      table.category,
      table.displayOrder
    ),
  ]
);

/**
 * Library sections shown on the mobile Library tab.
 * Managed via the admin dashboard. Each section groups a horizontal row
 * of image-only article cards on the Library screen.
 */
export const librarySections = pgTable(
  "library_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("library_sections_active_order_idx").on(
      table.isActive,
      table.displayOrder
    ),
  ]
);

/**
 * Library articles shown on the mobile Library tab.
 * Cards render only the cover image (no title overlay). The detail screen
 * renders the cover plus `contentMarkdown`. Articles with `isFeatured=true`
 * also appear in the Featured carousel above the section list.
 */
export const libraryArticles = pgTable(
  "library_articles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => librarySections.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    coverImageUrl: text("cover_image_url").notNull(),
    contentMarkdown: text("content_markdown").notNull(),
    readTime: text("read_time").notNull(),
    excerpt: text("excerpt"),
    isFeatured: boolean("is_featured").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("library_articles_section_order_idx").on(
      table.sectionId,
      table.isActive,
      table.displayOrder
    ),
    index("library_articles_featured_idx").on(
      table.isFeatured,
      table.isActive,
      table.displayOrder
    ),
  ]
);

// ============================================================================
// RELATIONS (for type-safe queries with Drizzle)
// ============================================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  messages: many(messages),
  communityMemberships: many(communityMembers),
  businessConnection: one(businessConnections),
  botThreads: many(botThreads),
  summaryVotes: many(summaryVotes),
  userSettings: one(userSettings),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}));

export const communitiesRelations = relations(communities, ({ many }) => ({
  members: many(communityMembers),
  messages: many(messages),
  summaries: many(summaries),
}));

export const communityMembersRelations = relations(
  communityMembers,
  ({ one }) => ({
    community: one(communities, {
      fields: [communityMembers.communityId],
      references: [communities.id],
    }),
    user: one(users, {
      fields: [communityMembers.userId],
      references: [users.id],
    }),
  })
);

export const messagesRelations = relations(messages, ({ one }) => ({
  community: one(communities, {
    fields: [messages.communityId],
    references: [communities.id],
  }),
  user: one(users, {
    fields: [messages.userId],
    references: [users.id],
  }),
}));

export const summariesRelations = relations(summaries, ({ one, many }) => ({
  community: one(communities, {
    fields: [summaries.communityId],
    references: [communities.id],
  }),
  summaryVotes: many(summaryVotes),
}));

export const summaryVotesRelations = relations(summaryVotes, ({ one }) => ({
  summary: one(summaries, {
    fields: [summaryVotes.summaryId],
    references: [summaries.id],
  }),
  user: one(users, {
    fields: [summaryVotes.userId],
    references: [users.id],
  }),
}));

export const businessConnectionsRelations = relations(
  businessConnections,
  ({ one }) => ({
    user: one(users, {
      fields: [businessConnections.userId],
      references: [users.id],
    }),
  })
);

export const botThreadsRelations = relations(botThreads, ({ one, many }) => ({
  user: one(users, {
    fields: [botThreads.userId],
    references: [users.id],
  }),
  messages: many(botMessages),
}));

export const botMessagesRelations = relations(botMessages, ({ one }) => ({
  thread: one(botThreads, {
    fields: [botMessages.threadId],
    references: [botThreads.id],
  }),
}));

export const appUsersRelations = relations(appUsers, ({ many }) => ({
  wallets: many(appUserWallets),
  smartAccounts: many(appUserSmartAccounts),
  smartAccountSettingsChangeRequests: many(
    appSmartAccountSettingsChangeRequests
  ),
  smartAccountSigners: many(appSmartAccountSigners),
  walletAuthCompletions: many(appWalletAuthCompletions),
  chats: many(appChats),
}));

export const appUserWalletsRelations = relations(appUserWallets, ({ one }) => ({
  user: one(appUsers, {
    fields: [appUserWallets.userId],
    references: [appUsers.id],
  }),
}));

export const appUserSmartAccountsRelations = relations(
  appUserSmartAccounts,
  ({ one }) => ({
    user: one(appUsers, {
      fields: [appUserSmartAccounts.userId],
      references: [appUsers.id],
    }),
  })
);

export const appSmartAccountSettingsChangeRequestsRelations = relations(
  appSmartAccountSettingsChangeRequests,
  ({ one }) => ({
    requestedByUser: one(appUsers, {
      fields: [appSmartAccountSettingsChangeRequests.requestedByUserId],
      references: [appUsers.id],
    }),
  })
);

export const appSmartAccountSignersRelations = relations(
  appSmartAccountSigners,
  ({ one }) => ({
    user: one(appUsers, {
      fields: [appSmartAccountSigners.userId],
      references: [appUsers.id],
    }),
  })
);

export const appWalletAuthCompletionsRelations = relations(
  appWalletAuthCompletions,
  ({ one }) => ({
    user: one(appUsers, {
      fields: [appWalletAuthCompletions.userId],
      references: [appUsers.id],
    }),
  })
);

export const appChatsRelations = relations(appChats, ({ one, many }) => ({
  user: one(appUsers, {
    fields: [appChats.userId],
    references: [appUsers.id],
  }),
  messages: many(appChatMessages),
}));

export const appChatMessagesRelations = relations(
  appChatMessages,
  ({ one }) => ({
    chat: one(appChats, {
      fields: [appChatMessages.chatId],
      references: [appChats.id],
    }),
  })
);

export const librarySectionsRelations = relations(
  librarySections,
  ({ many }) => ({
    articles: many(libraryArticles),
  })
);

export const libraryArticlesRelations = relations(
  libraryArticles,
  ({ one }) => ({
    section: one(librarySections, {
      fields: [libraryArticles.sectionId],
      references: [librarySections.id],
    }),
  })
);

export const featureRegistryRelations = relations(
  featureRegistry,
  ({ many }) => ({
    appStatuses: many(featureAppStatuses),
    flagLinks: many(featureFlagLinks),
  })
);

export const featureAppStatusesRelations = relations(
  featureAppStatuses,
  ({ one, many }) => ({
    feature: one(featureRegistry, {
      fields: [featureAppStatuses.featureId],
      references: [featureRegistry.id],
    }),
    evidence: many(featureEvidence),
  })
);

export const featureEvidenceRelations = relations(
  featureEvidence,
  ({ one }) => ({
    featureAppStatus: one(featureAppStatuses, {
      fields: [featureEvidence.featureAppStatusId],
      references: [featureAppStatuses.id],
    }),
  })
);

export const runtimeFlagsRelations = relations(runtimeFlags, ({ many }) => ({
  featureLinks: many(featureFlagLinks),
}));

export const featureFlagLinksRelations = relations(
  featureFlagLinks,
  ({ one }) => ({
    feature: one(featureRegistry, {
      fields: [featureFlagLinks.featureId],
      references: [featureRegistry.id],
    }),
    flag: one(runtimeFlags, {
      fields: [featureFlagLinks.flagId],
      references: [runtimeFlags.id],
    }),
  })
);

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Admin = typeof admins.$inferSelect;
export type InsertAdmin = typeof admins.$inferInsert;

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;

export type Community = typeof communities.$inferSelect;
export type InsertCommunity = typeof communities.$inferInsert;

export type CommunityMember = typeof communityMembers.$inferSelect;
export type InsertCommunityMember = typeof communityMembers.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

export type Summary = typeof summaries.$inferSelect;
export type InsertSummary = typeof summaries.$inferInsert;

export type SummaryVote = typeof summaryVotes.$inferSelect;
export type InsertSummaryVote = typeof summaryVotes.$inferInsert;

export type TelegramHelperMessageCleanup =
  typeof telegramHelperMessageCleanup.$inferSelect;
export type InsertTelegramHelperMessageCleanup =
  typeof telegramHelperMessageCleanup.$inferInsert;

export type TelegramCommandReceipt =
  typeof telegramCommandReceipts.$inferSelect;
export type InsertTelegramCommandReceipt =
  typeof telegramCommandReceipts.$inferInsert;

export type LoyalStatsSnapshot = typeof loyalStatsSnapshots.$inferSelect;
export type InsertLoyalStatsSnapshot = typeof loyalStatsSnapshots.$inferInsert;

export type BusinessConnection = typeof businessConnections.$inferSelect;
export type InsertBusinessConnection = typeof businessConnections.$inferInsert;

export type BotThread = typeof botThreads.$inferSelect;
export type InsertBotThread = typeof botThreads.$inferInsert;

export type BotMessage = typeof botMessages.$inferSelect;
export type InsertBotMessage = typeof botMessages.$inferInsert;

export type PushToken = typeof pushTokens.$inferSelect;
export type InsertPushToken = typeof pushTokens.$inferInsert;
export type EarnYieldPushState = typeof earnYieldPushState.$inferSelect;
export type InsertEarnYieldPushState = typeof earnYieldPushState.$inferInsert;

export type PushNotificationSend = typeof pushNotificationSends.$inferSelect;
export type InsertPushNotificationSend =
  typeof pushNotificationSends.$inferInsert;

export type PushNotificationTicket =
  typeof pushNotificationTickets.$inferSelect;
export type InsertPushNotificationTicket =
  typeof pushNotificationTickets.$inferInsert;

export type WalletPushSyncState = typeof walletPushSyncState.$inferSelect;
export type InsertWalletPushSyncState = typeof walletPushSyncState.$inferInsert;

export type HeliusWebhook = typeof heliusWebhooks.$inferSelect;
export type InsertHeliusWebhook = typeof heliusWebhooks.$inferInsert;
export type HeliusWebhookAddress = typeof heliusWebhookAddresses.$inferSelect;
export type InsertHeliusWebhookAddress =
  typeof heliusWebhookAddresses.$inferInsert;
export type HeliusWebhookDelivery = typeof heliusWebhookDeliveries.$inferSelect;
export type InsertHeliusWebhookDelivery =
  typeof heliusWebhookDeliveries.$inferInsert;

export type AppUser = typeof appUsers.$inferSelect;
export type InsertAppUser = typeof appUsers.$inferInsert;

export type AppUserWallet = typeof appUserWallets.$inferSelect;
export type InsertAppUserWallet = typeof appUserWallets.$inferInsert;

export type AppUserSmartAccount = typeof appUserSmartAccounts.$inferSelect;
export type InsertAppUserSmartAccount =
  typeof appUserSmartAccounts.$inferInsert;

export type AppSmartAccountSponsorshipTransaction =
  typeof appSmartAccountSponsorshipTransactions.$inferSelect;
export type InsertAppSmartAccountSponsorshipTransaction =
  typeof appSmartAccountSponsorshipTransactions.$inferInsert;

export type AppSmartAccountSettingsChangeRequest =
  typeof appSmartAccountSettingsChangeRequests.$inferSelect;
export type InsertAppSmartAccountSettingsChangeRequest =
  typeof appSmartAccountSettingsChangeRequests.$inferInsert;

export type AppSmartAccountSigner = typeof appSmartAccountSigners.$inferSelect;
export type InsertAppSmartAccountSigner =
  typeof appSmartAccountSigners.$inferInsert;

export type AppWalletAuthCompletion =
  typeof appWalletAuthCompletions.$inferSelect;
export type InsertAppWalletAuthCompletion =
  typeof appWalletAuthCompletions.$inferInsert;

export type AppChat = typeof appChats.$inferSelect;
export type InsertAppChat = typeof appChats.$inferInsert;

export type AppChatMessage = typeof appChatMessages.$inferSelect;
export type InsertAppChatMessage = typeof appChatMessages.$inferInsert;

export type FeatureRegistry = typeof featureRegistry.$inferSelect;
export type InsertFeatureRegistry = typeof featureRegistry.$inferInsert;

export type FeatureAppStatus = typeof featureAppStatuses.$inferSelect;
export type InsertFeatureAppStatus = typeof featureAppStatuses.$inferInsert;

export type FeatureEvidence = typeof featureEvidence.$inferSelect;
export type InsertFeatureEvidence = typeof featureEvidence.$inferInsert;

export type RuntimeFlag = typeof runtimeFlags.$inferSelect;
export type InsertRuntimeFlag = typeof runtimeFlags.$inferInsert;

export type FeatureFlagLink = typeof featureFlagLinks.$inferSelect;
export type InsertFeatureFlagLink = typeof featureFlagLinks.$inferInsert;

export type Topic = { title: string; content: string; sources: string[] };

export type PrivateTransferAnalyticsSyncState =
  typeof privateTransferAnalyticsSyncState.$inferSelect;
export type InsertPrivateTransferAnalyticsSyncState =
  typeof privateTransferAnalyticsSyncState.$inferInsert;

export type PrivateTransferTokenCatalog =
  typeof privateTransferTokenCatalog.$inferSelect;
export type InsertPrivateTransferTokenCatalog =
  typeof privateTransferTokenCatalog.$inferInsert;

export type PrivateTransferModifyBalanceEvent =
  typeof privateTransferModifyBalanceEvents.$inferSelect;
export type InsertPrivateTransferModifyBalanceEvent =
  typeof privateTransferModifyBalanceEvents.$inferInsert;

export type PrivateTransferVaultHolding =
  typeof privateTransferVaultHoldings.$inferSelect;
export type InsertPrivateTransferVaultHolding =
  typeof privateTransferVaultHoldings.$inferInsert;

export type GaslessClaimTransaction =
  typeof gaslessClaimTransactions.$inferSelect;
export type InsertGaslessClaimTransaction =
  typeof gaslessClaimTransactions.$inferInsert;

export type TrustedDapp = typeof trustedDapps.$inferSelect;
export type InsertTrustedDapp = typeof trustedDapps.$inferInsert;

export type LibrarySection = typeof librarySections.$inferSelect;
export type InsertLibrarySection = typeof librarySections.$inferInsert;

export type LibraryArticle = typeof libraryArticles.$inferSelect;
export type InsertLibraryArticle = typeof libraryArticles.$inferInsert;
