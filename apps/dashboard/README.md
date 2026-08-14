# Loyal Public Dashboard

Public dashboard app for shareable Loyal performance and reliability metrics.

## Local Development

Run through the same 1Password environment mounts as the admin app:

```sh
bun run dashboard:dev:1pass
```

This expands to:

```sh
op run --env-file=../.env.mainnet.1password --env-file=../../loyal-yield-routing/.env.1password -- sh -c 'bun dev'
```

Keep real values in 1Password. Do not write plaintext secrets into local env files, source code, logs, command arguments, or chat.

## Public API

### GET /api/earn/vaults

Public list of active Loyal Earn vault pubkeys (Squads smart accounts), plus the treasury autonomous vault.

Production: https://stats.askloyal.com/api/earn/vaults

200 response: JSON object with `vaults` (base58 pubkeys), `count`, and `updatedAt`.

Source: active rows in `loyal_yield.user_yield_positions`, plus treasury vault `F7zuL14omw4JJfS1cvsWXVb3wh48dvsonMJgoc9tYu3e` if it is not already in that result.

## Deployment

Use `dashboard` as the Vercel Root Directory. The local `vercel.json` installs from the monorepo root with Bun and builds this workspace.
