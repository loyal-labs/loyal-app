import { stat } from "node:fs/promises";

import {
  communities,
  messages,
  type CommunityParserType,
} from "@loyal-labs/db-core/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

import { createUserbotClient, type UserbotClientBundle } from "../lib/client";
import {
  createWorkerDatabase,
  loadDatabaseUrl,
  type UserbotDb,
} from "../lib/database";
import { loadUserbotConfig, type UserbotConfig } from "../lib/env";
import {
  buildReauthGuidance,
  createNonInteractiveStartParams,
} from "../lib/non-interactive-auth";
import {
  BOT_EMPTY_BATCH_STOP_COUNT,
  BOT_ID_BATCH_SIZE,
  fetchMessagesSince,
  fetchUnseenMessagesByIdBatches,
  fetchUnseenMessages,
  getLatestTelegramMessageId,
} from "../lib/sync/history-source";
import { toIngestibleMessage } from "../lib/sync/message-filter";
import { persistEligibleMessage } from "../lib/sync/persistence";
import { resolveSessionSqlitePath } from "../lib/storage";

type EnvRecord = Record<string, string | undefined>;

type Logger = Pick<Console, "error" | "info" | "warn">;

type SyncOnceDeps = {
  createClient: (config: UserbotConfig) => Promise<UserbotClientBundle>;
  createDb: (databaseUrl: string) => UserbotDb;
  env: EnvRecord;
  hasFile: (path: string) => Promise<boolean>;
  loadConfig: (env: EnvRecord) => UserbotConfig;
  loadDatabaseUrl: (env: EnvRecord) => string;
  logger: Logger;
  sleep: (ms: number) => Promise<void>;
};

type SyncOnceOptions = {
  dialogSyncOnly?: boolean;
  chatIds?: bigint[];
  lookbackDays?: number | null;
  now?: Date;
  parserTypes?: CommunityParserType[];
};

type ResolvedSyncOnceOptions = {
  dialogSyncOnly: boolean;
  chatIds: bigint[] | null;
  lookbackDays: number | null;
  lookbackWindowEndExclusiveUtc: Date | null;
  lookbackWindowStartUtc: Date | null;
  parserTypes: CommunityParserType[];
};

type ActiveSyncCommunity = {
  chatId: bigint;
  chatTitle: string;
  id: string;
  parserType: CommunityParserType;
};

type DiscoveredUserbotCommunity = {
  chatId: bigint;
  chatTitle: string;
};

type CommunitySyncError = {
  chatId: string;
  communityId: string;
  error: string;
};

export type SyncOnceStats = {
  authMode: UserbotConfig["authMode"];
  botBatchRequests: number;
  botEmptyBatches: number;
  botStopAfterEmptyBatches: number | null;
  botUsedIdBatchFetch: boolean;
  botUsedLookbackFilter: boolean;
  botBatchSize: number | null;
  chatIdFilterCount: number | null;
  communitiesFailed: number;
  communitiesProcessed: number;
  communitiesScanned: number;
  communitiesUpToDate: number;
  communitiesWithNoStoredMessages: number;
  communitiesWithNoTelegramHistory: number;
  duplicateMessages: number;
  insertedMemberships: number;
  insertedMessages: number;
  missingUserbotCommunitiesDetected: number;
  missingUserbotCommunitiesInserted: number;
  insertedUsers: number;
  retryCount: number;
  skippedNonText: number;
  skippedNonUserSender: number;
  skippedOldOrEqual: number;
  skippedUnsupportedShape: number;
  telegramDialogsScanned: number;
  telegramEligibleGroupDialogs: number;
  telegramMessagesConsidered: number;
  telegramMessagesFetched: number;
  userMetadataUpdates: number;
  lookbackDays: number | null;
  lookbackWindowEndExclusiveUtc: string | null;
  lookbackWindowStartUtc: string | null;
  selectedParserTypes: CommunityParserType[];
};

export type SyncOnceResult = {
  errors: CommunitySyncError[];
  stats: SyncOnceStats;
};

const RETRY_BASE_DELAY_MS = 250;
const RETRY_MAX_ATTEMPTS = 3;
const SUPPORTED_PARSER_TYPES: CommunityParserType[] = ["bot", "userbot"];

function isDirectExecution(scriptName: string): boolean {
  const entrypoint = process.argv[1];
  return typeof entrypoint === "string" && entrypoint.endsWith(scriptName);
}

