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
 * Push notification tokens for mobile app users.
 * Stores Expo push tokens linked to Telegram user IDs.
 */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    token: text("token").notNull(),
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).notNull(),
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
  ]
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
  (table) => [uniqueIndex("app_user_wallets_wallet_address_uidx").on(table.walletAddress)]
);

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
    index("app_chat_messages_chat_created_idx").on(table.chatId, table.createdAt),
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
  chats: many(appChats),
}));

export const appUserWalletsRelations = relations(appUserWallets, ({ one }) => ({
  user: one(appUsers, {
    fields: [appUserWallets.userId],
    references: [appUsers.id],
  }),
}));

export const appChatsRelations = relations(appChats, ({ one, many }) => ({
  user: one(appUsers, {
    fields: [appChats.userId],
    references: [appUsers.id],
  }),
  messages: many(appChatMessages),
}));

export const appChatMessagesRelations = relations(appChatMessages, ({ one }) => ({
  chat: one(appChats, {
    fields: [appChatMessages.chatId],
    references: [appChats.id],
  }),
}));

export const featureRegistryRelations = relations(featureRegistry, ({ many }) => ({
  appStatuses: many(featureAppStatuses),
  flagLinks: many(featureFlagLinks),
}));

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

export const featureEvidenceRelations = relations(featureEvidence, ({ one }) => ({
  featureAppStatus: one(featureAppStatuses, {
    fields: [featureEvidence.featureAppStatusId],
    references: [featureAppStatuses.id],
  }),
}));

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

export type BusinessConnection = typeof businessConnections.$inferSelect;
export type InsertBusinessConnection = typeof businessConnections.$inferInsert;

export type BotThread = typeof botThreads.$inferSelect;
export type InsertBotThread = typeof botThreads.$inferInsert;

export type BotMessage = typeof botMessages.$inferSelect;
export type InsertBotMessage = typeof botMessages.$inferInsert;

export type PushToken = typeof pushTokens.$inferSelect;
export type InsertPushToken = typeof pushTokens.$inferInsert;

export type AppUser = typeof appUsers.$inferSelect;
export type InsertAppUser = typeof appUsers.$inferInsert;

export type AppUserWallet = typeof appUserWallets.$inferSelect;
export type InsertAppUserWallet = typeof appUserWallets.$inferInsert;

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
