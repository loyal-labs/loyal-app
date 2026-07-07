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
  const balanceSource = requirements.every(
    (requirement) => requirement.balanceSource === "assumed_sufficient"
  )
    ? "assumed_sufficient"
    : first.balanceSource;
  const balanceLamports =
    balanceSource === "assumed_sufficient"
      ? requiredLamports
      : BigInt(first.balanceLamports);
  const deficitLamports =
    requiredLamports > balanceLamports
      ? requiredLamports - balanceLamports
      : BigInt(0);

  return {
    balanceLamports: balanceLamports.toString(),
    ...(balanceSource ? { balanceSource } : {}),
    canProceed: deficitLamports === BigInt(0),
    deficitLamports: deficitLamports.toString(),
    items,
    payer: first.payer,
    requiredLamports: requiredLamports.toString(),
  };
}
