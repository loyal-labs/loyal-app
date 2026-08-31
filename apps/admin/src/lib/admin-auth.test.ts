import { afterEach, describe, expect, test } from "bun:test";

import {
  AdminAuthenticationError,
  createSessionPayload,
  requireValidAdminSessionToken,
  signSessionToken,
} from "./admin-auth";

const originalAdminPassword = process.env.ADMIN_PASSWORD;

afterEach(() => {
  if (originalAdminPassword === undefined) {
    delete process.env.ADMIN_PASSWORD;
  } else {
    process.env.ADMIN_PASSWORD = originalAdminPassword;
  }
});

describe("admin session authorization", () => {
  test("rejects a missing session before privileged work can proceed", async () => {
    await expect(
      requireValidAdminSessionToken(undefined)
    ).rejects.toBeInstanceOf(AdminAuthenticationError);
  });

  test("accepts a valid signed admin session", async () => {
    process.env.ADMIN_PASSWORD = "local-test-password";
    const payload = createSessionPayload("local-admin");
    const token = await signSessionToken(payload);

    await expect(requireValidAdminSessionToken(token)).resolves.toEqual(
      payload
    );
  });
});
