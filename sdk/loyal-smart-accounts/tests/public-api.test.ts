import { describe, expect, it } from "bun:test";
import * as sdk from "../index";
import manifest from "../../loyal-smart-accounts-core/upstream/manifest.json";
import packageJson from "../package.json";

describe("public api", () => {
  it("exports the module namespaces and program constants", () => {
    expect(sdk.PROGRAM_ADDRESS).toBe(manifest.programId);
    expect(sdk.PROGRAM_ID.toBase58()).toBe(manifest.programId);
    expect(typeof sdk.createLoyalSmartAccountsClient).toBe("function");
    expect(typeof sdk.generated).toBe("object");
    expect(typeof sdk.programConfig).toBe("object");
    expect(typeof sdk.smartAccounts).toBe("object");
    expect(typeof sdk.proposals).toBe("object");
    expect(typeof sdk.transactions).toBe("object");
    expect(typeof sdk.batches).toBe("object");
    expect(typeof sdk.policies).toBe("object");
    expect(typeof sdk.spendingLimits).toBe("object");
    expect(typeof sdk.execution).toBe("object");
    expect(typeof sdk.errors).toBe("object");
    expect(typeof sdk.pda).toBe("object");
    expect(typeof sdk.codecs).toBe("object");
  });

  it("keeps the publishable core free of loyal rpc dependencies", () => {
    expect(packageJson.dependencies).not.toHaveProperty("@loyal-labs/solana-rpc");
  });
});
