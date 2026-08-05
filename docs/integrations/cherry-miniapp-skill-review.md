# Cherry integration skill review (ASK-1931)

Review date: 2026-08-03

Upstream: <https://github.com/cherrydotfun/miniapp-sdk/tree/main/skills>

Reviewed commit: `0b06e7f4d183e2e947374af661631181218109a1`

Installed skill: `cherry-miniapp-integration`

The skill was applied to the mobile fullscreen and web iframe slices. The
implementation keeps Loyal's transaction builders, auth proof, RPC submission,
confirmation, and reconciliation; Cherry supplies the embedded wallet and
approvals.

## Applied checklist

| Skill concern  | Loyal implementation                                                                   | Status           |
| -------------- | -------------------------------------------------------------------------------------- | ---------------- |
| Framework      | Next.js client boundary under `/app/cherry`; Vercel is the build gate.                 | Complete         |
| SDK path       | Exact `0.1.21` pin; web3 wallet-adapter entry, no Kit migration.                       | Complete         |
| Detection      | Dedicated route plus explicit mobile or framed-iframe host signals before SDK import. | Complete         |
| Provider       | Route-only provider, automatic Cherry selection, separate wallet preference key.       | Complete         |
| User/room      | Raw token verified server-side; client receives minimum wallet/room/time context.      | Complete locally |
| Wallet UI      | Standalone wallet chooser and disconnect controls hidden only in verified Cherry mode. | Complete locally |
| Signing        | Message, legacy/v0 single, and ordered batch signing retained.                         | Complete locally |
| Submission     | Adapter validates signed bytes, then Loyal submits once through its supplied RPC.      | Complete locally |
| Lifecycle      | Init timeout, suspend/resume unmount/remount, and disconnect fail-closed handling.     | Complete locally |
| Mobile shell   | Device viewport and route-scoped safe areas.                                           | Complete locally |
| Navigation     | No Loyal outcome needs Cherry profile/room navigation.                                 | Deferred         |
| Sharing/blinks | Not required for fullscreen wallet integration.                                        | Deferred         |
| Web iframe     | Framed-entry marker, scoped CSP allowlist, and partitioned auth-cookie support.         | Complete locally |
| Privy auth     | Loyal does not use Privy; existing CAPTCHA plus wallet proof remains.                  | Not applicable   |

## Intentional hardening beyond the generic skill

1. Backend launch-token verification is mandatory. The server checks the SDK's
   RS256/JWKS/app/origin result plus issuer, Solana wallet, room, `jti`,
   issued-at, expiry, and a five-minute maximum lifetime.
2. SDK `0.1.21` declares `strict`, but the built runtime/adapter does not enforce
   it consistently. Loyal therefore performs its own route and native-transport
   gate before importing the SDK.
3. The SDK stock adapter's `sendTransaction` calls host
   `wallet.signAndSendTransaction` and ignores Loyal's connection/options.
   Loyal overrides it with sign, validate, and one `sendRawTransaction` call.
4. The launch token is boot attestation only. It never creates a Loyal session,
   bypasses CAPTCHA, or directly triggers sponsored onboarding.
5. Token values, `jti`, serialized transactions, and signed messages are not
   persisted, echoed, or logged by the Cherry slice.

## Upstream questions before financial activation

- Provide or document bridge response binding to the expected source/origin;
  the current SDK accepts window messages without checking either.
- Fix and regression-test strict host detection in the provider and adapter.
- Confirm devnet, legacy/v0/ALT, partial signatures, batch limits/order,
  sign-only behavior, and stable rejection/timeout/disconnect codes.

## Inputs still required

- Public Cherry group name/URL.
- Stable hosted staging `/app/cherry` URL.
- Staging and production MiniApp IDs and exact registered origins.
- Confirmation of issuer/JWKS and `wallet:connect` permission.
- Cherry mobile staging access with controlled devnet wallets.

The current local verifier and live ladder are in
`cherry-mobile-verifier.md` and `cherry-miniapp.md`.
