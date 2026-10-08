# Earn MAX claim availability

Loyal reports a Voltr claim as available only after the receipt cooldown has
elapsed and pooled idle USDC covers the full estimated receipt payout.
The idle account is read with the position snapshot and must be a valid,
initialized, unfrozen classic SPL account for the configured asset mint and
idle authority. Missing or invalid liquidity blocks claims. A failed status
refresh clears the old summary rather than leaving a stale claim enabled.

A mature request without enough idle USDC stays pending with
`status: "unwinding"` and `claimBlockedReason: "insufficient_liquidity"`.
This status means liquidity is awaited, not that a worker is making progress.
Unverifiable liquidity uses `claimBlockedReason: "liquidity_unavailable"`.
**Check status** refreshes reads without opening the wallet. There is no ETA.

The client checks liquidity again in `voltrClaimPlan` before constructing a
claim. A liquidity block emits `earn_max_liquidity_unavailable` at `prepare`
with `chainState: "not_submitted"`. Other send errors retain their existing
classification. This guard does not restore liquidity or reserve it; another
claim can consume the pool balance before execution.

Coverage uses the full `pending.payoutRaw`, never existing user USDC or the
smaller post-rounding wallet sweep. The local Voltr SDK 2.1.1
`src/extensions/withdrawals.ts` computes the effective payout as the minimum
of the request quote and current redemption-fee-adjusted assets;
`src/extensions/math.ts` floors that asset redemption. This matches the
existing payout estimate. The existing estimate still ignores unrealised
management-fee LP and assumes those fees remain disabled. Changes in fees,
NAV or time between prepare and execution can still affect the claim.

Offline money-movement contract checks (no RPC or wallet calls):

```sh
cd apps/web
bun scripts/verify-earn-max-claim-liquidity.ts
```
