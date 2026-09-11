import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { findUserFacingEarnPosition } = await import(
  "./earn-position-read.server"
);
type Dependencies = NonNullable<
  Parameters<typeof findUserFacingEarnPosition>[1]
>;
const input = {
  cluster: "mainnet-beta",
  settings: "settings",
  vaultIndex: 1,
  walletAddress: "wallet",
};
const position = {
  currentObservedSlot: BigInt(500),
  vaultPubkey: "vault",
} as NonNullable<Awaited<ReturnType<Dependencies["findPosition"]>>>;
const closedState = {
  vault: { active: false },
  routePolicy: { active: false },
} as NonNullable<Awaited<ReturnType<Dependencies["findCleanupState"]>>>;

function fixture() {
  const verifyClosedPosition = mock<Dependencies["verifyClosedPosition"]>(
    async () => BigInt(600)
  );
  const dependencies: Dependencies = {
    findPosition: async () => position,
    resolveVaultPubkey: () => "vault",
    hasInactivePolicy: async () => true,
    findCleanupState: async () => closedState,
    verifyClosedPosition,
  };
  return { dependencies, verifyClosedPosition };
}

describe("user-facing Earn position after cleanup", () => {
  test("returns a slot-fenced closure only after proof", async () => {
    const { dependencies, verifyClosedPosition } = fixture();
    const result = await findUserFacingEarnPosition(input, dependencies);
    expect(result.position).toBeNull();
    expect(result.closedPositionObservedSlot).toBe("600");
    // Proof cannot read an older slot than the displayed position.
    expect(verifyClosedPosition.mock.calls[0]?.[2]).toBe(
      position.currentObservedSlot
    );
  });

  test("still proves closure after the worker closes the database position", async () => {
    const { dependencies } = fixture();
    dependencies.findPosition = async () => null;
    const result = await findUserFacingEarnPosition(input, dependencies);
    expect(result.position).toBeNull();
    expect(result.closedPositionObservedSlot).toBe("600");
  });

  test("preserves funds and emits no closure on incomplete proof or RPC failure", async () => {
    const { dependencies } = fixture();
    for (const message of [
      "balances remain",
      "policy remains open",
      "RPC unavailable",
    ]) {
      dependencies.verifyClosedPosition = async () => {
        throw new Error(message);
      };
      const result = await findUserFacingEarnPosition(input, dependencies);
      expect(result.position).toBe(position);
      expect(result.closedPositionObservedSlot).toBeNull();
    }
  });

  test("active, reactivated, or missing policies cannot close a position", async () => {
    const { dependencies, verifyClosedPosition } = fixture();
    dependencies.hasInactivePolicy = async () => false;
    expect(
      (await findUserFacingEarnPosition(input, dependencies)).position
    ).toBe(position);
    dependencies.hasInactivePolicy = async () => true;
    dependencies.findCleanupState = async () => ({
      ...closedState,
      vault: { ...closedState.vault, active: true },
      routePolicy: { ...closedState.routePolicy, active: true },
    });
    expect(
      (await findUserFacingEarnPosition(input, dependencies)).position
    ).toBe(position);
    dependencies.findCleanupState = async () => null;
    expect(
      (await findUserFacingEarnPosition(input, dependencies)).position
    ).toBe(position);
    expect(verifyClosedPosition).not.toHaveBeenCalled();
  });
});
