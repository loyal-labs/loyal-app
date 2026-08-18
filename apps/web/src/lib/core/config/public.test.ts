import { describe, expect, test } from "bun:test";

import { createPublicEnv } from "./public";

describe("captcha public config", () => {
  test("uses the local bypass even when Cap is configured", () => {
    expect(
      createPublicEnv({
        CAP_SECRET: "configured",
        NEXT_PUBLIC_APP_ENVIRONMENT: "local",
      }).captcha
    ).toEqual({
      mode: "bypass",
      verificationToken: "local-bypass",
    });
  });

  test("uses the widget outside local when Cap is configured", () => {
    expect(
      createPublicEnv({
        CAP_SECRET: "configured",
        NEXT_PUBLIC_APP_ENVIRONMENT: "dev",
      }).captcha
    ).toEqual({ mode: "widget" });
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
