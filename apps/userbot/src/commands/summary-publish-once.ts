import { randomBytes } from "node:crypto";

import { communities } from "@loyal-labs/db-core/schema";
import { Long } from "@mtcute/core";
import { and, eq, inArray } from "drizzle-orm";

import { createUserbotClient, type UserbotClientBundle } from "../lib/client";
import {
  hasFile,
  isTransientError,
  parseChatIdsCsv,
  runWithRetry,
  sleep,
} from "../lib/command-runtime";
import {
  createWorkerDatabase,
  loadDatabaseUrl,
  type UserbotDb,
} from "../lib/database";
import { loadUserbotConfig, type UserbotConfig } from "../lib/env";
import { createNonInteractiveStartParams } from "../lib/non-interactive-auth";
import {
  loadSummaryPublishEnvOptions,
  resolveSummarySourceChatId,
  type SummaryPeerOverride,
} from "../lib/summary-publish-env";
import { resolveSessionSqlitePath } from "../lib/storage";

type EnvRecord = Record<string, string | undefined>;

type Logger = Pick<Console, "error" | "info" | "warn">;

type SummaryPublishScope = "inline_query" | "delivery";

type CommunityPublishError = {
  chatId: string;
  communityId: string;
  error: string;
  scope: SummaryPublishScope;
};

export type SummaryPublishOnceStats = {
  authMode: UserbotConfig["authMode"];
  botUsername: string;
  chatIdFilterCount: number | null;
  communitiesMatched: number;
  communitiesProcessed: number;
  deliveryAttempted: number;
  deliveryFailed: number;
  deliverySucceeded: number;
  errors: number;
  retryCount: number;
  skippedNoInlineResults: number;
};

export type SummaryPublishOnceResult = {
  errors: CommunityPublishError[];
  stats: SummaryPublishOnceStats;
};

type SummaryPublishOnceOptions = {
  chatIds?: bigint[];
};

type ResolvedSummaryPublishOnceOptions = {
  chatIds: bigint[] | null;
};

type ActiveSummaryCommunity = {
  chatId: bigint;
  id: string;
};

type SummaryPublishOnceDeps = {
  createClient: (config: UserbotConfig) => Promise<UserbotClientBundle>;
  createDb: (databaseUrl: string) => UserbotDb;
  createRandomId: () => Long;
  env: EnvRecord;
  hasFile: (path: string) => Promise<boolean>;
  loadConfig: (env: EnvRecord) => UserbotConfig;
  loadDatabaseUrl: (env: EnvRecord) => string;
  logger: Logger;
  runWithRetry: typeof runWithRetry;
  sleep: (ms: number) => Promise<void>;
};

const RETRY_BASE_DELAY_MS = 250;
const RETRY_MAX_ATTEMPTS = 3;
const RANDOM_ID_MASK = (1n << 63n) - 1n;

function isDirectExecution(scriptName: string): boolean {
  const entrypoint = process.argv[1];
  return typeof entrypoint === "string" && entrypoint.endsWith(scriptName);
}

function parseSummaryPublishOnceCliOptions(
  argv: string[]
): SummaryPublishOnceOptions {
  const options: SummaryPublishOnceOptions = {};

  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--chat-ids=")) {
      options.chatIds = parseChatIdsCsv(arg.slice("--chat-ids=".length));
    }
  }

  return options;
}

function resolveOptions(
  options: SummaryPublishOnceOptions = {}
): ResolvedSummaryPublishOnceOptions {
  return {
    chatIds: options.chatIds?.length ? [...new Set(options.chatIds)] : null,
  };
}

function resolveDeps(
  overrides: Partial<SummaryPublishOnceDeps>
): SummaryPublishOnceDeps {
  return {
    createClient: overrides.createClient ?? createUserbotClient,
    createDb: overrides.createDb ?? createWorkerDatabase,
    createRandomId: overrides.createRandomId ?? createRandomMessageId,
    env: overrides.env ?? process.env,
    hasFile: overrides.hasFile ?? hasFile,
    loadConfig: overrides.loadConfig ?? loadUserbotConfig,
    loadDatabaseUrl: overrides.loadDatabaseUrl ?? loadDatabaseUrl,
    logger: overrides.logger ?? console,
    runWithRetry: overrides.runWithRetry ?? runWithRetry,
    sleep: overrides.sleep ?? sleep,
  };
}

function createRandomMessageId(): Long {
  const randomId = randomBytes(8).readBigUInt64BE(0) & RANDOM_ID_MASK;
  return Long.fromString(randomId.toString(), false);
}

