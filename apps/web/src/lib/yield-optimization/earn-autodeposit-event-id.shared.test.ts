import { describe, expect, test } from "bun:test";

import {
  APP_AUTODEPOSIT_EVENT_TARGET_ID_MAX,
  createBootstrapWalletBalanceEventId,
  isAppAutodepositBootstrapEventSource,
} from "./earn-autodeposit-event-id.shared";

describe("createBootstrapWalletBalanceEventId", () => {
  test("keeps App bootstrap events inside their reserved range", () => {
    expect(createBootstrapWalletBalanceEventId(BigInt(1))).toBe(BigInt(-1));
    expect(
      createBootstrapWalletBalanceEventId(
        APP_AUTODEPOSIT_EVENT_TARGET_ID_MAX
      )
    ).toBe(-APP_AUTODEPOSIT_EVENT_TARGET_ID_MAX);
  });

  test("recognizes bootstrap sources used by current and legacy mobile APIs", () => {
    expect(
      isAppAutodepositBootstrapEventSource(
        "mobile_autodeposit_artifact_reconcile"
      )
    ).toBe(true);
    expect(
      isAppAutodepositBootstrapEventSource(
        "laserstream_autodeposit_activation"
      )
    ).toBe(false);
  });

  test("rejects target IDs outside the reserved range", () => {
    expect(() => createBootstrapWalletBalanceEventId(BigInt(0))).toThrow(
      "outside the reserved App event ID range"
    );
    expect(() =>
      createBootstrapWalletBalanceEventId(
        APP_AUTODEPOSIT_EVENT_TARGET_ID_MAX + BigInt(1)
      )
    ).toThrow("outside the reserved App event ID range");
  });
});
