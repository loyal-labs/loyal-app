export type EarnCrossMintPolicyShard = "classic" | "token_2022";

export type EarnCrossMintProjectedPolicy = {
  account: string;
  dailySourceMintSpendingCap: string;
  delegatedSigner: string;
  lastSeenSignature: string;
  lastSeenSlot: string;
  maxSlippageBps: number;
  seed: string;
  sourceCommitment: "confirmed" | "finalized";
  sourceShard: EarnCrossMintPolicyShard;
};

export type EarnCrossMintPolicyIndex = {
  policies: EarnCrossMintProjectedPolicy[];
  state: "ambiguous" | "complete" | "empty" | "partial";
};

export type EarnCrossMintPolicyProjectionRow = {
  active: boolean;
  dailySourceMintSpendingCap: bigint | null;
  delegatedSigner: string | null;
  lastMutation: string;
  lastSeenSignature: string;
  lastSeenSlot: bigint;
  maxSlippageBps: number | null;
  policyAccount: string;
  policySeed: bigint | null;
  sourceCommitment: string;
  sourceShard: string | null;
  startEligible: boolean;
};

const isPolicyShard = (
  value: string | null
): value is EarnCrossMintPolicyShard =>
  value === "classic" || value === "token_2022";

const isSupportedCommitment = (
  value: string
): value is EarnCrossMintProjectedPolicy["sourceCommitment"] =>
  value === "confirmed" || value === "finalized";

export function deriveEarnCrossMintPolicyIndex(
  rows: readonly EarnCrossMintPolicyProjectionRow[]
): EarnCrossMintPolicyIndex {
  const activeRows = rows.filter(
    (row) =>
      row.active &&
      (row.lastMutation === "create" || row.lastMutation === "update")
  );
  if (activeRows.length === 0) {
    return { policies: [], state: "empty" };
  }

  const candidates: EarnCrossMintProjectedPolicy[] = [];
  for (const row of activeRows) {
    if (
      !row.startEligible ||
      !isPolicyShard(row.sourceShard) ||
      !isSupportedCommitment(row.sourceCommitment) ||
      row.policySeed === null ||
      row.maxSlippageBps === null ||
      row.dailySourceMintSpendingCap === null ||
      !row.delegatedSigner
    ) {
      return { policies: [], state: "ambiguous" };
    }
    candidates.push({
      account: row.policyAccount,
      dailySourceMintSpendingCap: row.dailySourceMintSpendingCap.toString(),
      delegatedSigner: row.delegatedSigner,
      lastSeenSignature: row.lastSeenSignature,
      lastSeenSlot: row.lastSeenSlot.toString(),
      maxSlippageBps: row.maxSlippageBps,
      seed: row.policySeed.toString(),
      sourceCommitment: row.sourceCommitment,
      sourceShard: row.sourceShard,
    });
  }

  const accounts = new Set(candidates.map((candidate) => candidate.account));
  const seeds = new Set(candidates.map((candidate) => candidate.seed));
  const shards = new Set(candidates.map((candidate) => candidate.sourceShard));
  const [first] = candidates;
  if (!first) {
    return { policies: [], state: "ambiguous" };
  }
  const parametersMatch = candidates.every(
    (candidate) =>
      candidate.delegatedSigner === first.delegatedSigner &&
      candidate.maxSlippageBps === first.maxSlippageBps &&
      candidate.dailySourceMintSpendingCap === first.dailySourceMintSpendingCap
  );
  if (
    candidates.length > 2 ||
    accounts.size !== candidates.length ||
    seeds.size !== candidates.length ||
    shards.size !== candidates.length ||
    !parametersMatch
  ) {
    return { policies: [], state: "ambiguous" };
  }

  candidates.sort((left) => (left.sourceShard === "classic" ? -1 : 1));
  return {
    policies: candidates,
    state: candidates.length === 2 ? "complete" : "partial",
  };
}
