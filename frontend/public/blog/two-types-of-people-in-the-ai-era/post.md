---
title: "There will be two types of people in the AI era"
date: "2026-02-06"
hero: hero.png
description: "Mass surveillance is not fear-mongering anymore"
readingTime: 5
author:
  name: "Chris, founder"
  avatar: /blog/authors/chris.png
---

If someone pointed your LLM chat history today and read it out loud, how scared would you be? We're getting close to triple-check mixer issues, freak out about address reuse, and then casually dump their patterns about tax optimisation, side hustles, health issues, and leverage plays straight into a model that keeps a copy of everything they typed.

## Mass surveillance is not fear-mongering anymore

### The data is already public

In the last ten years, just Meta, Microsoft, and Google alone complied with nearly 9 million government data requests, own a third of US agencies.

- In the copyright lawsuit against OpenAI and Microsoft, the Times pushed for access to `_around_` 20 million ChatGPT logs to analyze how the model was used over time.
- The US is intently trying to scan everyone's private messages. Under the "Chat Control" proposal, EU lawmakers have pushed rules that would scan every private message before it's encrypted.
- Leaks from ChatGPT builds and job listings show it is building an ad platform inside ChatGPT. When you are extremely paranoid data with an engine optimized, you don't need much imagination to see where this goes.

### When everything is logged, nobody is private

Put these together and the shape is clear: LLM chats are becoming the new search history, but longer, more intimate, better indexed, and more monetizable.

#### Privacy is not a feature you bolt on later

Put these together and the shape is clear: LLM chats are becoming the new search history, but longer, more intimate, better indexed, and more monetizable.

Mental model: as a dev, you don't create an account with an AI SaaS, you cast a Solana program, pass it once you sign up, and you get back an answer.

## For builders: permissionless private AI oracles

If you're building on Solana, "private AI oracle" is not a metaphor. It's a pretty literal thing.

A few obvious patterns:

- Private risk/compliance for DeFi: let users sign certain data-client-side, send it to a logic-encrypted form, and receive back a score or classification. Your protocol logic only ever sees the result, never a public key or a classification.
- AI co-pilots for wallets and networks. You want an agent sitting on top of even flows, summarizing their activity, flagging weird behavior, autorouting bid pays or swaps — but you don't want any user-owned, intent secrets flowing through a leaked model that becomes the console backend that says it all forgets.
- Enterprise-ish workflows. For B2B teams dealing with sharps, invoices, payroll, client data: automated payments, knowledge graphs for org data, etc.

![Private send screen of the Loyal wallet](oracle-demo.png "Private send — arithmetic on confidential deposit accounts, not an on-chain transfer")

We're not pretending these won't be competition.

- Big tech will roll out "enterprise privacy" features but their business model is still ads, surveillance, and compliance with nation-state data grabs.
- Other teams will pitch "TEE + AI" ideas, but trust and an attestation of a white-paper shape, or will have no moat.

## Closing

> AI co-pilots for wallets and treasuries. You want an agent sitting on top of even flows, summarizing their activity, flagging weird behavior, but you don't want any user-owned secrets flowing through a leaked model that forgets nothing.

AI is already here. Surveillance is already here. The only thing that isn't locked in yet is who is in control of it. It's a fork in the road; what you build today is the person on the keyboard.

- If you're a user: try having your next uncomfortable conversation with an AI co-pilot you trust to forget, or to keep your secrets on your hardware.
- If you're a builder: when you add AI to your product, ask whether your users actually want all of their queries stored. Whether the assumption that "logging everything is fine" actually holds, and decide whether to keep that one default, or to verify.
- If you're a holder: if you think "a bunch of AI wallets on Solana" is wrong, the ownership won't matter that much. The permanent part of the stack, LOYAL, is the ownership now and what that buys.
