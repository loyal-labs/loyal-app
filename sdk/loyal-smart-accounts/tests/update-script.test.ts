import { describe, expect, it } from "bun:test";
import rawIdl from "../../loyal-smart-accounts-core/upstream/raw/squads_smart_account_program.json";
import {
  normalizeSmartAccountIdl,
  parseProgramIdFromLibRs,
  parseProgramIdFromSolitaConfig,
  validateIdlSurface,
} from "../../../scripts/update-loyal-smart-accounts";
import { findOperationCoverageIssues } from "../../loyal-smart-accounts-core/src/spec";

describe("update script helpers", () => {
  it("normalizes the current upstream snapshot without dropping required surface", () => {
    const normalized = normalizeSmartAccountIdl(rawIdl);

    expect(normalized).toHaveProperty("instructions");
    validateIdlSurface(normalized);
  });

  it("transforms SmallVec references into bytes", () => {
    const normalized = normalizeSmartAccountIdl({
      types: [{ name: "Example", type: { defined: "SmallVec<u16,u8>" } }],
    });

    expect(normalized as any).toEqual({
      types: [{ name: "Example", type: "bytes" }],
    });
  });

  it("parses program ids from upstream source snippets", () => {
    expect(parseProgramIdFromLibRs('declare_id!("abc123");')).toBe("abc123");
    expect(parseProgramIdFromSolitaConfig('programId: "xyz789"')).toBe("xyz789");
  });

  it("validates operation coverage through the canonical registry", () => {
    expect(findOperationCoverageIssues()).toEqual({
      missingMappings: [],
      duplicateExports: [],
    });
  });
});
