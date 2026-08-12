import { getBot } from "./bot";

export const checkChatParticipation = async (
  chatUsername: string,
  userId: number
): Promise<boolean> => {
  const bot = await getBot();
  const chat = await bot.api.getChatMember(chatUsername, userId);

  const present = chat.status !== "left" && chat.status !== "kicked";

  return present;
};
