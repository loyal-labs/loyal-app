---
title: "(Almost?) PMF, a roadmap update, and what's next"
date: "2026-07-18"
hero: hero.jpg
description: "Seeker Summer treated us well."
author:
  name: "Rodion, founder"
---
Seeker Summer treated us well.

Over the past few weeks, 9,000 Seekers installed Loyal, and more than 3,000 launched an agent. Then did the thing we were quietly hoping for and trusted those agents with real money. Loyal Earn holds $390,000 in USDC today. The feature is less than a month available for public.

It's too early to talk about retention, and installs are just installs. But strangers depositing six figures into a month-old feature is the strongest signal we've had since we started building. So let's talk about what got us here, and where the business goes from here.

## The two bets

The last few quarters we built the foundation: the wallet, private transfers, Smart Accounts with policies, the Chrome extension. Necessary work, but foundations don't make a quarter. Two bets did.

**Bet one: ship on Seeker.** A phone full of crypto-native users who actually try new dApps is the best distribution we could ask for. We wanted to be there day one, so we cut scope elsewhere and made the deadline. The install and activation numbers above are the result.

**Bet two: ship Earn.** Most people don't want to run five DeFi tabs to make idle stablecoins work. They want one button that makes their money bigger. That's what a Smart Account with an agent inside is for. Deposit USDC, the agent hunts the yield, you stay in control of the guardrails.

Both bets were versions of the same thesis: agents are becoming the interface for finance, and the missing piece is an execution layer people can actually trust with money. The $390K sitting in Earn says the thesis holds.

## Where the revenue comes from

Here's how Earn works today. You deposit USDC. An Earn agent watches lending markets and rebalances your deposit between pools of the same mint, chasing the best rate. USDC stays USDC the whole time.

The next step is cross-mint rebalancing. Stablecoins from solid issuers trade 1:1 basically always. So when the APY on one of them spikes, like the recent 20% spike on PYUSD, the right move is obvious: swap in, farm the elevated yield, swap back when it normalizes. Same risk profile, better rate. And when the agent executes that swap inside Loyal, the routing fee stays in the product instead of going to an external router.

Some napkin math on what this becomes. Mature yield protocols retain roughly 0.5 to 1% of TVL per year as protocol revenue (DeFiLlama numbers, directional). At that ratio, every dollar in Earn is recurring revenue. We're at $390K after month one, before cross-mint swap fees, and before the services below. You can do the multiplication.

## Failsafe

On April 1, Drift was drained for $285 million. Everyone quotes the 12-minute number, but that was only the first burst. The full drain ran about two and a half hours. And the real warning came five days earlier: on March 27, Drift's security council migrated to a new 2-of-5 multisig with a zero-second timelock, with four of the five signers brand new. That red flag sat on-chain, in public, for five days. Nobody acted on it, because no human watches authority configs around the clock.

An agent can.

Failsafe is a watchdog agent for your Smart Account with exactly one permission: pull your funds back to safety. It watches pool health, depeg signals, authority upgrades, timelock changes, the whole class of signs that precede an exploit. First sign of trouble, it exits your position. It cannot trade, cannot send funds anywhere else, cannot do anything but bring your money home. That's the point of policies.

We start building Failsafe in August, as a paid layer on top of Earn.

## Quests

Earn works without holding anything, and that stays true. But we're designing a progression system on top: higher APY tiers and extra features you earn by doing things in the app or by staking [$LOYAL](https://x.com/search?q=%24LOYAL&src=cashtag_click). Alongside it, a referral program that pays you a share of the yield from the deposits you bring in.

Designing now, ships in Q3. We'll publish the exact tiers and numbers once they're final.

## One housekeeping note

The roadmap is moving off [askloyal.com](https://askloyal.com/) and into the docs because the site's job has changed. People landing there now are users deciding whether to deposit, and they need to see what Loyal does today. The full roadmap will live now at [docs.askloyal.com](https://docs.askloyal.com/) and gets updated as we ship.

## Monday

Also, on Monday we're putting a new proposal in front of the DAO. See you then.

Stay Loyal.

Website: [https://askloyal.com](https://askloyal.com/)  
Docs: [https://docs.askloyal.com](https://docs.askloyal.com/)  
Wallet (Telegram): [https://t.me/askloyal_tgbot](https://t.me/askloyal_tgbot)  
Chrome extension: [https://chromewebstore.google.com/detail/cdienfadefhlaknmedckgifkjdbioack](https://chromewebstore.google.com/detail/cdienfadefhlaknmedckgifkjdbioack)  
Community: [https://t.me/loyal_tgchat](https://t.me/loyal_tgchat)  
X: [https://x.com/loyal_hq](https://x.com/loyal_hq)  
Discord: [https://discord.com/invite/tAwXsXwTv6](https://discord.com/invite/tAwXsXwTv6)  
GitHub: [https://github.com/loyal-labs](https://github.com/loyal-labs)  
[$LOYAL](https://x.com/search?q=%24LOYAL&src=cashtag_click): [https://jup.ag/tokens/LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta](https://jup.ag/tokens/LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta)
