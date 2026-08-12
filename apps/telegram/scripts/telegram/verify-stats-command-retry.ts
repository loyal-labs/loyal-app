import type { Bot, CommandContext, Context } from "grammy";

import {
  handleStatsCommand,
  type StatsCommandDependencies,
} from "../../src/lib/telegram/bot-api/commands";

const LOYAL_CHAT_ID = -1002981429221;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createContext(
  updateId: number,
  chatId: number = LOYAL_CHAT_ID
): CommandContext<Context> {
  return {
    chat: {
      id: chatId,
      type: chatId === LOYAL_CHAT_ID ? "supergroup" : "private",
    },
    from: { first_name: "Verifier", id: 42 },
    update: { update_id: updateId },
  } as unknown as CommandContext<Context>;
}

function createHarness(options?: { snapshotError?: Error }) {
  const claimedUpdateIds = new Set<number>();
  const events: string[] = [];
  const sentTexts: string[] = [];

  const dependencies: StatsCommandDependencies = {
    claimCommand: async ({ updateId }) => {
      events.push(`claim:${updateId}`);
      if (claimedUpdateIds.has(updateId)) {
        return false;
      }
      claimedUpdateIds.add(updateId);
      return true;
    },
    completeCommand: async ({ status, updateId }) => {
      events.push(`complete:${updateId}:${status}`);
    },
    loadSnapshot: async () => {
      events.push("load");
      if (options?.snapshotError) {
        throw options.snapshotError;
      }
      return {
        ageMs: 250,
        refreshedAt: new Date("2026-07-19T00:00:00.000Z"),
        stats: {
          totalAumRaw: BigInt(100),
          totalOptimizedVolumeRaw: BigInt(200),
          totalUsers: 3,
        },
      };
    },
    now: Date.now,
  };

  const bot = {
    api: {
      sendMessage: async (_chatId: number, text: string) => {
        events.push("send");
        sentTexts.push(text);
        return { message_id: sentTexts.length };
      },
    },
  } as unknown as Bot;

  return { bot, dependencies, events, sentTexts };
}

function count(events: string[], value: string): number {
  return events.filter((event) => event === value).length;
}

async function verifyRetryContract(): Promise<void> {
  const harness = createHarness();
  const duplicateContext = createContext(777);

  await Promise.all([
    handleStatsCommand(duplicateContext, harness.bot, harness.dependencies),
    handleStatsCommand(duplicateContext, harness.bot, harness.dependencies),
  ]);

  assert(count(harness.events, "load") === 1, "duplicate update loaded twice");
  assert(count(harness.events, "send") === 1, "duplicate update sent twice");
  assert(
    harness.events.indexOf("claim:777") < harness.events.indexOf("load"),
    "claim did not happen before load"
  );
  assert(
    harness.events.indexOf("load") < harness.events.indexOf("send"),
    "load did not happen before send"
  );

  await handleStatsCommand(
    createContext(778),
    harness.bot,
    harness.dependencies
  );
  assert(count(harness.events, "load") === 2, "new update did not load");
  assert(count(harness.events, "send") === 2, "new update did not send");

  const nonLoyalHarness = createHarness();
  await handleStatsCommand(
    createContext(779, 12345),
    nonLoyalHarness.bot,
    nonLoyalHarness.dependencies
  );
  assert(
    nonLoyalHarness.events.length === 0,
    "non-Loyal chat had side effects"
  );

  const staleHarness = createHarness({
    snapshotError: new Error("Loyal stats snapshot is stale"),
  });
  const staleDuplicateContext = createContext(780);
  await Promise.all([
    handleStatsCommand(
      staleDuplicateContext,
      staleHarness.bot,
      staleHarness.dependencies
    ),
    handleStatsCommand(
      staleDuplicateContext,
      staleHarness.bot,
      staleHarness.dependencies
    ),
  ]);
  assert(count(staleHarness.events, "load") === 1, "stale retry loaded twice");
  assert(count(staleHarness.events, "send") === 1, "stale retry sent twice");
  assert(
    staleHarness.sentTexts[0] ===
      "Loyal stats are unavailable right now. Please try again shortly.",
    "stale snapshot did not send the bounded failure response"
  );

  console.info(
    JSON.stringify({
      differentUpdateSends: 1,
      duplicateSends: 1,
      nonLoyalSideEffects: 0,
      staleFailureSends: 1,
    })
  );
}

await verifyRetryContract();
