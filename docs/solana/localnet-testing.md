# Localnet Testing

Step-by-step guide for testing Anchor programs locally with MagicBlock's ephemeral validator.

## Prerequisites

- Solana CLI (`solana-test-validator`)
- Anchor CLI (`anchor`)
- MagicBlock Solana validator (`mb-test-validator`)
- MagicBlock Ephemeral validator (`ephemeral-validator`)
  - or use Docker (`docker run magicblocklabs/validator` optional)

## 1. Build Programs

```bash
anchor build
```

Export program IDs:

```bash
export TELEGRAM_VERIFICATION=9yiphKYd4b69tR1ZPP8rNwtMeUwWgjYXaXdEzyNziNhz
export TELEGRAM_PRIVATE_TRANSFER=97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV
```

## 2. Start Solana Validator

Run in terminal 1:

```bash
# RPC: http://127.0.0.1:8899
mb-test-validator \
  --reset \
  --ledger ~/test-ledger \
  --url devnet \
  --clone-upgradeable-program DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh \
  --clone-upgradeable-program ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1 \
  --upgradeable-program $TELEGRAM_VERIFICATION ./target/deploy/telegram_verification.so ~/.config/solana/id.json \
  --upgradeable-program $TELEGRAM_PRIVATE_TRANSFER ./target/deploy/telegram_private_transfer.so ~/.config/solana/id.json
```

This deploys your smart contracts on localnet startup

## 3. Start MagicBlock Ephemeral Validator (optionally in Docker)

Run in terminal 2:

```bash
RUST_LOG=info ephemeral-validator \
    --accounts-lifecycle ephemeral \
    --remote-cluster development \
    --remote-url http://127.0.0.1:8899 \
    --remote-ws-url ws://127.0.0.1:8900 \
    --rpc-port 7799
```

or in Docker:

```bash
# Use Docker on Ubuntu to avoid local GLIBC issues.
docker run -it --rm --network host \
  -e ACCOUNTS_REMOTE=http://127.0.0.1:8899 \
  -e ACCOUNTS_LIFECYCLE=ephemeral \
  -e ACCOUNTS_COMMIT_FREQUENCY_MILLIS=200 \
  -e ACCOUNTS_COMMIT_COMPUTE_UNIT_PRICE=1 \
  -e VALIDATOR_MILLIS_PER_SLOT=25 \
  -e RPC_ADDR=127.0.0.1 \
  -e RPC_PORT=7799 \
  magicblocklabs/validator
```

This connects to your local Solana validator and provides ephemeral account management.

## 4. Run Tests

Run in terminal 3:

```bash
EPHEMERAL_PROVIDER_ENDPOINT="http://localhost:7799" \
EPHEMERAL_WS_ENDPOINT="ws://localhost:7800" \
anchor test \
  --provider.cluster localnet \
  --skip-local-validator \
  --skip-build \
  --skip-deploy
```

Alternative (private transfer flow only):

```bash
anchor run --provider.cluster localnet test_private_transfer
```

## 5. Upgrade Programs after rebuild

```bash
solana program upgrade $(solana program write-buffer target/deploy/telegram_verification.so --output json | jq -r .buffer) $TELEGRAM_VERIFICATION

solana program upgrade $(solana program write-buffer target/deploy/telegram_private_transfer.so --output json | jq -r .buffer) $TELEGRAM_PRIVATE_TRANSFER
```

## 6. Known Error: ProgramData Account Too Small

If you hit:

```text
Error: Upgrading program failed: RPC response error -32002: Transaction simulation failed:
Error processing Instruction 0: account data too small for instruction
```

Extend the program data account, then retry the upgrade:

```bash
solana program show $TELEGRAM_PRIVATE_TRANSFER
solana program extend $TELEGRAM_PRIVATE_TRANSFER 218968
```

## 7. Devnet Deploy

```bash
solana program deploy \
  --url devnet \
  --upgrade-authority ~/.config/solana/id.json \
  target/deploy/telegram_private_transfer.so
```

## Endpoints Reference

| Service | HTTP | WebSocket |
|---------|------|-----------|
| Solana validator | `http://127.0.0.1:8899` | `ws://127.0.0.1:8900` |
| MagicBlock ER validator | `http://127.0.0.1:7799` | `ws://127.0.0.1:7800` |

## Test Files

| File | Description |
|------|-------------|
| `tests/telegram-verification.ts` | Telegram signature verification tests |
| `tests/telegram-verification-gasless.ts` | Gasless transaction tests |
| `tests/telegram-private-transfer.ts` | Private transfer tests |