async function hasFile(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function toUtcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function resolveSyncOptions(
  options: SyncOnceOptions = {}
): ResolvedSyncOnceOptions {
  const parserTypes: CommunityParserType[] = options.parserTypes?.length
    ? [...new Set(options.parserTypes)]
    : ["userbot"];
  const invalidParserTypes = parserTypes.filter(
    (entry) => !SUPPORTED_PARSER_TYPES.includes(entry)
  );
  if (invalidParserTypes.length > 0) {
    throw new Error(
      `Unsupported parser type(s): ${invalidParserTypes.join(
        ", "
      )}. Supported values: ${SUPPORTED_PARSER_TYPES.join(", ")}`
    );
  }

  const lookbackDays = options.lookbackDays ?? null;
  if (
    lookbackDays !== null &&
    (!Number.isInteger(lookbackDays) || lookbackDays <= 0)
  ) {
    throw new Error("lookbackDays must be a positive integer");
  }

  if (lookbackDays === null) {
    return {
      dialogSyncOnly: options.dialogSyncOnly === true,
      chatIds: options.chatIds?.length ? options.chatIds : null,
      lookbackDays: null,
      lookbackWindowEndExclusiveUtc: null,
      lookbackWindowStartUtc: null,
      parserTypes,
    };
  }

  const now = options.now ?? new Date();
  const lookbackWindowEndExclusiveUtc = toUtcDayStart(now);
  const lookbackWindowStartUtc = new Date(
    lookbackWindowEndExclusiveUtc.getTime() -
      lookbackDays * 24 * 60 * 60 * 1_000
  );

  return {
    dialogSyncOnly: options.dialogSyncOnly === true,
    chatIds: options.chatIds?.length ? options.chatIds : null,
    lookbackDays,
    lookbackWindowEndExclusiveUtc,
    lookbackWindowStartUtc,
    parserTypes,
  };
}

function parseParserTypes(value: string): CommunityParserType[] {
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parsed.length === 0) {
    throw new Error("--parser-types must include at least one parser type");
  }

  const invalid = parsed.filter(
    (entry) => !SUPPORTED_PARSER_TYPES.includes(entry as CommunityParserType)
  );
  if (invalid.length > 0) {
    throw new Error(
      `Unsupported parser type(s): ${invalid.join(
        ", "
      )}. Supported values: ${SUPPORTED_PARSER_TYPES.join(", ")}`
    );
  }

  return [...new Set(parsed as CommunityParserType[])];
}

function parseChatIds(value: string): bigint[] {
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (parsed.length === 0) {
    throw new Error("--chat-ids must include at least one chat id");
  }

  return parsed.map((entry) => {
    try {
      return BigInt(entry);
    } catch {
      throw new Error(`Invalid --chat-ids value: '${entry}'`);
    }
  });
}

function parseSyncOnceCliOptions(argv: string[]): SyncOnceOptions {
  const options: SyncOnceOptions = {};

  for (const arg of argv.slice(2)) {
    if (arg === "--dialog-sync-only" || arg === "--dialogue-sync-only") {
      options.dialogSyncOnly = true;
      continue;
    }

    if (arg.startsWith("--parser-types=")) {
      options.parserTypes = parseParserTypes(
        arg.slice("--parser-types=".length)
      );
      continue;
    }

    if (arg.startsWith("--lookback-days=")) {
      const value = Number.parseInt(arg.slice("--lookback-days=".length), 10);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--lookback-days must be a positive integer");
      }
      options.lookbackDays = value;
      continue;
    }

    if (arg.startsWith("--chat-ids=")) {
      options.chatIds = parseChatIds(arg.slice("--chat-ids=".length));
      continue;
    }
  }

  return options;
}

function resolveDeps(overrides: Partial<SyncOnceDeps>): SyncOnceDeps {
  return {
    createClient: overrides.createClient ?? createUserbotClient,
    createDb: overrides.createDb ?? createWorkerDatabase,
    env: overrides.env ?? process.env,
    hasFile: overrides.hasFile ?? hasFile,
    loadConfig: overrides.loadConfig ?? loadUserbotConfig,
    loadDatabaseUrl: overrides.loadDatabaseUrl ?? loadDatabaseUrl,
    logger: overrides.logger ?? console,
    sleep: overrides.sleep ?? sleep,
  };
}

