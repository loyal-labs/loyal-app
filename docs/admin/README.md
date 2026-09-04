# Admin Docs

## What It Is
- `/apps/admin` is the internal Next.js dashboard for communities, admins, and overview analytics.

## Core Rules
- Use shared DB packages only:
  - `@loyal-labs/db-core/schema`
  - `@loyal-labs/db-adapter-neon`
- Keep DB wiring in `apps/admin/src/lib/core/database.ts`.
- Do not add local schema generation files (`apps/admin/src/lib/generated/*`, `apps/admin/drizzle.config.ts`).
- Do not reintroduce `/apps/admin/schema`; source schema details from shared packages/docs.

## Useful Commands
From repo root:

```bash
bun run admin:dev
bun run admin:lint
bun run admin:build
bun run guard:admin-shared-schema
```

From `/apps/admin`:

```bash
bun dev
bun lint
bun run build
```

## Deploy (Vercel)
- Repo: `loyal-labs/loyal-app`
- Root Directory: `admin`
- Project config: `apps/admin/vercel.json`
