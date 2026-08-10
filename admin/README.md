# loyal-admin

## Online

https://loyal-admin-zeta.vercel.app/

Auth credentials are stored in 1Password (`loyal-admin`).

## Local Development

1. From repo root: `bun i`
2. Set `DATABASE_URL`, `ADMIN_USER`, and `ADMIN_PASSWORD` in `admin/.env.local`
   - The Metrics page also needs the server-only `LOYAL_CLICKSTACK_API_KEY`.
     `HYPERDX_ACCESS_KEY` remains supported as a fallback for existing environments.
3. Start admin:
   - from root: `bun run admin:dev`
   - or from `admin/`: `bun dev`

## Database Schema

This workspace uses shared monorepo schema and Neon DB adapter packages:

- `@loyal-labs/db-core/schema`
- `@loyal-labs/db-adapter-neon`

Do not add local generated schema files under `admin/src/lib/generated`.
There is no admin `/schema` UI route; schema is sourced directly from shared packages.

## Vercel Deploy

For monorepo deploys:

- Repository: `loyal-labs/loyal-app`
- Root Directory: `admin`
- Config: `admin/vercel.json`

Configure `LOYAL_CLICKSTACK_API_KEY` in the Vercel project before deploying the
Metrics page. Keep it server-only; never expose it through a `NEXT_PUBLIC_`
variable. `LOYAL_CLICKSTACK_API_URL` and `LOYAL_CLICKSTACK_METRICS_SOURCE_ID`
are optional overrides for a different ClickStack deployment or metrics source.
