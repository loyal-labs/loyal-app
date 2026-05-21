# Solana Documentation

Solana-related documentation for this project (Anchor programs + app/RPC integration).

## Programs

| Program | Address | Purpose |
|---------|---------|---------|
| `telegram-private-transfer` | `97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV` | Deposit/claim SOL transfers |
| `telegram-verification` | `9yiphKYd4b69tR1ZPP8rNwtMeUwWgjYXaXdEzyNziNhz` | On-chain Telegram signature verification |
| `loyal-hub-swap-program` | pending | Raw Solana/SPL stable-swap hub for yield-routing tests and future crank lanes |

## Quick Links

- [Localnet Testing](./localnet-testing.md) - Step-by-step local development setup
- [Smart Accounts API and Frontend Integration](./smart-accounts-api-and-frontend.md) - Internal package APIs and Loyal frontend integration
- [Smart Accounts Kamino Policy Flow](./smart-accounts-kamino-policy-flow.md) - Operator scripts and target auto-yield policy integration
- [Smart Accounts Yield Optimization Flow](./smart-accounts-yield-optimization-flow.md) - Client policy creation, metadata storage, cron scanning, and Earn deposit wiring
- [Wallet Activity + RPC Parsing](./wallet-activity.md) - How we derive SOL/SPL token activity from RPC transactions
