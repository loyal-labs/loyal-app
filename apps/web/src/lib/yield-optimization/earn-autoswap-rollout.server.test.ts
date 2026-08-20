import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const WALLET_A = "11111111111111111111111111111111";
const WALLET_B = "So11111111111111111111111111111111111111112";

describe("Autoswap enrollment rollout", () => {
  test("fails closed when the allowlist is absent", async () => {
    const { isEarnAutoswapEnrollmentEnabled } = await import(
      "./earn-autoswap-rollout.server"
    );

    expect(isEarnAutoswapEnrollmentEnabled(WALLET_A, {})).toBe(false);
  });

  test("allows only explicitly listed wallets", async () => {
    const { isEarnAutoswapEnrollmentEnabled } = await import(
      "./earn-autoswap-rollout.server"
    );
    const env = { EARN_AUTOSWAP_ENABLED_WALLETS: WALLET_A };

    expect(isEarnAutoswapEnrollmentEnabled(WALLET_A, env)).toBe(true);
    expect(isEarnAutoswapEnrollmentEnabled(WALLET_B, env)).toBe(false);
  });

  test("wildcard opens enrollment to every wallet", async () => {
    const { isEarnAutoswapEnrollmentEnabled } = await import(
      "./earn-autoswap-rollout.server"
    );
    const env = { EARN_AUTOSWAP_ENABLED_WALLETS: "*" };

    expect(isEarnAutoswapEnrollmentEnabled(WALLET_A, env)).toBe(true);
    expect(isEarnAutoswapEnrollmentEnabled(WALLET_B, env)).toBe(true);
    expect(
      isEarnAutoswapEnrollmentEnabled(WALLET_A, {
        EARN_AUTOSWAP_ENABLED_WALLETS: " * ",
      })
    ).toBe(true);
    expect(() =>
      isEarnAutoswapEnrollmentEnabled(WALLET_A, {
        EARN_AUTOSWAP_ENABLED_WALLETS: `*,${WALLET_A}`,
      })
    ).toThrow("invalid wallet");
  });

  test("rejects ambiguous or invalid configuration", async () => {
    const { isEarnAutoswapEnrollmentEnabled } = await import(
      "./earn-autoswap-rollout.server"
    );

    expect(() =>
      isEarnAutoswapEnrollmentEnabled(WALLET_A, {
        EARN_AUTOSWAP_ENABLED_WALLETS: `${WALLET_A},${WALLET_A}`,
      })
    ).toThrow("duplicate wallet");
    expect(() =>
      isEarnAutoswapEnrollmentEnabled(WALLET_A, {
        EARN_AUTOSWAP_ENABLED_WALLETS: "not-a-wallet",
      })
    ).toThrow("invalid wallet");
  });
});