function createInitialStats(
  communitiesScanned: number,
  options: ResolvedSyncOnceOptions,
  config: UserbotConfig
): SyncOnceStats {
  const isBotAuthMode = config.authMode === "bot";

  return {
    authMode: config.authMode,
    botBatchRequests: 0,
    botBatchSize: isBotAuthMode ? BOT_ID_BATCH_SIZE : null,
    botEmptyBatches: 0,
    botStopAfterEmptyBatches: isBotAuthMode ? BOT_EMPTY_BATCH_STOP_COUNT : null,
    botUsedIdBatchFetch: isBotAuthMode,
    botUsedLookbackFilter:
      isBotAuthMode && options.lookbackWindowStartUtc !== null,
    chatIdFilterCount: options.chatIds?.length ?? null,
    communitiesFailed: 0,
    communitiesProcessed: 0,
    communitiesScanned,
    communitiesUpToDate: 0,
    communitiesWithNoStoredMessages: 0,
    communitiesWithNoTelegramHistory: 0,
    duplicateMessages: 0,
    insertedMemberships: 0,
    insertedMessages: 0,
    missingUserbotCommunitiesDetected: 0,
    missingUserbotCommunitiesInserted: 0,
    insertedUsers: 0,
    retryCount: 0,
    skippedNonText: 0,
    skippedNonUserSender: 0,
    skippedOldOrEqual: 0,
    skippedUnsupportedShape: 0,
    telegramDialogsScanned: 0,
    telegramEligibleGroupDialogs: 0,
    telegramMessagesConsidered: 0,
    telegramMessagesFetched: 0,
    userMetadataUpdates: 0,
    lookbackDays: options.lookbackDays,
    lookbackWindowEndExclusiveUtc:
      options.lookbackWindowEndExclusiveUtc?.toISOString() ?? null,
    lookbackWindowStartUtc:
      options.lookbackWindowStartUtc?.toISOString() ?? null,
    selectedParserTypes: options.parserTypes,
  };
}

function isTransientError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toUpperCase()
      : String(error).toUpperCase();
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"].includes(code)) {
    return true;
  }

  return (
    message.includes("FLOOD_WAIT") ||
    message.includes("RPC_CALL_FAIL") ||
    message.includes("TIMEOUT") ||
    message.includes("NETWORK")
  );
}

async function runWithRetry<T>(
  deps: SyncOnceDeps,
  stats: SyncOnceStats,
  label: string,
  task: () => Promise<T>
): Promise<T> {
  let attempt = 0;

  while (attempt < RETRY_MAX_ATTEMPTS) {
    attempt += 1;
    try {
      return await task();
    } catch (error) {
      const shouldRetry =
        isTransientError(error) && attempt < RETRY_MAX_ATTEMPTS;
      if (!shouldRetry) {
        throw error;
      }

      stats.retryCount += 1;
      const delayMs = RETRY_BASE_DELAY_MS * attempt;
      deps.logger.warn(
        `[userbot] transient error while ${label}; retrying in ${delayMs}ms`,
        error
      );
      await deps.sleep(delayMs);
    }
  }

  throw new Error(`Failed retry loop for ${label}`);
}

async function destroyBundle(
  bundle: UserbotClientBundle,
  logger: Logger,
  context: string
): Promise<void> {
  try {
    await bundle.client.destroy();
  } catch (error) {
    logger.error(`[userbot] Failed to destroy client (${context})`, error);
  }
}

async function getLatestStoredMessageId(
  db: UserbotDb,
  communityId: string
): Promise<number | null> {
  const latestStored = await db.query.messages.findFirst({
    columns: { telegramMessageId: true },
    orderBy: [desc(messages.telegramMessageId)],
    where: eq(messages.communityId, communityId),
  });

  return latestStored?.telegramMessageId !== undefined
    ? Number(latestStored.telegramMessageId)
    : null;
}

function toBigIntId(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }

  return null;
}

function readStartedAccountId(account: unknown): bigint | null {
  if (!account || typeof account !== "object") {
    return null;
  }

  const id = (account as { id?: unknown }).id;
  return toBigIntId(id);
}

