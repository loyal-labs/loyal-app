import { describe, expect, it } from "bun:test";

import {
  featureAppStatuses,
  featureEvidence,
  featureFlagLinks,
  featureRegistry,
  runtimeFlags,
} from "../schema";

const getDrizzleName = (table: object) =>
  (table as { [key: symbol]: string })[Symbol.for("drizzle:Name")];

const getExtraConfigBuilderSource = (table: object) =>
  String(
    (table as { [key: symbol]: () => unknown })[
      Symbol.for("drizzle:ExtraConfigBuilder")
    ]
  );

describe("feature flags schema", () => {
  it("exports the new tables with stable names", () => {
    expect(getDrizzleName(featureRegistry)).toBe("feature_registry");
    expect(getDrizzleName(featureAppStatuses)).toBe("feature_app_statuses");
    expect(getDrizzleName(featureEvidence)).toBe("feature_evidence");
    expect(getDrizzleName(runtimeFlags)).toBe("runtime_flags");
    expect(getDrizzleName(featureFlagLinks)).toBe("feature_flag_links");
  });

  it("keeps the feature evidence lookup index and runtime flag environment contract", () => {
    const featureEvidenceBuilderSource = getExtraConfigBuilderSource(
      featureEvidence
    );
    expect(featureEvidenceBuilderSource).toContain(
      "feature_evidence_feature_app_status_id_idx"
    );
    expect(featureEvidenceBuilderSource).toContain(
      "feature_evidence_type_check"
    );

    expect(runtimeFlags.targetEnvironments.default).toEqual([
      "development",
      "preview",
      "production",
    ]);
    expect(getExtraConfigBuilderSource(runtimeFlags)).toContain(
      "runtime_flags_target_environments_check"
    );
  });
});
