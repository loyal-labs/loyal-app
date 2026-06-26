---
title: "How Loyal uses Nillion for user-owned data storage"
date: "2025-11-07"
hero: hero.png
description: "When we see private AI, we see promises of shredded logs or “prompts deleted after use”."
author:
  name: "Rodion, founder"
---
When we see private AI, we see promises of shredded logs or “prompts deleted after use”. However, if we want to reach truly private intelligence the very architecture of the network should make the data impossible to be viewed or repurposed by anyone except the user. That’s what Loyal is building: a private intelligence network where you retain the ownership of the data.

One of the key tech here solutions is nilDB, Nillion’s encrypted, secret-sharing database module. Loyal uses nilDB so that user data and AI interactions are encrypted end to end and only you decrypt and use them. Neither Loyal nor Nillion can access the data by design.

## The problem we address

Most AI assistants, chatbots or “intelligence” layers treat user history like logs. Prompts, responses and model memory are stored the same way as usual. That means exposure to training reuse, subpoena risk and especially platform lock-in which is so common that we don’t even question it.

But what if your chat history and memory can be stored independently from the service you use and transferred between different models and agents, while not being loggable by the provider or third parties? What if that memory is portable, revocable, and under your wallet’s control? That’s the architecture we pursue.

## Loyal’s architecture overview

Loyal routes each user request into a chain-anchored session: your wallet ties you to a session via a Solana PDA (Program Derived Address). Each request executes inside an attested confidential VM, so the inference can’t be tampered with, and logs can’t be extracted by the compute provider. When it comes to storing that data, instead of writing everything to a central database, Loyal writes the prompt and response into a decentralized storage controlled by the user's Solana wallet.

**For the end user this architecture allows:**

- Full ownership of the chat history/memory.

- Compute provider/agent can’t extract your logs and sensitive data.

- Seamlessly transfer the history between different models and compute providers

- Transfer the history between different apps/UIs that use Loyal’s backend

## Nillion nilDB

Nillion’s mission is to decentralise trust for sensitive data in the same way blockchains decentralised transactions.  Its “Blind Modules” make it possible to store and compute on data while keeping it encrypted (or split into secret-shares) so that no single node or service has full access.

nilDB is the private storage module within this stack: a structured data persistence service where you can define collections with schemas, mark sensitive fields, encrypt them end-to-end or secret-share them across nodes, and retain analytic or query capabilities without exposing it in plaintext. Loyal’s implementation derives encryption keys from the user's solana wallet and the backend never holds them.

## How Loyal uses nilDB: request → response → user-controlled memory

Let’s follow a typical interaction inside Loyal’s stack:

A user sends a request (e.g., “What’s my next quarter’s hiring plan?”). Loyal writes that request into nilDB. Because fields may include sensitive metadata (user ID, session context, business specifics), those go into the user-owned-collection.

The request is forwarded through Loyal’s TEE-anchored inference path. The model returns an answer. Loyal writes the answer into nilDB too. Sensitive parts again go into the encrypted user-owned fields. The full transcript is saved but under encryption and user control.

At no point is the full plaintext transcript held in a central unencrypted log. The data remains privately yours, even though it’s stored and can be searched or used for context. Because Loyal writes both prompt and response into nilDB, your agent can build memory over time — but you remain the gate-keeper.

## Developer and implementation angle

From a builder’s perspective, the stack looks like this: define a collection in nilDB with a JSON schema, mark which fields are sensitive (encrypted / secret-share) and which can be plain (non-sensitive metadata). Use Nillion’s REST API or SDK to write data: authenticate via DID-JWT, issue writes and queries.

The user’s decryption key resides with them (derived from wallet private key), so Loyal cannot view the encrypted fields. Loyal orchestrates the inference, but the memory store sits on nilDB in a way that respects user ownership. When a session ends, the user can export or delete their data.

## Why we chose to go this way

There are three big implications. First: True data ownership. The user owns their memory and conversations and the provider cannot introspect or reuse them unilaterally. Second: Privacy by design. Rather than a promise (“we won’t look”), the architecture makes it impossible for logs to exist in plain form. Third: Intelligence with context. Because Loyal preserves memory in nilDB, your agent can get smarter over time and you get the benefit of continuity and personalization, but not the risk of unmanaged logs.

## Conclusion

If you believe that intelligence should serve you, not log you, then Loyal’s architecture built on nilDB is worth watching closely. It shows how a private, on-chain intelligence network becomes feasible: not just by promising privacy, but by architecting for it. The memory is yours. The compute is verifiable. The storage is encrypted, user-keyed, and under your control.

Build today.
Visit Loyal

[website ](https://askloyal.com/)

and

[docs](https://docs.askloyal.com/)

.
Sign up for open testing in the

[Loyal community](https://tr.ee/4PzO0_KgFk)

.
Buy

[$LOYAL](https://jup.ag/tokens/LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta)

ownership token.
Check

[Nillion docs](https://docs.nillion.com/build/private-storage/overview)

.
