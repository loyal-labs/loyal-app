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

describe("feature flags schema", () => {
  it("exports the new tables with stable names", () => {
    expect(getDrizzleName(featureRegistry)).toBe("feature_registry");
    expect(getDrizzleName(featureAppStatuses)).toBe("feature_app_statuses");
    expect(getDrizzleName(featureEvidence)).toBe("feature_evidence");
    expect(getDrizzleName(runtimeFlags)).toBe("runtime_flags");
    expect(getDrizzleName(featureFlagLinks)).toBe("feature_flag_links");
  });
});
