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

## Pending requests and operator attention

Only one withdrawal receipt can be open for an Earn MAX smart-account vault.
The header, RWA Loop, Positions tab and mobile Withdraw controls are disabled
while it is pending. A hover, keyboard-focus or touch tooltip explains why.
Claim and Check status remain available. The form and fresh plan preparation
also reject duplicate requests, including requests from a stale open form.

The authenticated Voltr summary may include display-only withdrawal health
from the configured Backyard route in Yield Neon. The reader checks version,
route, vault, program, cluster and observation freshness (at most 120 seconds;
future timestamps are rejected). Missing, mismatched or stale evidence is
unavailable, never proof of recovery. Known previous attention is retained when
the stored observation becomes stale. No raw worker error or route state is
sent to the browser. Health does not grant claim or debt-repayment authority.

An operator-attention status shows that vault withdrawals are delayed and the
existing request remains pending. It does not promise an ETA or notification
delivery. Chain-confirmed claim readiness takes priority over worker health.
Automatic full-debt clearing is not enabled by this display change.

Offline money-movement contract checks (no RPC or wallet calls):

```sh
cd apps/web
bun scripts/verify-earn-max-claim-liquidity.ts
```

## Native mobile access

`POST /api/smart-accounts/mobile/earn-max` provides `summary`, `activity`, and
`context` using the existing Voltr readers. Mobile access does not require an
invite. Web access also requires no invite. Authenticate with a mobile Earn
bearer token, a wallet signature scoped to `earn-max`, or the existing Loyal
sign-in cookie matched to the active wallet. The server resolves the canonical
smart account and verifies wallet control before returning private/no-store
data; request account fields cannot select another account. Mainnet is required.
This read-only endpoint does not provision accounts or submit transactions.
The mobile app prepares and signs deposit, withdrawal request, and claim locally.

Verify the auth/ownership/cluster boundaries with
`bun scripts/verify-mobile-earn-max.ts` from `apps/web`.

Mobile display reads use `GET /api/smart-accounts/mobile/earn-max` with
`action=summary|activity` and `walletAddress`, matching ordinary mobile Earn.
These passive reads return public on-chain-derived data without a session or
wallet signature, never provision an account, validate the wallet and canonical
account mapping, and reject transaction-context actions. POST context keeps
its signature/bearer/cookie authentication.

## Web access

Earn MAX is available to every signed-in wallet. Summary and activity still
resolve the authenticated smart account and verify wallet ownership before
reading data. The legacy GET invite endpoint returns `redeemed: true` after
the same authentication checks so older web bundles also unlock. Existing
redemption records and the legacy code-redemption endpoint are retained.
The current UI does not request or render invite codes. Voltr history uses a
256-account LRU cache per server instance; eviction only causes a fresh read.

Verify access and ownership boundaries with
`bun scripts/verify-web-earn-max-access.ts` from `apps/web`.
