import { and, asc, eq } from "drizzle-orm";
import { appChatMessages, appChats } from "@loyal-labs/db-core/schema";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";
import {
  isAuthGatewayError,
  resolveAuthenticatedPrincipalFromRequest,
} from "@/features/identity/server/auth-session";
import { LOCAL_DEV_PRINCIPAL } from "@/features/identity/server/local-dev-principal";
import { getServerEnv } from "@/lib/core/config/server";
import { getDatabase } from "@/lib/core/database";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params;
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
    return Response.json({ messages: [] });
  }

  const user = await getOrCreateCurrentUser(principal);
  const db = getDatabase();

  // Verify the chat belongs to this user
  const chat = await db.query.appChats.findFirst({
    columns: { id: true },
    where: and(eq(appChats.id, chatId), eq(appChats.userId, user.id)),
  });

  if (!chat) {
    return Response.json(
      { error: { code: "not_found", message: "Chat not found" } },
      { status: 404 }
    );
  }

  const messages = await db
    .select({
      id: appChatMessages.id,
      role: appChatMessages.role,
      content: appChatMessages.content,
      clientMessageId: appChatMessages.clientMessageId,
      createdAt: appChatMessages.createdAt,
    })
    .from(appChatMessages)
    .where(eq(appChatMessages.chatId, chatId))
    .orderBy(asc(appChatMessages.createdAt));

  return Response.json({
    messages: messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      clientMessageId: msg.clientMessageId,
      createdAt: msg.createdAt.toISOString(),
    })),
  });
}