function readDiscoveredCommunity(
  dialog: unknown
): DiscoveredUserbotCommunity | null {
  if (!dialog || typeof dialog !== "object") {
    return null;
  }

  const peer = (dialog as { peer?: unknown }).peer;
  if (!peer || typeof peer !== "object") {
    return null;
  }

  const candidate = peer as {
    chatType?: unknown;
    id?: unknown;
    isMember?: unknown;
    title?: unknown;
    type?: unknown;
  };

  if (candidate.type !== "chat") {
    return null;
  }

  if (candidate.chatType !== "group" && candidate.chatType !== "supergroup") {
    return null;
  }

  if (candidate.isMember !== true) {
    return null;
  }

  const chatId = toBigIntId(candidate.id);
  if (chatId === null) {
    return null;
  }

  const chatTitle =
    typeof candidate.title === "string" && candidate.title.trim().length > 0
      ? candidate.title.trim()
      : "Untitled";

  return {
    chatId,
    chatTitle,
  };
}

async function importMissingUserbotCommunities(params: {
  accountTelegramId: bigint;
  bundle: UserbotClientBundle;
  db: UserbotDb;
  stats: SyncOnceStats;
}): Promise<void> {
  const discoveredByChatId = new Map<string, DiscoveredUserbotCommunity>();

  for await (const dialog of params.bundle.client.iterDialogs({
    archived: "exclude",
  })) {
    params.stats.telegramDialogsScanned += 1;
    const discoveredCommunity = readDiscoveredCommunity(dialog);
    if (!discoveredCommunity) {
      continue;
    }

    params.stats.telegramEligibleGroupDialogs += 1;
    const chatIdKey = discoveredCommunity.chatId.toString();
    if (discoveredByChatId.has(chatIdKey)) {
      continue;
    }

    discoveredByChatId.set(chatIdKey, discoveredCommunity);
  }

  if (discoveredByChatId.size === 0) {
    return;
  }

  const discoveredChatIds = [...discoveredByChatId.values()].map(
    (community) => community.chatId
  );
  const existingCommunities = await params.db.query.communities.findMany({
    columns: {
      chatId: true,
    },
    where: inArray(communities.chatId, discoveredChatIds),
  });
  const existingChatIds = new Set(
    existingCommunities.map((community) => community.chatId.toString())
  );

  const missingCommunities = [...discoveredByChatId.values()].filter(
    (community) => !existingChatIds.has(community.chatId.toString())
  );
  params.stats.missingUserbotCommunitiesDetected = missingCommunities.length;

  for (const missingCommunity of missingCommunities) {
    const inserted = await params.db
      .insert(communities)
      .values({
        activatedBy: params.accountTelegramId,
        chatId: missingCommunity.chatId,
        chatTitle: missingCommunity.chatTitle,
        isActive: false,
        isPublic: false,
        parserType: "userbot",
        settings: {},
        summaryNotificationMessageCount: null,
        summaryNotificationTimeHours: null,
        summaryNotificationsEnabled: false,
      })
      .onConflictDoNothing()
      .returning({ id: communities.id });

    if (inserted.length > 0) {
      params.stats.missingUserbotCommunitiesInserted += 1;
    }
  }
}

async function syncCommunityWithBotIdBatches(
  db: UserbotDb,
  bundle: UserbotClientBundle,
  community: ActiveSyncCommunity,
  stats: SyncOnceStats,
  options: ResolvedSyncOnceOptions,
  userIdCache: Map<string, string>,
  membershipCache: Set<string>
): Promise<void> {
  const chatPeerId = Number(community.chatId);
  const latestStoredMessageId = await getLatestStoredMessageId(
    db,
    community.id
  );

  if (latestStoredMessageId === null) {
    stats.communitiesWithNoStoredMessages += 1;
  }

  let fetchedMessages = 0;
  for await (const rawMessage of fetchUnseenMessagesByIdBatches(
    bundle.client,
    chatPeerId,
    latestStoredMessageId,
    {
      batchSize: BOT_ID_BATCH_SIZE,
      onBatch: (payload) => {
        stats.botBatchRequests += 1;
        if (payload.wasEmpty) {
          stats.botEmptyBatches += 1;
        }
      },
      stopAfterEmptyBatches: BOT_EMPTY_BATCH_STOP_COUNT,
    }
  )) {
    fetchedMessages += 1;
    stats.telegramMessagesFetched += 1;
    stats.telegramMessagesConsidered += 1;

    const message = toIngestibleMessage(rawMessage, stats);
    if (!message) {
      continue;
    }

    if (
      latestStoredMessageId !== null &&
      message.messageId <= latestStoredMessageId
    ) {
      stats.skippedOldOrEqual += 1;
      continue;
    }

    if (
      options.lookbackWindowEndExclusiveUtc &&
      message.createdAt >= options.lookbackWindowEndExclusiveUtc
    ) {
      break;
    }

    if (
      options.lookbackWindowStartUtc &&
      message.createdAt < options.lookbackWindowStartUtc
    ) {
      continue;
    }

    await persistEligibleMessage({
      communityId: community.id,
      db,
      membershipCache,
      message,
      stats,
      userIdCache,
    });
  }

  if (fetchedMessages === 0) {
    if (latestStoredMessageId === null) {
      stats.communitiesWithNoTelegramHistory += 1;
      return;
    }

    stats.communitiesUpToDate += 1;
  }
}

