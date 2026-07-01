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

## Deployment

Use `dashboard` as the Vercel Root Directory. The local `vercel.json` installs from the monorepo root with Bun and builds this workspace.
