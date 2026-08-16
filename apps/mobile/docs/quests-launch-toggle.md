# Quests launch toggle (Seeker Season / Solana Week)

**Status: REVEALED (2026-07-08 Solana Mobile launch).** Mobile
`QUESTS_ENABLED` is now unconditionally `true` (shipped via OTA to the
dApp Store build); backend `SOLANA_WEEK_QUESTS_ENABLED=true` is set in Vercel
prod. The rest of this doc records the pre-launch gating for history/rollback.

The tricky constraint: **all builds share one backend**
(`solana-telegram-transactions.vercel.app`), and an internal **preview** build
must keep quests fully working for testers while the **dApp Store** build hides
them. So gating is split into three pieces that must stay consistent:

1. **Mobile UI (per build)** — hides the Quests tab/screen/notifications in the
   dApp Store build only.
2. **Backend reporting (global kill-switch)** — stops sending completions to
   Solana.
3. **Backend tester carve-out (per wallet)** — re-enables sending for
   allowlisted tester wallets, so preview testers still complete quests
   end-to-end against the real backend.

Why the carve-out is wallet-keyed: Quest 2 (`first_autodeposit_sweep`) is
reported by the **external sweep worker** hitting `/api/solana-week/sweep-notify`
with only a wallet address — no build/channel/client context. The wallet is the
only signal available on every send path, so testers are distinguished by
wallet, not by client build. (Also note: a dApp Store user doing a normal $10
Earn deposit triggers Quest 1 server-side even though the quest UI is hidden —
which is exactly why the backend gate is mandatory, not just the UI.)

---

## TL;DR — activate everything at the public reveal

1. **Backend (no code change):** set `SOLANA_WEEK_QUESTS_ENABLED=true` in the
   `frontend` production env (Vercel), alongside the already-present
   `SOLANA_WEEK_QUESTS_COMPLETION_ENDPOINT` / `_API_KEY` / `_QUEST_ID_*`.
   Redeploy. The reconcile cron then **backfills** everything that happened while
   disabled (rows were kept `pending`). You can clear
   `SOLANA_WEEK_QUESTS_TESTER_WALLETS` at that point (no longer needed).
2. **Mobile:** nothing per-flag — the dApp Store build hides quests via
   `extra.isDappStoreBuild`. To reveal in the dApp Store build, ship a build with
   quests intended visible (see "Mobile UI" below for the exact lever).

### Onboard a tester before the reveal

Add their wallet address to `SOLANA_WEEK_QUESTS_TESTER_WALLETS` (comma-separated)
in prod env and hand them the **preview** build. They get the quest UI (preview
build) and real Solana completions for both quests (allowlisted wallet). No
redeploy of the app needed; the env change takes effect on the next backend
deploy/restart.

---

## 1. Mobile UI — branch `ask-1355-mobile-earn-tab`

Single source of truth: **`mobile/src/lib/feature-flags.ts` → `QUESTS_ENABLED`**,
derived from the build:

```ts
QUESTS_ENABLED = Constants.expoConfig?.extra?.isDappStoreBuild !== true;
```

`extra.isDappStoreBuild` is set in `app.config.ts` from the existing
`DAPP_STORE_BUILD=true` env (the `dapp-store` EAS profile). So quests are hidden
**only** in the dApp Store build; `preview`, `development`, and the Play Store
`production` build all show them.

While `QUESTS_ENABLED` is false:

| File | Behavior |
|------|----------|
| `mobile/app/(tabs)/_layout.tsx` | `<QuestCompletionWatcher />` not mounted → no polling, no completion notifications. |
| `mobile/src/components/TabBar.tsx` | Quests (bone) icon stays in the bar, but the tap is a no-op. |
| `mobile/app/(tabs)/quests.tsx` | Screen `<Redirect href="/(tabs)" />`s home — covers deep-link / programmatic nav. |

The `quests` route stays registered and all quest code/assets are untouched.

**To reveal in the dApp Store build at launch:** the simplest lever is to make
`QUESTS_ENABLED` unconditionally `true` (e.g. `export const QUESTS_ENABLED =
true;`) and ship the dApp Store build — or drop the `isDappStoreBuild` gate
entirely once quests are public everywhere.

---

## 2. Backend reporting + tester carve-out — branch `chore-disable-solana-week-quest-completions` (off `main`)

All three Solana send paths funnel through `reportQuestCompletion()` in
`frontend/src/features/solana-week/server/quest-completion-reporter.ts`:

- Quest 1 `earn_deposit` → `POST /api/smart-accounts/mobile/earn/deposit/confirm`
- Quest 2 `first_autodeposit_sweep` → `POST /api/solana-week/sweep-notify`
  (called by the external sweep worker)
- Reconcile backstop → `GET /api/cron/solana-week-quest-completions`

**Change:** a fail-safe-OFF gate at the top of `reportQuestCompletion()`:

```
send to Solana IFF  SOLANA_WEEK_QUESTS_ENABLED === "true"
                    OR  wallet ∈ SOLANA_WEEK_QUESTS_TESTER_WALLETS
```

Otherwise it returns `{ status: "disabled" }` before any network call. One gate
covers all three paths and both quests. `frontend/.env.example` documents both
vars.

**Env (prod / Vercel):**

| Var | Launch value | Meaning |
|-----|--------------|---------|
| `SOLANA_WEEK_QUESTS_ENABLED` | unset (off) | `"true"` = report for everyone (the reveal). |
| `SOLANA_WEEK_QUESTS_TESTER_WALLETS` | tester wallets, comma-separated | Always reported, even while the kill-switch is off. |

### The external sweep worker needs no change

It just calls `/sweep-notify`, which is best-effort and always returns
`{ status: "accepted" }`. Its reports no-op at the reporter unless the wallet is
allowlisted (or the global switch is on). **Do not touch the worker.**

### Behavior while disabled

- Local rows in `loyal_yield.solana_week_quest_completions` are still created and
  held `pending` (only the *send* is skipped).
- **On global enable, the reconcile cron backfills all pending rows** → users who
  acted during the blackout get credited retroactively. For a clean slate with
  no pre-reveal backfill, purge those rows before setting
  `SOLANA_WEEK_QUESTS_ENABLED=true`. (Tester wallets that already reported are
  `reported` and idempotent — they won't double-send.)

---

## Verification

- Mobile: `cd mobile && npx tsc --noEmit && npx expo lint`.
- Backend: `cd frontend && bun lint && npx tsc --noEmit` (in the
  `chore-disable-solana-week-quest-completions` worktree, after `bun install`).
- Manual:
  - dApp Store build → Quests tab inert, no completion sheet after a $10 deposit,
    no row flips to `reported`.
  - Preview build with an allowlisted wallet → quests visible, completion sheet
    fires, rows go `reported`.
