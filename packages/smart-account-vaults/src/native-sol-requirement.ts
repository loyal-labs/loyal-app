import type { SmartAccountNativeSolRequirement } from "./types";

export function combineSmartAccountNativeSolRequirements(
  requirements: readonly SmartAccountNativeSolRequirement[]
): SmartAccountNativeSolRequirement | null {
  const first = requirements[0];
  if (!first) {
    return null;
  }

  const items = requirements.flatMap((requirement) => requirement.items);
  const requiredLamports = items.reduce(
    (total, item) => total + BigInt(item.lamports),
    BigInt(0)
  );
  const balanceLamports = BigInt(first.balanceLamports);
  const deficitLamports =
    requiredLamports > balanceLamports
      ? requiredLamports - balanceLamports
      : BigInt(0);

  return {
    balanceLamports: balanceLamports.toString(),
    canProceed: deficitLamports === BigInt(0),
    deficitLamports: deficitLamports.toString(),
    items,
    payer: first.payer,
    requiredLamports: requiredLamports.toString(),
  };
}
