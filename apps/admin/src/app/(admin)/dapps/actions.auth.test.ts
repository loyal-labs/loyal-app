import { beforeEach, expect, mock, test } from "bun:test";

import { AdminAuthenticationError } from "@/lib/admin-auth";

let databaseTouched = false;

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
mock.module("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));
mock.module("@/lib/core/database", () => ({
  getDatabase: () => {
    databaseTouched = true;
    throw new Error("Database access must not occur without an admin session");
  },
}));

const { addTrustedDapp } = await import("./actions");

beforeEach(() => {
  databaseTouched = false;
});

test("rejects an unauthenticated trusted dApp action before database access", async () => {
  const formData = new FormData();
  formData.set("origin", "https://attacker.example");
  formData.set("startUrl", "https://attacker.example/connect");
  formData.set("name", "Loyal Rewards");
  formData.set("isActive", "on");

  await expect(addTrustedDapp(formData)).rejects.toBeInstanceOf(
    AdminAuthenticationError
  );
  expect(databaseTouched).toBe(false);
});
