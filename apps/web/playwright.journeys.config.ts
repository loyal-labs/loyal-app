import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "journeys.spec.ts",
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4317",
    browserName: "chromium",
    launchOptions: process.env.JOURNEY_CHROMIUM_PATH
      ? { executablePath: process.env.JOURNEY_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: "bun e2e/fixtures/server.ts",
    url: "http://127.0.0.1:4317",
    reuseExistingServer: false,
  },
});
