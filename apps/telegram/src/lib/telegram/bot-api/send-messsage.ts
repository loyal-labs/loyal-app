import { getBot } from "./bot";

export const sendPhotoMessage = async (userId: number, photoUrl: string) => {
  const bot = await getBot();
  await bot.api.sendPhoto(userId, photoUrl);
};