async function syncCommunity(
  db: UserbotDb,
  bundle: UserbotClientBundle,
  authMode: UserbotConfig["authMode"],
  community: ActiveSyncCommunity,
  stats: SyncOnceStats,
  options: ResolvedSyncOnceOptions,
  userIdCache: Map<string, string>,
  membershipCache: Set<string>
): Promise<void> {
  if (authMode === "bot") {
    await syncCommunityWithBotIdBatches(
      db,
      bundle,
      community,
      stats,
      options,
      userIdCache,
      membershipCache
    );
    return;
  }

  const chatPeerId = Number(community.chatId);

  if (options.lookbackWindowStartUtc) {
    let fetchedMessages = 0;

    for await (const rawMessage of fetchMessagesSince(
      bundle.client,
      chatPeerId,
      options.lookbackWindowStartUtc
    )) {
      fetchedMessages += 1;
      stats.telegramMessagesFetched += 1;
      stats.telegramMessagesConsidered += 1;

      const message = toIngestibleMessage(rawMessage, stats);
      if (!message) {
        continue;
      }

      if (
        options.lookbackWindowEndExclusiveUtc &&
        message.createdAt >= options.lookbackWindowEndExclusiveUtc
      ) {
        continue;
      }

      await persistEligibleMessage({
        communityId: community.id,
        db,
        membershipCache,
        message,
        stats,
        userIdCache,
      });
    }

    if (fetchedMessages === 0) {
      stats.communitiesUpToDate += 1;
    }
    return;
  }

  const latestStoredMessageId = await getLatestStoredMessageId(
    db,
    community.id
  );

  if (latestStoredMessageId === null) {
    stats.communitiesWithNoStoredMessages += 1;
  }

  const latestTelegramMessageId = await getLatestTelegramMessageId(
    bundle.client,
    chatPeerId
  );
  if (latestTelegramMessageId === null) {
    stats.communitiesWithNoTelegramHistory += 1;
    return;
  }

  if (
    latestStoredMessageId !== null &&
    latestTelegramMessageId <= latestStoredMessageId
  ) {
    stats.communitiesUpToDate += 1;
    return;
  }

  for await (const rawMessage of fetchUnseenMessages(
    bundle.client,
    chatPeerId,
    latestStoredMessageId
  )) {
    stats.telegramMessagesFetched += 1;
    stats.telegramMessagesConsidered += 1;

    const message = toIngestibleMessage(rawMessage, stats);
    if (!message) {
      continue;
    }

    if (
      latestStoredMessageId !== null &&
      message.messageId <= latestStoredMessageId
    ) {
      stats.skippedOldOrEqual += 1;
      continue;
    }

    await persistEligibleMessage({
      communityId: community.id,
      db,
      membershipCache,
      message,
      stats,
      userIdCache,
    });
  }
}