function createRetryLogger(params: {
  deps: SummaryPublishOnceDeps;
  stats: SummaryPublishOnceStats;
  label: string;
}) {
  return async ({
    delayMs,
    error,
  }: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => {
    params.stats.retryCount += 1;
    params.deps.logger.warn(
      `[userbot] transient error while ${params.label}; retrying in ${delayMs}ms`,
      error
    );
  };
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

function toSummaryPublishError(
  error: unknown,
  context: { chatId: bigint; communityId: string; scope: SummaryPublishScope }
): CommunityPublishError {
  return {
    chatId: context.chatId.toString(),
    communityId: context.communityId,
    error: error instanceof Error ? error.message : String(error),
    scope: context.scope,
  };
}

function recordCommunityFailure(params: {
  context: { chatId: bigint; communityId: string; scope: SummaryPublishScope };
  error: unknown;
  errors: CommunityPublishError[];
  stats: SummaryPublishOnceStats;
}): void {
  params.stats.deliveryFailed += 1;
  params.stats.errors += 1;
  params.errors.push(toSummaryPublishError(params.error, params.context));
}

async function fetchInlineSummaryResult(params: {
  bundle: UserbotClientBundle;
  community: ActiveSummaryCommunity;
  deps: SummaryPublishOnceDeps;
  peerOverride: SummaryPeerOverride | null;
  botInputUser: Awaited<
    ReturnType<UserbotClientBundle["client"]["resolveUser"]>
  >;
}): Promise<{
  destinationPeer: Awaited<
    ReturnType<UserbotClientBundle["client"]["resolvePeer"]>
  >;
  queryId: Long;
  resultId: string;
}> {
  let destinationPeer;
  try {
    destinationPeer = await params.bundle.client.resolvePeer(
      Number(params.community.chatId)
    );
  } catch (err) {
    params.deps.logger.warn(
      `[userbot] resolvePeer cache miss for chatId=${params.community.chatId}, retrying with force`,
      { chatId: String(params.community.chatId), error: String(err) }
    );
    await params.deps.sleep(3000);
    try {
      destinationPeer = await params.bundle.client.resolvePeer(
        Number(params.community.chatId),
        true
      );
    } catch (forceErr) {
      params.deps.logger.error(
        `[userbot] resolvePeer force failed for chatId=${params.community.chatId}`,
        { chatId: String(params.community.chatId), error: String(forceErr) }
      );
      throw forceErr;
    }
  }
  const sourceChatId = resolveSummarySourceChatId(
    params.community.chatId,
    params.peerOverride
  );

  const inlineResults = await params.bundle.client.call({
    _: "messages.getInlineBotResults",
    bot: params.botInputUser,
    offset: "",
    peer: destinationPeer,
    query: `summary:${sourceChatId}`,
  });

  const firstResult = inlineResults.results[0];
  if (!firstResult) {
    throw new Error(
      "[userbot] summary:publish:once Inline bot returned no results"
    );
  }

  return {
    destinationPeer,
    queryId: inlineResults.queryId,
    resultId: firstResult.id,
  };
}

async function sendInlineSummaryResult(params: {
  bundle: UserbotClientBundle;
  destinationPeer: Awaited<
    ReturnType<UserbotClientBundle["client"]["resolvePeer"]>
  >;
  queryId: Long;
  resultId: string;
  randomId: Long;
}): Promise<void> {
  await params.bundle.client.call({
    _: "messages.sendInlineBotResult",
    id: params.resultId,
    peer: params.destinationPeer,
    queryId: params.queryId,
    randomId: params.randomId,
  });
}

export async function runSummaryPublishOnce(
  overrides: Partial<SummaryPublishOnceDeps> = {},
  options: SummaryPublishOnceOptions = {}
): Promise<SummaryPublishOnceResult> {
  const deps = resolveDeps(overrides);
  const resolvedOptions = resolveOptions(options);
  const config = deps.loadConfig(deps.env);

  if (config.authMode === "bot") {
    throw new Error(
      "[userbot] summary:publish:once requires user auth mode. Remove TELEGRAM_USERBOT_BOT_TOKEN/ASKLOYAL_TGBOT_KEY and run bun run auth:bootstrap."
    );
  }

  const envOptions = loadSummaryPublishEnvOptions(deps.env);
  const sessionPath = resolveSessionSqlitePath(
    config.accountKey,
    config.storageDir
  );
  const sessionExists = await deps.hasFile(sessionPath);

  if (!sessionExists) {
    throw new Error(
      `[userbot] Missing session file for '${config.accountKey}'. Run auth:bootstrap first. Expected: ${sessionPath}`
    );
  }

  deps.logger.info(
    `[userbot] Starting summary:publish:once for '${config.accountKey}' using @${envOptions.inlineBotUsername}.`
  );

  const bundle = await deps.createClient(config);

  const stats: SummaryPublishOnceStats = {
    authMode: config.authMode,
    botUsername: envOptions.inlineBotUsername,
    chatIdFilterCount: resolvedOptions.chatIds?.length ?? null,
    communitiesMatched: 0,
    communitiesProcessed: 0,
    deliveryAttempted: 0,
    deliveryFailed: 0,
    deliverySucceeded: 0,
    errors: 0,
    retryCount: 0,
    skippedNoInlineResults: 0,
  };
  const errors: CommunityPublishError[] = [];

  try {
    await bundle.client.start(createNonInteractiveStartParams(config));

    const db = deps.createDb(deps.loadDatabaseUrl(deps.env));

    const whereClauses = [
      eq(communities.isActive, true),
      eq(communities.parserType, "userbot"),
      eq(communities.summaryNotificationsEnabled, true),
    ];

    if (resolvedOptions.chatIds) {
      whereClauses.push(inArray(communities.chatId, resolvedOptions.chatIds));
    }

    const queriedCommunities = await db.query.communities.findMany({
      columns: {
        chatId: true,
        id: true,
      },
      where: and(...whereClauses),
    });

    const chatIdFilter =
      resolvedOptions.chatIds === null
        ? null
        : new Set(resolvedOptions.chatIds.map((chatId) => chatId.toString()));

    const selectedCommunities = chatIdFilter
      ? queriedCommunities.filter((community) =>
          chatIdFilter.has(community.chatId.toString())
        )
      : queriedCommunities;

    stats.communitiesMatched = selectedCommunities.length;

    const botInputUser = await deps.runWithRetry({
      baseDelayMs: RETRY_BASE_DELAY_MS,
      isRetryable: isTransientError,
      maxAttempts: RETRY_MAX_ATTEMPTS,
      onRetry: createRetryLogger({
        deps,
        label: `resolving inline bot @${envOptions.inlineBotUsername}`,
        stats,
      }),
      sleepFn: deps.sleep,
      task: async () => {
        return bundle.client.resolveUser(envOptions.inlineBotUsername);
      },
    });

    for (const community of selectedCommunities) {
      stats.communitiesProcessed += 1;
      stats.deliveryAttempted += 1;

      let inlineResult: {
        destinationPeer: Awaited<
          ReturnType<UserbotClientBundle["client"]["resolvePeer"]>
        >;
        queryId: Long;
        resultId: string;
      };

      try {
        inlineResult = await deps.runWithRetry({
          baseDelayMs: RETRY_BASE_DELAY_MS,
          isRetryable: isTransientError,
          maxAttempts: RETRY_MAX_ATTEMPTS,
          onRetry: createRetryLogger({
            deps,
            label: `fetching inline summary for community ${community.id}`,
            stats,
          }),
          sleepFn: deps.sleep,
          task: async () => {
            return fetchInlineSummaryResult({
              botInputUser,
              bundle,
              community,
              deps,
              peerOverride: envOptions.peerOverride,
            });
          },
        });
      } catch (error) {
        recordCommunityFailure({
          context: {
            chatId: community.chatId,
            communityId: community.id,
            scope: "inline_query",
          },
          error,
          errors,
          stats,
        });
        continue;
      }

      try {
        await deps.runWithRetry({
          baseDelayMs: RETRY_BASE_DELAY_MS,
          isRetryable: isTransientError,
          maxAttempts: RETRY_MAX_ATTEMPTS,
          onRetry: createRetryLogger({
            deps,
            label: `sending inline summary for community ${community.id}`,
            stats,
          }),
          sleepFn: deps.sleep,
          task: async () => {
            await sendInlineSummaryResult({
              bundle,
              destinationPeer: inlineResult.destinationPeer,
              queryId: inlineResult.queryId,
              resultId: inlineResult.resultId,
              randomId: deps.createRandomId(),
            });
          },
        });
      } catch (error) {
        recordCommunityFailure({
          context: {
            chatId: community.chatId,
            communityId: community.id,
            scope: "delivery",
          },
          error,
          errors,
          stats,
        });
        continue;
      }

      stats.deliverySucceeded += 1;
    }

    const result = { errors, stats };
    deps.logger.info("[userbot] summary:publish:once completed", result);
    return result;
  } finally {
    await destroyBundle(bundle, deps.logger, "summary_publish_once");
  }
}

export async function runSummaryPublishOnceCli(
  overrides: Partial<SummaryPublishOnceDeps> = {}
): Promise<number> {
  const logger = overrides.logger ?? console;

  try {
    const options = parseSummaryPublishOnceCliOptions(process.argv);
    const result = await runSummaryPublishOnce(overrides, options);
    return result.stats.errors > 0 ? 1 : 0;
  } catch (error) {
    logger.error("[userbot] summary:publish:once failed", error);
    return 1;
  }
}

if (isDirectExecution("summary-publish-once.ts")) {
  process.exit(await runSummaryPublishOnceCli());
}
