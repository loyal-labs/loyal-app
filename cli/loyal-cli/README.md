# loyal-cli

Agent CLI for Loyal Squads Vault automation.

## Build

```bash
cargo build -p loyal-cli
```

Binary:

```bash
target/debug/loyal
```

## Key Storage

By default this CLI stores its dedicated agent signer at:

```bash
~/.config/loyal/id.json
```

This key is separate from `~/.config/solana/id.json`.

## Configuration

The CLI reads a Solana-style YAML config from:

```bash
~/.config/loyal/cli/config.yml
```

Global flags:

```bash
loyal --config <PATH> --url <FRONTEND_URL> --rpc-url <RPC_URL> --keypair <PATH> --commitment confirmed --smart-accounts-program-id <PROGRAM_ID> <COMMAND>
```

Environment overrides:

- `LOYAL_URL` or `LOYAL_BASE_URL`
- `LOYAL_RPC_URL` or `RPC_URL`
- `LOYAL_WS_URL`
- `LOYAL_KEYPAIR`
- `LOYAL_SMART_ACCOUNTS_PROGRAM_ID`
- `LOYAL_SETTINGS_PDA`
- `LOYAL_POLICY_PDA`

## Commands

```bash
loyal auth
loyal pubkey
loyal show
loyal propose raw <ENCODED_TRANSACTION>
loyal propose transfer sol <RECIPIENT_ADDRESS> <AMOUNT>
loyal propose transfer token <TOKEN_MINT_ADDRESS> <TOKEN_AMOUNT> <RECIPIENT_ADDRESS>
```

`loyal auth` opens `<FRONTEND_URL>?connect=<CLI_PUBLIC_KEY>` and subscribes to
Squads policy accounts until the CLI public key is added to `Policy.signers[]`
with the Initiate permission.

`loyal propose raw` accepts a base64, URL-safe base64, or base58 serialized
Solana transaction.

`loyal propose transfer sol` mirrors `solana transfer` for vault SOL transfers:
the amount is in SOL and may be `ALL`; `--allow-unfunded-recipient`,
`--from`, `--with-compute-unit-price`, `--with-memo`, and `--no-wait` are
supported. `--from` must match the resolved policy vault.

`loyal propose transfer token` mirrors `spl-token transfer` for vault SPL token
transfers. By default it sends from the vault associated token account to the
recipient associated token account. Supported transfer flags include `--from`,
`--owner`, `--fund-recipient`, `--allow-unfunded-recipient`,
`--allow-non-system-account-recipient`, `--token-program-id`, `--program-2022`,
`--mint-decimals`, `--transfer-hook-account`, `--with-compute-unit-limit`,
`--with-compute-unit-price`, `--with-memo`, and `--no-wait`. `--owner` must
match the resolved policy vault.

All `propose` forms create a Squads policy transaction and proposal directly
on-chain, then sign and submit it with `~/.config/loyal/id.json`.
