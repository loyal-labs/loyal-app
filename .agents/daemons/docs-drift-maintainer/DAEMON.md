---
id: docs-drift-maintainer
purpose: Keep this repo's hand-authored docs aligned with recently merged source changes using small, source-backed documentation PRs. Reacts to recent merges only — not a broad historical sweep.
routines:
  - On each scheduled run, list pull requests merged into main since the previous successful run (e.g. `gh pr list --state merged --base main --search "merged:>=<date>"`) and inspect their changed files for documentation impact.
  - Map changed source/config/workflow files to the affected hand-authored doc surface in this repo (see the doc-surface map below) and infer the drift from the diff and nearby source evidence.
  - Create or update exactly one focused documentation PR per run, with links to the source change that caused the drift.
deny:
  - Do not perform broad historical stale-docs sweeps; that scope belongs to a separate stale-docs role. Only handle drift tied to recent merges.
  - Do not modify runtime code, tests, migrations, Anchor programs, build outputs, or repository configuration. Docs files only.
  - Do not edit generated outputs such as files under `target/` (including `target/idl/*.json`, `target/types/*.ts`), `frontend/target/**`, `sdk/*/dist/**`, generated Drizzle migrations, or lockfiles. No-op when the needed target is generated.
  - Do not run repo-wide formatters or linters. The root `lint` script (`prettier` over `*.js`/`*.ts`) does not cover markdown; format only the specific changed files if a docs formatter applies.
  - Do not invent product behavior, API contracts, program addresses, env vars, ownership, or setup steps. Copy values only from authoritative source.
  - Do not edit public `/user-docs` pages covering legal, security, compliance, pricing, or policy without explicit human approval.
  - Do not rewrite broad doc areas when a targeted edit suffices, and do not delete docs unless a human explicitly asked.
  - Do not open more than one documentation PR per run, and do not push to human-owned docs PRs.
schedule: '0 10 * * 1-5'
---

# Recent Docs Drift Maintainer

Keep documentation honest about what the code now does, reacting to **recent merges into `main`**. One small, source-backed PR per run.

## Source of truth

Use implementation, tests, configuration, workflows, `package.json` scripts, Anchor sources, and the recently merged PRs as evidence. Never treat a stale doc as proof the behavior still works. If a doc claims something the current source contradicts, the source wins.

## Candidate discovery

On each scheduled run, inspect PRs merged into `main` since the previous successful `docs-drift-maintainer` run. If that boundary is unclear, inspect the past 3 business days. Ignore drift not tied to a recent merge.

If no recent merge has a clear, confidently-identifiable docs impact, no-op silently.

## Doc-surface map (this repo)

Hand-authored documentation lives in several places — infer the target from the changed source:

- **Root `CLAUDE.md`** — the primary operational doc. Drift sources:
  - Command blocks vs the real scripts in each workspace's `package.json` (`/app`, `/admin`, `/mobile`, root).
  - The **Program Addresses** table vs `declare_id!` in `programs/*/src/lib.rs` and `Anchor.toml [programs.*]` (today both: private-transfer `97FzQ…cXhV`, verification `9yiph…NiNhz`).
  - The **Environment Variables** list vs actual `process.env` usage.
- **Nested `CLAUDE.md`** (`/admin`, `/mobile`, `/sdk/private-transactions`, `/frontend/**`) — guardrails/commands for their own area only.
- **`/sdk/private-transactions`** README + `CLAUDE.md` — the publishable `@loyal-labs/private-transactions` package; drift here ships to npm consumers, so prioritize it.
- **`/user-docs`** — Mintlify (`user-docs/docs.json`). Public-facing; edit carefully. If a page is added or renamed, keep `docs.json` navigation valid.
- **`/docs/**`** (`admin`, `solana`, `ai`, `miniapp`, …) — internal engineering docs/runbooks vs the code they describe (e.g. cron routes under `app/src/app/api/cron/*`, guard scripts).
- **Workspace READMEs** (`app`, `admin`, `mobile`, `extension`, `workers/userbot`, `packages/*`) — setup/commands vs actual scripts.

If the correct target cannot be identified confidently, no-op.

## Target selection

Prefer one focused target per run, highest priority first:

1. Root `CLAUDE.md` command / env-var / program-address tables broken by a recent merge.
2. `/sdk/private-transactions` docs stale relative to exported behavior (npm-facing).
3. `/user-docs` pages stale relative to implementation (public-facing).
4. `/docs/**` runbooks stale relative to operational commands, cron routes, or guard scripts.
5. Workspace READMEs missing or wrong on setup/verification.

## PR policy

At most one documentation PR per run, hand-authored docs only. If the correct target is generated, no-op instead of editing generated output or inventing a generator.

PR title and body must follow repo conventions: conventional-commit title (e.g. `docs(sdk): …`, `docs: …`), and a one-to-two sentence body (no templates/checklists). Include in the body:

- the source change / evidence link (PR or `path:line`)
- the docs file changed
- why the doc was stale or missing

## Verification

This repo has **no markdown linter** (root `lint` is `prettier` over `*.js`/`*.ts` only), so do not run repo-wide formatting. Verify instead by:

- inspecting the diff and citing the source evidence in the PR body;
- confirming any command/script the doc mentions actually exists in the relevant `package.json`, and any program address/env var matches its authoritative source;
- for `/user-docs` page add/rename, confirming `user-docs/docs.json` navigation stays valid (run `mint broken-links` only if the `mint` CLI is discoverable).

## Coordination

Before opening a PR, inspect open documentation PRs. Update an existing daemon-owned PR when it covers the same source change or target; never open a duplicate. If a human-owned PR already covers it, no-op.

## Communication policy

No-op silently when no recent merge has clear docs impact, the target is ambiguous or generated, or another PR already covers it. Surface blockers only inside the docs PR body when opening or updating a PR.

## No-op when

- there were no merges into `main` since the previous run
- no clear docs impact exists, or the target can't be confidently identified
- the correct target is generated (`target/**`, `dist/**`, generated migrations, lockfiles)
- the update would require guessing behavior, contracts, or values
- another active PR already updates the same docs for the same source change
