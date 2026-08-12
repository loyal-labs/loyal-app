import { describe, expect, it } from "bun:test";
import {
  SolanaTransactionLogError,
  translateAndThrowAnchorError,
} from "../src/errors";

function translate(logs: string[]) {
  translateAndThrowAnchorError(
    Object.assign(new Error("Simulation failed"), { logs })
  );
}

describe("error translation", () => {
  it("surfaces insufficient lamports from System Program logs", () => {
    const logs = [
      "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG invoke [1]",
      "Program log: Instruction: CreateProposal",
      "Program 11111111111111111111111111111111 invoke [2]",
      "Transfer: insufficient lamports 236920, need 2268960",
      "Program 11111111111111111111111111111111 failed: custom program error: 0x1",
      "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG failed: custom program error: 0x1",
    ];

    try {
      translate(logs);
      throw new Error("expected translateAndThrowAnchorError to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SolanaTransactionLogError);
      expect((error as Error).message).toContain("Insufficient SOL");
      expect((error as Error).message).toContain("0.00023692 SOL");
      expect((error as Error).message).toContain("0.00226896 SOL");
      expect((error as Error).message).not.toContain("already initialized");
      expect((error as SolanaTransactionLogError).logs).toEqual(logs);
    }
  });

  it("does not map System Program custom error 0x1 to token-lending errors", () => {
    const logs = [
      "Program 11111111111111111111111111111111 invoke [2]",
      "Program 11111111111111111111111111111111 failed: custom program error: 0x1",
    ];

    try {
      translate(logs);
      throw new Error("expected translateAndThrowAnchorError to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SolanaTransactionLogError);
      expect((error as Error).message).toContain("System Program failed");
      expect((error as Error).message).toContain("custom program error: 0x1");
      expect((error as Error).message).not.toContain("already initialized");
    }
  });

  it("still translates smart-account custom errors through the generated IDL map", () => {
    try {
      translate([
        "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG invoke [1]",
        "Program log: Instruction: CreateProposal",
        "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG failed: custom program error: 0x177a",
      ]);
      throw new Error("expected translateAndThrowAnchorError to throw");
    } catch (error) {
      expect((error as Error).name).toBe("InvalidTransactionIndex");
      expect((error as Error).message).toContain("Invalid transaction index");
    }
  });
});
