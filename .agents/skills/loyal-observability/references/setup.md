# ClickStack agent setup

ClickStack URL: `https://loyal-clickstack.onrender.com`

The shared personal key is stored as concealed variable `LOYAL_CLICKSTACK_API_KEY` in the 1Password Environment `loyal-noncritical-env`. Never commit or paste the value into MCP configuration.

## Codex

1. Create a local 1Password Environment mount for `loyal-noncritical-env`, such as `.env.clickstack.1password`.
2. Register the server once:

```sh
codex mcp add clickstack \
  --url https://loyal-clickstack.onrender.com/api/mcp \
  --bearer-token-env-var LOYAL_CLICKSTACK_API_KEY
```

3. Launch Codex with the mounted environment:

```sh
op run --env-file=.env.clickstack.1password -- codex
```

For the Codex desktop app, load the value into the macOS user launch environment:

```sh
op run --env-file=.env.clickstack.1password -- /bin/sh -c \
  'launchctl setenv LOYAL_CLICKSTACK_API_KEY "$LOYAL_CLICKSTACK_API_KEY"'
```

Then fully quit and reopen Codex. Repeat this after signing out or restarting the Mac if the launch environment no longer contains the variable.

4. Restart an already-running Codex client after adding the server or changing its environment.

Current Codex uses `--url` and `--bearer-token-env-var`; the ClickStack-generated `--transport` and `--header` example is intended for clients whose CLI supports those flags.

## Other MCP clients

Use Streamable HTTP:

- URL: `https://loyal-clickstack.onrender.com/api/mcp`
- Header: `Authorization: Bearer <personal API access key>`

Prefer the client's environment-variable or secret reference support. Obtain the value from the shared 1Password Environment instead of documentation or source control.

## Verify

Run the credential-safe smoke check after setup:

```sh
op run --env-file=.env.clickstack.1password -- \
  .agents/skills/loyal-observability/scripts/verify-clickstack.sh
```

It initializes the MCP server, confirms the read-only investigation tools and four telemetry sources, and runs a bounded five-minute log query. It never prints the key or returned log rows.

A credential-free request to `/api/mcp` should return `401`; an authenticated MCP initialize request should succeed.
