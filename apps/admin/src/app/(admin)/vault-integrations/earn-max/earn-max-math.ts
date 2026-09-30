// Pure money math for the Earn MAX page. Kept apart so the test can pin it.

export type LpFlow = {
  /** Unix seconds. */
  blockTime: number;
  /** LP minted (> 0, a deposit) or burned (< 0, a withdrawal) in the tx. */
  lpNet: number;
  /** Raw change of the vault idle USDC account in the same tx. */
  idleDelta: number;
};

/**
 * Whole-vault earned = holders' value now - (deposits - withdrawals) since the
 * vault last had zero LP. Flows are the txs that mint or burn LP; their USDC is
 * the vault idle account's change in that tx (raw, 6 decimals).
 */
export function earnedSinceEmpty(flows: LpFlow[], holdersValueUsd: number) {
  const sorted = flows
    .filter((flow) => flow.lpNet !== 0)
    .sort((a, b) => a.blockTime - b.blockTime);
  let lp = 0;
  let start = 0;
  sorted.forEach((flow, index) => {
    lp += flow.lpNet;
    if (lp === 0) start = index + 1; // the vault was empty after this flow
  });
  const live = sorted.slice(start);
  const deposits =
    live.filter((f) => f.lpNet > 0).reduce((sum, f) => sum + f.idleDelta, 0) /
    1e6;
  const withdrawals =
    -live.filter((f) => f.lpNet < 0).reduce((sum, f) => sum + f.idleDelta, 0) /
    1e6;

  return {
    deposits,
    earned: holdersValueUsd - (deposits - withdrawals),
    flows: live.length,
    since: live.length
      ? new Date(live[0].blockTime * 1000).toISOString()
      : null,
    withdrawals,
  };
}

/**
 * Obligation LTV: collateral actually in Kamino = NAV + debt - cash held in
 * the worker's custody (repay buffer, tokens waiting to be deposited). USD at
 * ~$1 is good enough for a gauge; the worker itself uses oracle prices.
 */
export function loanToValue(
  navUsd: number,
  debtUsd: number,
  custodyUsd: number
) {
  const collateral = navUsd + debtUsd - custodyUsd;
  return collateral > 0 ? debtUsd / collateral : null;
}

const DAY_MS = 86_400_000;

/**
 * Realized APY from the Voltr share price, same rule as the Earn MAX badge:
 * over the last 7 days, or since the first daily point, and only once at
 * least 12 hours have passed. Daily points are end-of-day UTC, today excluded.
 */
export function realizedApy(
  daily: Array<{ day: string; price: number }>,
  priceNow: number,
  nowMs: number
) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const points = daily
    .filter((point) => point.day < today && point.price > 0)
    .map((point) => ({
      price: point.price,
      time: Date.parse(`${point.day}T23:59:59Z`),
    }));
  const start =
    [...points].reverse().find((point) => nowMs - point.time >= 6.5 * DAY_MS) ??
    points[0];
  if (!start || nowMs - start.time < DAY_MS / 2) return null;
  const years = (nowMs - start.time) / (365 * DAY_MS);

  return {
    apy: (priceNow / start.price) ** (1 / years) - 1,
    since: new Date(start.time).toISOString().slice(0, 10),
  };
}
