import { describe, expect, test } from "bun:test";

import { createPublicEnv } from "./public";

describe("captcha public config", () => {
  test("disables captcha only for explicitly configured local development", () => {
    expect(
      createPublicEnv({
        ALLOW_LOCAL_CAPTCHA_BYPASS: "1",
        CAP_SECRET: "configured",
        NEXT_PUBLIC_APP_ENVIRONMENT: "local",
        NODE_ENV: "development",
      }).captcha
    ).toEqual({ mode: "disabled" });
  });

  test.each([
    [
      "missing explicit flag",
      {
        CAP_SECRET: "configured",
        NEXT_PUBLIC_APP_ENVIRONMENT: "local",
        NODE_ENV: "development",
      },
    ],
    [
      "production runtime",
      {
        ALLOW_LOCAL_CAPTCHA_BYPASS: "1",
        CAP_SECRET: "configured",
        NEXT_PUBLIC_APP_ENVIRONMENT: "local",
        NODE_ENV: "production",
      },
    ],
    [
      "deployed app environment",
      {
        ALLOW_LOCAL_CAPTCHA_BYPASS: "1",
        CAP_SECRET: "configured",
        NEXT_PUBLIC_APP_ENVIRONMENT: "dev",
        NODE_ENV: "development",
      },
    ],
  ])("uses the widget with %s", (_label, env) => {
    expect(createPublicEnv(env).captcha).toEqual({ mode: "widget" });
  });

  test("reports a missing deployed secret as misconfigured", () => {
    expect(
      createPublicEnv({ NEXT_PUBLIC_APP_ENVIRONMENT: "prod" }).captcha
    ).toEqual({
      mode: "misconfigured",
      reason: "The Cap captcha is enabled for prod, but CAP_SECRET is not set.",
    });
  });
});
