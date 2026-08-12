import { communities } from "@loyal-labs/db-core/schema";
import { and, eq, type SQL } from "drizzle-orm";

type CommunityRecord =
  | {
      id: string;
      parserType: "bot" | "userbot";
    }
  | null
  | undefined;

type CommunityQueryDb = {
  query: {
    communities: {
      findFirst: (args: {
        columns: {
          id: true;
          parserType: true;
        };
        where?: SQL<unknown>;
      }) => Promise<CommunityRecord>;
    };
  };
};

function findActiveCommunity(
  db: CommunityQueryDb,
  where: SQL<unknown> | undefined
): Promise<CommunityRecord> {
  return db.query.communities.findFirst({
    columns: {
      id: true,
      parserType: true,
    },
    where,
  });
}

// Backward-compatible no-op: active community cache was removed to reduce bug surface.
export function evictActiveCommunityCache(
  _chatId: bigint | number | string
): void {
  // no-op
}

export async function resolveActiveBotCommunityId(
  db: CommunityQueryDb,
  chatId: bigint
): Promise<string | null> {
  const community = await findActiveCommunity(
    db,
    and(
      eq(communities.chatId, chatId),
      eq(communities.isActive, true),
      eq(communities.parserType, "bot")
    )
  );

  if (!community || community.parserType !== "bot") {
    return null;
  }

  return community.id;
}
