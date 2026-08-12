# CLAUDE.md

## Project Overview

Internal admin panel for viewing and editing backend summaries data. Built with Next.js 15, React 19, Tailwind CSS v4, and Drizzle ORM connecting to a shared Neon PostgreSQL database.

This service shares the same database as the main Solana Telegram Transactions app but is a standalone project with no code dependencies on it.

## Commands

```bash
bun dev          # Start dev server (turbopack)
bun build        # Production build
bun start        # Start production server
bun lint         # ESLint
bun run db:schema:pull  # Pull live DB schema into src/lib/generated
```

Type checking:

```bash
npx tsc --noEmit
```

## UI + Monochrome Admin Design

- Keep shared UI components in `src/components/ui`.
- Keep shared utility helpers in `src/lib/utils.ts`.
- Use grayscale tokens from `src/app/globals.css` for all new styles:
  - `background`, `foreground`, `card`, `border`, `muted`, `accent`, `destructive`
  - no non-monochrome utility colors (blue/green/red) in page-level styles.

## Layout Guardrails (Avoid Width Collapse)

- Root cause to avoid: adding a nested flex wrapper under `SidebarProvider` without `w-full`/`flex-1` can shrink the whole page to intrinsic content width.
- In `src/app/layout.tsx`, keep `SidebarProvider` as the outer layout container and render `AppSidebar` + `SidebarInset` as direct siblings.
- If you must add another wrapper in that area, include `w-full flex-1 min-w-0`.
- Use `PageContainer` from `@/components/layout/page-container` for route-level wrappers.
- In `SidebarInset` pages, never use `mx-auto max-w-*` without `w-full`.
- For chart pages, ensure the chart parent has explicit height and full-width constraints (`w-full min-w-0`) and verify desktop/mobile behavior after changes.

## Architecture

### Stack

- **Framework**: Next.js 15 (App Router, server components)
- **Styling**: Tailwind CSS v4 (via `@tailwindcss/postcss`)
- **Database**: Neon PostgreSQL (serverless driver)
- **ORM**: Drizzle (`drizzle-orm/neon-http`)
- **Package Manager**: Bun

### Directory Structure

```
apps/admin/
├── src/
│   ├── apps/telegram/
│   │   ├── layout.tsx        # Root layout with nav bar
│   │   ├── page.tsx          # Communities list with latest summary info
│   │   ├── schema/page.tsx   # Database schema reference page
│   │   └── globals.css       # Tailwind import
│   └── lib/
│       ├── db.ts             # Neon + Drizzle connection
│       └── schema.ts         # Drizzle table definitions (subset of main app)
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
└── .env.example
```

### Database Connection

The database is shared with the main app. Connection is configured in `src/lib/db.ts` using `@neondatabase/serverless` with the `DATABASE_URL` environment variable.

### Drizzle Schema Sync

Use the Drizzle CLI pull workflow to keep an up-to-date schema snapshot from the live Neon database.

- Config file: `drizzle.config.ts`
- Connection source: `DATABASE_URL` (same environment variable used by `src/lib/db.ts`)
- Output directory: `src/lib/generated`
- Primary command: `bun run db:schema:pull`
- Direct equivalent: `bunx drizzle-kit pull --config=drizzle.config.ts`

Run schema pull before schema-related admin work and after database schema changes in the shared DB.
This workflow does not automatically change runtime imports; app code should continue using `src/lib/schema.ts` unless a specific migration is planned.

### Schema

`src/lib/schema.ts` contains Drizzle table definitions for the tables this service needs. Currently includes `communities` and `summaries` with their relations.

**The full database has 9 tables** (admins, users, communities, community_members, messages, summaries, business_connections, bot_threads, bot_messages). The `/schema` page documents all of them. When adding features that need additional tables, copy the relevant definitions from the main app's schema at `apps/telegram/src/lib/core/schema.ts` (in the parent repo).

### Key Patterns

- **Server Components**: Pages fetch data directly in async server components — no API routes needed for read-only views
- **`force-dynamic`**: Pages that query the database use `export const dynamic = "force-dynamic"` to disable static generation
- **Drizzle relations**: Use `db.query.table.findMany({ with: { ... } })` for relational queries
- **Tailwind v4**: No `tailwind.config.ts` — configuration is done via CSS (`@import "tailwindcss"`)

### Database Conventions (from main app)

- **Primary Keys**: UUID with `defaultRandom()`
- **Telegram IDs**: `bigint` with `{ mode: "bigint" }`
- **Timestamps**: Always `timestamptz` with `.defaultNow().notNull()`
- **Typed JSONB**: Use `.$type<T>()` for type-safe JSONB columns

## Environment Variables

Required in `.env.local`:

```env
DATABASE_URL=postgresql://...   # Neon PostgreSQL connection string
```

The admin Earn funding view optionally accepts the public-only
`EARN_SETTINGS_AUTHORITY_PUBLIC_KEY` for config-vs-observed operational-wallet
checks. Store only the public key in environment files; never place private
keys there.

The admin Metrics page at `/metrics` reads ClickStack telemetry and durable
Earn rebalance latency data server-side. The `/earn/rebalance` page provides
USDC Safe reserve APY, optimizer decision, executed rebalance, and audit/error
monitoring.
Configure `LOYAL_CLICKSTACK_API_KEY` for its API key; `HYPERDX_ACCESS_KEY`
remains supported as a fallback. `LOYAL_CLICKSTACK_API_URL` and
`LOYAL_CLICKSTACK_METRICS_SOURCE_ID` are optional overrides for the ClickStack
deployment and metrics source.

## Adding New Pages

1. Create a directory under `src/app/` with a `page.tsx`
2. Import `db` from `@/lib/db` and query directly in the server component
3. Add a nav link in `src/components/app-sidebar.tsx`
4. If new tables are needed, add their Drizzle definitions to `src/lib/schema.ts`

## Before Merge Checklist (UI/Layout)

- `bun lint`
- `npx tsc --noEmit`
- Manually verify `/` and `/overview`:
  - header spans full content width
  - route content is not clipped to intrinsic-width columns
  - chart/container rendering remains full-width and non-collapsed
