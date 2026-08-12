import { desc, eq } from "drizzle-orm";
import { appChats } from "@loyal-labs/db-core/schema";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";
import {
  isAuthGatewayError,
  resolveAuthenticatedPrincipalFromRequest,
} from "@/features/identity/server/auth-session";
import { LOCAL_DEV_PRINCIPAL } from "@/features/identity/server/local-dev-principal";
import { getServerEnv } from "@/lib/core/config/server";
import { getDatabase } from "@/lib/core/database";

const MAX_CHATS = 50;

export async function GET(req: Request) {
  const { appEnvironment } = getServerEnv();
  const isLocal = appEnvironment === "local";

  let principal: AuthenticatedPrincipal | null = null;

  try {
    principal = await resolveAuthenticatedPrincipalFromRequest(req);
  } catch (error) {
    if (!isLocal) {
      if (isAuthGatewayError(error)) {
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status }
        );
      }
      throw error;
    }
  }

  if (!principal && isLocal) {
    principal = LOCAL_DEV_PRINCIPAL;
  }

  if (!principal) {
    return Response.json({ chats: [] });
  }

  const user = await getOrCreateCurrentUser(principal);
  const db = getDatabase();

  const chats = await db
    .select({
      id: appChats.id,
      clientChatId: appChats.clientChatId,
      title: appChats.title,
      lastMessageAt: appChats.lastMessageAt,
    })
    .from(appChats)
    .where(eq(appChats.userId, user.id))
    .orderBy(desc(appChats.lastMessageAt))
    .limit(MAX_CHATS);

  return Response.json({
    chats: chats.map((chat) => ({
      id: chat.id,
      clientChatId: chat.clientChatId,
      title: chat.title,
      lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
    })),
  });
}
