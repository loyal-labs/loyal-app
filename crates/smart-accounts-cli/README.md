# smart-accounts-cli

Rust CLI for Loyal smart-account signer identities.

## Build

```bash
cargo build -p smart-accounts-cli
```

Binary:

```bash
target/debug/loyal-smart-accounts
```

## Key Storage

By default this CLI stores a dedicated Loyal signer in the platform config
directory:

```bash
<config_dir>/loyal/smart-accounts.json
```

Examples:

- macOS: `~/Library/Application Support/loyal/smart-accounts.json`
- Linux: `~/.config/loyal/smart-accounts.json`

Resolution precedence:

1. `--keypair <path>`
2. `LOYAL_SMART_ACCOUNTS_KEYPAIR`
3. default Loyal config path

The keypair file uses Solana-compatible JSON encoding, but this CLI does not
fall back to `~/.config/solana/id.json`.

## Commands

```bash
loyal-smart-accounts init [--force]
loyal-smart-accounts pubkey
loyal-smart-accounts show
loyal-smart-accounts sign-message --message "<challenge>"
```

Global flags:

```bash
loyal-smart-accounts --keypair <PATH> --output <display|json|json-compact> --debug <COMMAND>
```

## Recommended Web Flow

1. Run `loyal-smart-accounts init`.
2. Copy the printed public key.
3. Use `loyal-smart-accounts sign-message --message "<challenge>"` when the web
   app asks the CLI to prove ownership of that key.
4. Add that public key in the web app as a smart-account signer with
   propose-only `Initiate` permission.

This identity is intentionally separate from the user’s general Solana CLI
wallet so it can stay narrowly scoped to Loyal smart-account automation.
