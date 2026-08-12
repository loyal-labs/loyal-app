import { TelegramClient } from "@mtcute/bun";

import type { UserbotConfig } from "./env";
import { loadUserbotConfig } from "./env";
import { ensureStorageReady, resolveSessionSqlitePath } from "./storage";

export type UserbotClientBundle = {
  client: TelegramClient;
  config: UserbotConfig;
  sessionPath: string;
};

export async function createUserbotClient(
  config: UserbotConfig = loadUserbotConfig()
): Promise<UserbotClientBundle> {
  await ensureStorageReady(config.storageDir);

  const sessionPath = resolveSessionSqlitePath(
    config.accountKey,
    config.storageDir
  );

  const client = new TelegramClient({
    apiHash: config.apiHash,
    apiId: config.apiId,
    storage: sessionPath,
  });

  return {
    client,
    config,
    sessionPath,
  };
}
