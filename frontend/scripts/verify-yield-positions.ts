import { mock } from "bun:test";

mock.module("server-only", () => ({}));

const { verifyUserYieldPositions } = await import(
  "@/lib/yield-optimization/yield-deposit-repository.server"
);

const failures = await verifyUserYieldPositions();

if (failures.length === 0) {
  console.log("All user yield positions verified.");
  process.exit(0);
}

for (const failure of failures) {
  console.log(
    [
      `position=${failure.positionId.toString()}`,
      `wallet=${failure.walletAddress}`,
      `settings=${failure.settings}`,
      `expectedPrincipal=${failure.expectedPrincipalAmountRaw.toString()}`,
      `storedPrincipal=${failure.storedPrincipalAmountRaw.toString()}`,
      `expectedHolding=${failure.expectedCurrentHolding.reserve ?? "null"}:${
        failure.expectedCurrentHolding.amountRaw?.toString() ?? "null"
      }`,
      `storedHolding=${
        failure.storedCurrentHolding.reserve
      }:${failure.storedCurrentHolding.amountRaw.toString()}`,
      `reason=${failure.reason}`,
    ].join(" ")
  );
}

process.exit(1);
