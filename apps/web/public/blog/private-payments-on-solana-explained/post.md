---
title: "Private payments on Solana, explained"
date: "2026-01-28"
hero: hero.png
description: "How shielded balances and an ephemeral runtime make transfers invisible to the public chain."
author:
  name: "Chris, founder"
  avatar: /blog/authors/chris.png
---

Solana is a public ledger by default. Every transfer, every balance, every wallet is readable by anyone. Loyal turns that off for your dollars — and it does it with two distinct properties.

## The shared Vault gives you fungibility

When you shield USDC, SOL, or USDT, your tokens join a shared on-chain Vault: one pool per mint, holding everyone's real SPL tokens commingled. An observer can't tell whose deposited tokens are whose.

## The ephemeral runtime gives you transfer privacy

Transfers between shielded users don't move real tokens at all. They're pure arithmetic on confidential deposit accounts, run inside MagicBlock's private ephemeral runtime, where only the deposit owner can see or interact with the account.

- Pool size matters for fungibility on deposits and withdrawals.
- It does **not** matter for transfer privacy — transfers are invisible inside the runtime regardless of pool size.

Two different properties, one wallet. Commingled isn't custodial: only your own key can withdraw your balance.
