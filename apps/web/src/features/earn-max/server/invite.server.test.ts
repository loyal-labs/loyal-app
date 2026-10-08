import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

mock.module("server-only", () => ({}));

// Opt-in: needs a disposable Postgres (APP_LOCAL_DATABASE_URL). Guards the
// one-time and one-per-wallet invariants that only the unique indexes enforce.
const url = process.env.EARN_MAX_INVITE_TEST_DATABASE_URL;
const run = url ? describe : describe.skip;

const MIGRATION = join(
  import.meta.dir,
  "../../../../../telegram/drizzle/0031_earn_max_invite_redemptions.sql"
);

run("redeemInvite", () => {
  let invite: typeof import("./invite.server");

  beforeAll(async () => {
    const sql = postgres(url!, { max: 1, onnotice: () => undefined });
    await sql.unsafe("DROP TABLE IF EXISTS earn_max_invite_redemptions");
    for (const statement of readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint")) {
      await sql.unsafe(statement);
    }
    await sql.end();
    process.env.APP_LOCAL_DATABASE_URL = url;
    invite = await import("./invite.server");
    process.env.EARN_MAX_INVITE_CODE_HASHES = ["QXB67Y", "AAAAA1"]
      .map(invite.hashInviteCode)
      .join(",");
  });

  test("a code works once, per wallet, and invalid codes write nothing", async () => {
    const a = { settingsPda: "settings-a", walletAddress: "wallet-a" };
    const b = { settingsPda: "settings-b", walletAddress: "wallet-b" };

    expect(await invite.redeemInvite({ ...a, code: "ZZZZZZ" })).toBe("invalid_code");
    expect(await invite.hasRedeemedInvite("wallet-a")).toBe(false);

    expect(await invite.redeemInvite({ ...a, code: " qxb67y " })).toBe("redeemed");
    expect(await invite.redeemInvite({ ...a, code: "QXB67Y" })).toBe("already_redeemed");
    expect(await invite.redeemInvite({ ...b, code: "QXB67Y" })).toBe("code_used");
    expect(await invite.hasRedeemedInvite("wallet-b")).toBe(false);

    // A wallet that already redeemed cannot burn a second code.
    expect(await invite.redeemInvite({ ...a, code: "AAAAA1" })).toBe("already_redeemed");
    expect(await invite.redeemInvite({ ...b, code: "AAAAA1" })).toBe("redeemed");
  });
});
