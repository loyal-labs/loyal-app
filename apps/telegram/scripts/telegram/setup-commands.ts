import { getBot } from "@/lib/telegram/bot-api/bot";
import { registerBotCommands } from "@/lib/telegram/bot-api/register-commands";

export async function runSetupCommands(): Promise<void> {
  const bot = await getBot();
  await registerBotCommands(bot);
}

export async function runSetupCommandsCli(): Promise<number> {
  try {
    await runSetupCommands();
    console.info("Telegram bot commands registered successfully.");
    return 0;
  } catch (error) {
    console.error("Failed to register Telegram bot commands.", error);
    return 1;
  }
}

function isDirectExecution(scriptName: string): boolean {
  const entrypoint = process.argv[1];
  return typeof entrypoint === "string" && entrypoint.endsWith(scriptName);
}

if (isDirectExecution("setup-commands.ts")) {
  process.exit(await runSetupCommandsCli());
}
