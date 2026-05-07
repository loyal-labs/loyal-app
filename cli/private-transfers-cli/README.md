# private-transfers-cli

Rust CLI for `programs/telegram-private-transfer`.

## Build

```bash
cargo build -p private-transfers-cli
```

Binary:

```bash
target/debug/loyal-private-transfers
```

## Solana Config

By default this reads your Solana CLI config:

- `~/.config/solana/cli/config.yml`
- or `$SOLANA_CONFIG`

Global flags mirror Solana CLI style:

- `-C, --config`
- `-u, --url`
- `--ws`
- `-k, --keypair`
- `--commitment`

## MagicBlock PER

Defaults (auto-detected from Solana config / `--url`):

- `--per-rpc https://mainnet-tee.magicblock.app` (mainnet) or `https://tee.magicblock.app` (devnet)
- `--router-url https://devnet-router.magicblock.app`

When `--per-rpc` contains `tee` and no `token=` is present, the CLI:

1. probes `GET /quote?challenge=...` (TEE probe), and
2. fetches an auth token via:
   - `GET /auth/challenge?pubkey=...`
   - `POST /auth/login` with signed challenge.

Pass `--per-auth-token` to skip token fetch.

## Commands

```bash
loyal-private-transfers display [--mint <MINT>] [--user <PUBKEY> | --username <USERNAME>]

loyal-private-transfers delegate [--mint <MINT>] [--user <PUBKEY> | --username <USERNAME>]
loyal-private-transfers undelegate [--mint <MINT>] [--user <PUBKEY>]
loyal-private-transfers undelegate [--mint <MINT>] --username <USERNAME> --session <TG_SESSION_PDA>

loyal-private-transfers wait-delegate [--mint <MINT>] [--user <PUBKEY> | --username <USERNAME>]
loyal-private-transfers wait-undelegate [--mint <MINT>] [--user <PUBKEY> | --username <USERNAME>]

loyal-private-transfers shield [--mint <MINT>] --amount <RAW_AMOUNT>
loyal-private-transfers unshield [--mint <MINT>] --amount <RAW_AMOUNT>

loyal-private-transfers transfer-username [--mint <MINT>] --username <USERNAME> --amount <RAW_AMOUNT>
```

`--amount` is raw token units.
`--mint` defaults to native SOL mint (`So11111111111111111111111111111111111111112`).

## Debug Logging

Use either:

```bash
RUST_LOG=debug loyal-private-transfers display
```

or:

```bash
loyal-private-transfers --debug display
```

Debug output includes resolved config, RPC/HTTP request details, and raw router delegation responses.

Use `--output json` or `--output json-compact` for machine-readable output.