export async function runSyncOnce(
  overrides: Partial<SyncOnceDeps> = {},
  options: SyncOnceOptions = {}
): Promise<SyncOnceResult> {
  const deps = resolveDeps(overrides);
  const resolvedOptions = resolveSyncOptions(options);
  const config = deps.loadConfig(deps.env);
  deps.logger.info(
    `[userbot] Starting sync:once for '${config.accountKey}' (authMode=${config.authMode}).`
  );
  deps.logger.info(
    `[userbot] sync:once fetch strategy: ${
      config.authMode === "bot" ? "getMessages-id-batch" : "history"
    }`
  );
  if (resolvedOptions.dialogSyncOnly) {
    deps.logger.info("[userbot] dialog sync only mode is enabled.");
  }
  const sessionPath = resolveSessionSqlitePath(
    config.accountKey,
    config.storageDir
  );

  const sessionExists = await deps.hasFile(sessionPath);
  if (!sessionExists && config.authMode === "user") {
    throw new Error(
      `[userbot] Missing session file for '${config.accountKey}'. Run auth:bootstrap first. Expected: ${sessionPath}`
    );
  }
  if (!sessionExists && config.authMode === "bot") {
    deps.logger.info(
      `[userbot] No session found for '${config.accountKey}' in bot mode; proceeding with token-based startup.`
    );
  }

  const bundle = await deps.createClient(config);
  const userIdCache = new Map<string, string>();
  const membershipCache = new Set<string>();
  const stats = createInitialStats(0, resolvedOptions, config);

  try {
    const account = await bundle.client.start(
      createNonInteractiveStartParams(config)
    );

    const databaseUrl = deps.loadDatabaseUrl(deps.env);
    const db = deps.createDb(databaseUrl);

    if (config.authMode === "user") {
      const accountTelegramId = readStartedAccountId(account);
      if (accountTelegramId === null) {
        throw new Error(
          "Failed to read authenticated account id for userbot community discovery."
        );
      }

      await runWithRetry(
        deps,
        stats,
        "discovering and importing userbot communities",
        async () => {
          await importMissingUserbotCommunities({
            accountTelegramId,
            bundle,
            db,
            stats,
          });
        }
      );
    } else {
      deps.logger.info(
        "[userbot] Skipping community discovery because authMode=bot."
      );
    }

    if (resolvedOptions.dialogSyncOnly) {
      const result = {
        errors: [] as CommunitySyncError[],
        stats,
      };
      deps.logger.info(
        "[userbot] sync:once completed (dialog-sync-only)",
        result
      );
      return result;
    }

    const whereClauses = [
      eq(communities.isActive, true),
      inArray(communities.parserType, resolvedOptions.parserTypes),
    ];
    if (resolvedOptions.chatIds) {
      whereClauses.push(inArray(communities.chatId, resolvedOptions.chatIds));
    }

    const queriedCommunities = await db.query.communities.findMany({
      columns: {
        chatId: true,
        chatTitle: true,
        id: true,
        parserType: true,
      },
      where: and(...whereClauses),
    });

    // Keep runtime filtering explicit for auditability in tests and logs.
    const chatIdFilter =
      resolvedOptions.chatIds === null
        ? null
        : new Set(resolvedOptions.chatIds.map((chatId) => chatId.toString()));
    const selectedCommunities = queriedCommunities.filter((community) => {
      if (!resolvedOptions.parserTypes.includes(community.parserType)) {
        return false;
      }

      if (!chatIdFilter) {
        return true;
      }

      return chatIdFilter.has(community.chatId.toString());
    });

    stats.communitiesScanned = selectedCommunities.length;
    const errors: CommunitySyncError[] = [];

    for (const community of selectedCommunities) {
      stats.communitiesProcessed += 1;

      try {
        await runWithRetry(
          deps,
          stats,
          `syncing community ${community.id}`,
          async () => {
            await syncCommunity(
              db,
              bundle,
              config.authMode,
              community,
              stats,
              resolvedOptions,
              userIdCache,
              membershipCache
            );
          }
        );
      } catch (error) {
        stats.communitiesFailed += 1;
        errors.push({
          chatId: community.chatId.toString(),
          communityId: community.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const result = {
      errors,
      stats,
    };

    deps.logger.info("[userbot] sync:once completed", result);
    return result;
  } finally {
    await destroyBundle(bundle, deps.logger, "sync_once");
  }
}

export async function runSyncOnceCli(
  overrides: Partial<SyncOnceDeps> = {}
): Promise<number> {
  const logger = overrides.logger ?? console;
  const argv = process.argv;
  const loadConfig = overrides.loadConfig ?? loadUserbotConfig;
  const env = overrides.env ?? process.env;

  try {
    const config = loadConfig(env);
    const options = parseSyncOnceCliOptions(argv);
    await runSyncOnce(overrides, options);
    return 0;
  } catch (error) {
    let guidance = "Run bun run auth:bootstrap.";
    try {
      guidance = buildReauthGuidance(loadConfig(env));
    } catch {
      // Keep default guidance when config cannot be loaded.
    }
    logger.error(`[userbot] sync:once failed to start. ${guidance}`, error);
    return 1;
  }
}

if (isDirectExecution("sync-once.ts")) {
  process.exit(await runSyncOnceCli());
}
