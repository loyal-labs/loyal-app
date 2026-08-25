export type ConfirmedAutodepositSetupIdentity = {
  policyAccount: string;
  recurringDelegation: string;
};

export type CanonicalAutodepositSetupProjection = {
  phase: "pending" | "settled";
  policyAccount: string;
  recurringDelegation: string | null;
};

// A confirmed client setup is ahead of the database by design. Keep it while
// the canonical projection is absent or still describes the same pending
// policy. Once reconciliation settles that identity (or reports a different
// one), the canonical state owns the UI again.
export function shouldRetainConfirmedAutodepositSetup(args: {
  canonical: CanonicalAutodepositSetupProjection | null;
  confirmed: ConfirmedAutodepositSetupIdentity;
}): boolean {
  const { canonical, confirmed } = args;
  if (!canonical) {
    return true;
  }
  if (canonical.policyAccount !== confirmed.policyAccount) {
    return false;
  }
  if (
    canonical.recurringDelegation &&
    canonical.recurringDelegation !== confirmed.recurringDelegation
  ) {
    return false;
  }
  return canonical.phase === "pending";
}
