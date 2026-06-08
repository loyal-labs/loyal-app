import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const TEST_ENV_KEYS = ["TELEGRAM_SETUP_SECRET", "ASKLOYAL_TGBOT_KEY"] as const;
const bot = { api: {} };
const getBot = mock(async () => bot);
const registerBotCommands = mock(async () => {});

mock.module("@/lib/telegram/bot-api/bot", () => ({
  getBot,
}));

mock.module("@/lib/telegram/bot-api/register-commands", () => ({
  registerBotCommands,
}));

function clearTestEnv(): void {
  for (const key of TEST_ENV_KEYS) {
    delete process.env[key];
  }
}

let POST: (request: Request) => Promise<Response>;

describe("setup-commands route auth", () => {
  beforeAll(async () => {
    const loadedModule = await import("./route");
    POST = loadedModule.POST;
  });

  beforeEach(() => {
    clearTestEnv();
    getBot.mockClear();
    registerBotCommands.mockClear();
  });

  afterEach(() => {
    clearTestEnv();
  });

  test("registers bot commands with a valid setup token", async () => {
    process.env.TELEGRAM_SETUP_SECRET = "expected-secret";
    const request = new Request("http://localhost/api/telegram/setup-commands", {
      method: "POST",
      headers: { authorization: "Bearer expected-secret" },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(getBot).toHaveBeenCalledTimes(1);
    expect(registerBotCommands).toHaveBeenCalledWith(bot);
  });

  test("returns 401 when Authorization does not match TELEGRAM_SETUP_SECRET", async () => {
    process.env.TELEGRAM_SETUP_SECRET = "expected-secret";

    const request = new Request("http://localhost/api/telegram/setup-commands", {
      method: "POST",
      headers: { authorization: "Bearer wrong-secret" },
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(registerBotCommands).not.toHaveBeenCalled();
  });
});
