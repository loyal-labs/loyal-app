# AGENTS.md

## Scope
- This file applies to the entire repository.
- Treat `/Users/taequn/loyal/loyal-admin/src` as the active application source.
- Treat `/Users/taequn/loyal/loyal-admin/admin` as secondary/legacy docs context unless explicitly requested.

## Project Snapshot
- Framework: Next.js 15 (App Router) + React 19 + TypeScript
- Styling: Tailwind CSS v4
- Package manager/runtime: Bun
- Database/ORM: Neon PostgreSQL + Drizzle ORM
- Auth gate: Basic auth middleware in `/Users/taequn/loyal/loyal-admin/src/middleware.ts`

## Directory Map
- `/Users/taequn/loyal/loyal-admin/src/app`: App Router pages, layouts, and route UI
- `/Users/taequn/loyal/loyal-admin/src/lib`: database client and schema definitions
- `/Users/taequn/loyal/loyal-admin/src/middleware.ts`: request auth guard
- `/Users/taequn/loyal/loyal-admin/admin`: secondary/legacy docs context

## Commands
- `bun dev`
- `bun build`
- `bun start`
- `bun lint`
- `bun run db:schema:pull`
- `npx tsc --noEmit`

## Page Layout Contract (Mandatory)
- Root cause to avoid: a nested flex wrapper under `SidebarProvider` can shrink the entire content area to intrinsic width (including header width), especially on routes with small content.
- In `src/app/layout.tsx`, prefer this structure:
  - `SidebarProvider` as the top-level layout wrapper
  - `AppSidebar` and `SidebarInset` as direct siblings
- If an extra wrapper is truly needed inside `SidebarProvider`, it must include `w-full flex-1 min-w-0`.
- In `SidebarInset` layouts, any centered page wrapper using `mx-auto` and `max-w-*` must also include `w-full`.
- Prefer the shared `PageContainer` from `@/components/layout/page-container` instead of repeating wrapper classes in route files.
- For chart pages, ensure the chart parent has explicit height and full-width context (`w-full min-w-0` where applicable).

## Styling Contract
- Admin pages should use a monochrome token-first system:
  - base palette must be grayscale only (no saturated utility colors in pages and components)
  - prefer semantic tokens: `background`, `foreground`, `card`, `border`, `muted`, `accent`, `destructive`
  - status cues may be light/dark contrast only.

## Environment & Secrets
- Required environment variables:
  - `DATABASE_URL`
  - `ADMIN_USER`
  - `ADMIN_PASSWORD`
- Use `.env.local` for local development.
- Keep `.env.example` as the reference for required keys.
- Never hardcode or expose secrets in code, logs, commits, or PR text.

## Coding Rules for Agents
- Prefer server components for page data fetching when consistent with current patterns.
- Keep `export const dynamic = "force-dynamic"` on database-backed pages.
- Keep Drizzle schema changes aligned with existing patterns in `/Users/taequn/loyal/loyal-admin/src/lib/schema.ts`.
- Use the `@/*` import alias rooted at `/Users/taequn/loyal/loyal-admin/src`.

## Drizzle Schema Sync
- Canonical DB connection source is `/Users/taequn/loyal/loyal-admin/src/lib/db.ts`, which uses `DATABASE_URL`.
- Pull the latest DB schema with `bun run db:schema:pull`.
- Direct equivalent command: `bunx drizzle-kit pull --config=drizzle.config.ts`.
- Generated schema artifacts are written to `/Users/taequn/loyal/loyal-admin/src/lib/generated`.
- Keep `/Users/taequn/loyal/loyal-admin/src/lib/schema.ts` as the runtime hand-authored schema unless an explicit migration plan says otherwise.

## Safety & Validation Checklist
- Run lint and typecheck for non-trivial changes:
  - `bun lint`
  - `npx tsc --noEmit`
- Preserve auth middleware behavior unless the task explicitly changes auth behavior.
- Avoid unrelated edits.
- Call out assumptions clearly when changes may affect DB schema or query behavior.

## Before Merge Checklist (UI/Layout)
- `bun lint`
- `npx tsc --noEmit`
- Manual check `/` and `/overview`:
  - header spans the full content area
  - page body is not clipped to intrinsic-width columns
  - chart/container content is full-width and non-collapsed

## Commit & PR Conventions
- Commit messages must follow: `type(scope): simple description`
- PR titles must follow: `type(scope): simple description`
- PR bodies must include a 1-2 sentence description of what changed and why.

Examples:
- Commit: `feat(schema): add summaries topic index`
- Commit: `fix(auth): handle missing basic auth header`
- PR title: `chore(docs): add repository AGENTS guide`
- PR body example: `Adds a root AGENTS.md that documents project structure, commands, and safety rules. This standardizes how agents and contributors make changes in this repo.`

## When Unsure
- Prefer small, isolated changes over broad refactors.
- Document tradeoffs and assumptions in your summary/PR notes.
- Request confirmation before risky schema or auth changes.
