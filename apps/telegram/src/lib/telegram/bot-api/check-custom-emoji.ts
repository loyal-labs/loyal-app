import { CUSTOM_EMOJI_ID } from "./constants";
import { getChat } from "./get-chat";

export const hasCustomEmoji = async (chatId: number): Promise<boolean> => {
  const chat = await getChat(chatId);
  return chat.emoji_status_custom_emoji_id === CUSTOM_EMOJI_ID;
};
