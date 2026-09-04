import { afterEach, describe, expect, test } from "bun:test";

import {
  AdminAuthenticationError,
  createSessionPayload,
  getSafeNextPath,
  isSafeNextPath,
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

describe("admin next path validation", () => {
  test("keeps valid internal next paths", () => {
    expect(
      getSafeNextPath(
        "/communities?page=2#latest",
        "https://admin.example/login"
      )
    ).toBe("/communities?page=2#latest");
    expect(isSafeNextPath("/overview", "https://admin.example/login")).toBe(
      true
    );
  });

  test("rejects external or browser-normalized next paths", () => {
    const encodedBackslashPath = new URL(
      "https://admin.example/login?next=/%5C%5Cattacker.example/"
    ).searchParams.get("next");
    const unsafePaths = [
      "https://attacker.example/",
      "//attacker.example/",
      "/\\attacker.example/",
      "/\\\\attacker.example/",
      "/\t/attacker.example/",
      "///attacker.example/",
      "dashboard",
      encodedBackslashPath,
    ];

    for (const unsafePath of unsafePaths) {
      expect(getSafeNextPath(unsafePath, "https://admin.example/login")).toBe(
        null
      );
      expect(isSafeNextPath(unsafePath, "https://admin.example/login")).toBe(
        false
      );
    }
  });
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
