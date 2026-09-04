import "server-only";

import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";

import { getOrCreateCurrentUser } from "./app-user";
import {
  openOrCreateChat,
  type OpenOrCreateChatInput,
  recordSubmittedUserMessage,
  type RecordUserMessageInput,
} from "./chat-persistence";

type PrepareChatTurnInput = {
  principal: AuthenticatedPrincipal;
  clientChatId: OpenOrCreateChatInput["clientChatId"];
  clientMessageId: RecordUserMessageInput["clientMessageId"];
  firstPrompt: string;
  model: string;
  turnId: string;
};

export async function prepareChatTurn(input: PrepareChatTurnInput): Promise<{
  chatId: string;
  chatWasCreated: boolean;
  userId: string;
  turnId: string;
}> {
  const user = await getOrCreateCurrentUser(input.principal);
  const chat = await openOrCreateChat({
    userId: user.id,
    clientChatId: input.clientChatId,
    firstPrompt: input.firstPrompt,
    model: input.model,
  });

  await recordSubmittedUserMessage({
    chatId: chat.id,
    content: input.firstPrompt,
    turnId: input.turnId,
    clientMessageId: input.clientMessageId,
  });

  return {
    chatId: chat.id,
    chatWasCreated: chat.created,
    userId: user.id,
    turnId: input.turnId,
  };
}
