export type ConfirmedOnchainMutation = {
  identities: readonly string[];
  operation: "install" | "remove";
};

export type CanonicalOnchainProjection = {
  identities: readonly string[];
  phase: "pending" | "settled";
};

function sameIdentities(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const expected = new Set(left);
  return (
    expected.size === left.length && right.every((item) => expected.has(item))
  );
}

// A confirmed transaction may lead the database projection. Keep its local UI
// result only while the canonical read is missing/pending the same install, or
// still contains identities closed by the remove. Settled installs, completed
// removals, and contradictory identities release control to canonical state.
export function shouldRetainConfirmedOnchainMutation(args: {
  canonical: CanonicalOnchainProjection | null;
  confirmed: ConfirmedOnchainMutation;
}): boolean {
  const { canonical, confirmed } = args;
  if (confirmed.identities.length === 0) {
    return false;
  }

  if (confirmed.operation === "install") {
    if (!canonical) {
      return true;
    }
    return (
      canonical.phase === "pending" &&
      sameIdentities(canonical.identities, confirmed.identities)
    );
  }

  if (!canonical || canonical.identities.length === 0) {
    return false;
  }
  const removed = new Set(confirmed.identities);
  return canonical.identities.every((identity) => removed.has(identity));
}
