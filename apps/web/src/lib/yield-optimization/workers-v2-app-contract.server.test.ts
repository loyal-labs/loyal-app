import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}) as never);

const { isWorkersV2AppReadOnlyEarnGetsEnabled } = await import(
  "./workers-v2-app-contract.server"
);

describe("isWorkersV2AppReadOnlyEarnGetsEnabled", () => {
  test("defaults to legacy behavior when unset or empty", () => {
    for (const env of [{}, { WORKERS_V2_APP_READ_ONLY_GETS: "" }]) {
      expect(isWorkersV2AppReadOnlyEarnGetsEnabled(env)).toBe(false);
    }
  });

  test("legacy stays authoritative for explicit opt-outs", () => {
    for (const value of ["0", "false"]) {
      expect(
        isWorkersV2AppReadOnlyEarnGetsEnabled({
          WORKERS_V2_APP_READ_ONLY_GETS: value,
        })
      ).toBe(false);
    }
  });

  test("opts in to read-only GETs for the v2 spellings", () => {
    for (const value of ["1", "true"]) {
      expect(
        isWorkersV2AppReadOnlyEarnGetsEnabled({
          WORKERS_V2_APP_READ_ONLY_GETS: value,
        })
      ).toBe(true);
    }
  });

  test("fails loudly on any other value instead of picking an authority boundary", () => {
    for (const value of ["yes", "TRUE", "2", " on"]) {
      expect(() =>
        isWorkersV2AppReadOnlyEarnGetsEnabled({
          WORKERS_V2_APP_READ_ONLY_GETS: value,
        })
      ).toThrow("invalid_workers_v2_app_read_only_gets");
    }
  });
});
