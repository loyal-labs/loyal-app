import { describe, expect, it } from "bun:test";
import * as sdk from "../index";
import {
  FEATURE_INSTRUCTION_COVERAGE,
  PUBLIC_FEATURE_EXPORTS,
  getOperationsForFeature,
} from "../../loyal-smart-accounts-core/src/spec";
import { findRuntimeBindingIssues } from "../src/operation-registry";

describe("operation registry", () => {
  it("covers the full intended public surface", () => {
    expect(
      Object.keys({
        programConfig: sdk.programConfig,
        smartAccounts: sdk.smartAccounts,
        proposals: sdk.proposals,
        transactions: sdk.transactions,
        batches: sdk.batches,
        policies: sdk.policies,
        spendingLimits: sdk.spendingLimits,
        execution: sdk.execution,
      }).sort()
    ).toEqual([...PUBLIC_FEATURE_EXPORTS].sort());
  });

  it("keeps offline instruction builders and full prepare coverage aligned by feature", () => {
    expect(Object.keys(sdk.programConfig.instructions).sort()).toEqual([
      "initialize",
      "setAuthority",
      "setSmartAccountCreationFee",
      "setTreasury",
    ]);

    expect(Object.keys(sdk.execution.instructions).sort()).toEqual([
      "executePolicyPayloadSync",
      "executePolicyTransaction",
      "executeSettingsTransaction",
      "executeSettingsTransactionSync",
      "executeTransactionSync",
      "executeTransactionSyncV2",
    ]);

    for (const feature of PUBLIC_FEATURE_EXPORTS) {
      expect(getOperationsForFeature(feature).length).toBeGreaterThan(0);
    }

    expect(FEATURE_INSTRUCTION_COVERAGE.execution).toContain("executeTransaction");
    expect(sdk.execution.instructions).not.toHaveProperty("executeTransaction");
    expect(sdk.execution.prepare).toHaveProperty("executeTransaction");
  });

  it("binds every core operation exactly once", () => {
    expect(findRuntimeBindingIssues()).toEqual({
      missingBuilders: [],
      extraBuilders: [],
    });
  });
});
