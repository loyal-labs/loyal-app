---
title: "Week 10 at Loyal"
date: "2026-03-30"
hero: hero.png
description: "No slides this week so we raw-dogged the stream."
author:
  name: "Rodion, founder"
---
No slides this week so we raw-dogged the stream. We shipped even better than usual.

## The Giveaway

Last week we pushed private transfers to mainnet, this week we stress-tested them. A thousand dollars, split across a hundred users. Different wallets, different usernames, tricky edge cases. Rodion ran a script that sent private Telegram transactions to all of them. Nobody needed a wallet. Nobody needed to set anything up. The money just arrived.

## Two things came out of it.

First, our smart contract needs optimization around account creation. At around 150 to 200 payments we burned nearly $90 in gasless fees. That is too much. The fix will likely come from compressed PDAs via Light Protocol. MagicBlock is building native support for that on their rollup.

Second, we confirmed what we suspected. Telegram handles are the easiest way to move money at scale. Easier than wallet addresses, easier than anything else we have tried. You type a name, the money moves, the recipient figures it out from there.

## The Browser Extension

Vlad built a browser extension. It works on every Chromium browser — Chrome, Arc, Brave, Opera, Edge. Firefox gets its own version. Safari is out for now.

It opens as a sidebar. You can create wallets, import them, send, receive, swap, and shield. Everything the mini app does, the extension does. The balance-hiding eye button is there too, for when you are on a screen that is not just yours.

We are shipping passkey support tied to [askloyal.com](https://askloyal.com/)
 so it works across every surface. For the extension specifically, we are looking at a PIN code instead of a full password. Your funds sit behind Squads and smart account protections already. We do not need to make you type eight characters every time you open a sidebar.

The extension is on our GitHub right now if you want it early. Public release is next week.

## APY on Shielded Assets

One of the real concerns about privacy is that your money stops working when you hide it. It just sits there, dark and quiet, earning nothing.

We are fixing that. When you shield USDT, USDC, or SOL, your deposit enters the Loyal private net. But on mainnet, those tokens get locked into a Kamino vault. They earn yield the entire time they are shielded. When you unshield, you get your tokens back plus whatever they earned.

Your money stays private and it stays productive. We think this is the first step into privacy-based earning and we have not seen anyone else do it.

## SDKs and CLI for Traders

We shipped TypeScript and Rust SDKs this week. Next week we ship a CLI client built on the Rust SDK with policy management inherited from Squads Smart Account.

This is for professional traders. Because your transactions run through our private layer, there is no front-running. No MEV. No sandwich attacks. The CLI plugs into agents — OpenLaw, Hermes, Codex — and we believe agentic finance will carry most of the trading volume within five years. We are building for that now.

## Mobile

We already have an Android APK with full feature parity against the Telegram mini app. Mobile apps ship in roughly two weeks.

## Next Week

Browser extension goes public. CLI ships. We keep optimizing the smart contract for cheaper private transfers. Mobile keeps moving toward release.

We stream live every Friday. Follow us on X and join our Telegram community to catch the next one.

Stay Loyal.

Website — [https://askloyal.com](https://askloyal.com/)
  
Docs — [https://docs.askloyal.com](https://docs.askloyal.com/)
  
Buy $LOYAL on Jupiter —  
[https://jup.ag/tokens/LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta](https://jup.ag/tokens/LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta)
  
Telegram Agent — [https://t.me/askloyal\_tgbot](https://t.me/askloyal_tgbot)
  
Telegram Community — [https://t.me/loyal\_tgchat](https://t.me/loyal_tgchat)
  
Discord — [https://discord.com/invite/tAwXsXwTv6](https://discord.com/invite/tAwXsXwTv6)
  
X (Twitter) — [https://x.com/loyal\_hq](https://x.com/loyal_hq)
  
GitHub — [https://github.com/loyal-labs](https://github.com/loyal-labs)
