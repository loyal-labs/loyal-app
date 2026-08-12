# Earn realtime localhost smoke

Local Loyal defaults its token response to
`http://127.0.0.1:10000/events`. `REALTIME_EVENTS_URL` can override that URL for
another local or staging realtime service. Both processes must receive the same
`REALTIME_AUTH_SECRET` through their 1Password environments; never copy it into
an `.env` file.

Confirm the frontend environment has the key without printing its value:

```sh
op run --env-file=.env.1password -- sh -c 'test -n "$REALTIME_AUTH_SECRET"'
```

Restart the frontend process after adding or rotating the key; environment
changes are not injected into an already-running Next process.

Run the routing SSE service from `loyal-yield-routing`:

```sh
cd ../loyal-yield-routing
op run --env-file=../loyal-apps/.env.1password -- sh -c 'REALTIME_ALLOWED_ORIGINS=http://localhost:3000 PORT=10000 cargo run -p loyal-yield-realtime'
```

In another terminal, from `loyal-apps`, run Loyal:

```sh
op run --env-file=.env.1password -- sh -c 'bun run --cwd frontend dev'
```

Sign in at `http://localhost:3000`, open Earn, and inspect one connection to
`127.0.0.1:10000/events`. Execute-now should make one POST and receive progress
on that stream. To test against a different endpoint, inject it only inside the
1Password subprocess:

```sh
op run --env-file=.env.1password -- sh -c 'REALTIME_EVENTS_URL=http://127.0.0.1:11000/events bun run --cwd frontend dev'
```

## Schema ownership

Run Yield Neon migrations only from `loyal-yield-routing` with its
`yield-migrations` binary. The app repository does not provision realtime
schema; SQL under `apps/web/src/lib/yield-optimization/migrations` is retained
only as historical compatibility context.
