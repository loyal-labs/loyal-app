import Link from "next/link";

import type { BreadcrumbCopy, FaqItem, PageMeta } from "../types";

export const enAgents = {
  meta: {
    title: "Agent Wallet on Solana | Smart Accounts for AI Agents | Loyal",
    description:
      "Loyal is an agent wallet on Solana. Every wallet is a Smart Account with policies and spending caps, so your AI agents stay within bounds.",
    ogImageAlt: "Loyal Smart Accounts for AI Agents on Solana",
  } satisfies PageMeta,
  breadcrumb: { home: "Home", page: "Agents" } satisfies BreadcrumbCopy,
  // Block 1 — Hero (dark)
  hero: {
    title: "Smart Accounts for AI Agents",
    body: "Every wallet address in Loyal is a Smart Account with its own policies and spending caps, so your agents can't spend more or send funds somewhere you didn't approve.",
    cta: "Get started",
    imageAlt: "Loyal agent permission ladder with spending limit card",
  },
  // Block 2 — Section (why we built this)
  whyWeBuilt: {
    title: "Why we built this",
    cards: {
      problem:
        "AI agents are getting better at deciding what to do. They're worse at being trusted to do it with money. A trading bot might identify a good rebalance opportunity at 3am, but unless it can sign a transaction without your input, it can't act on it. A subscription agent can spot the API key you need to renew, but it can't pay for it. Today most agents are stuck at the recommend-but-don't-execute boundary.",
      solution: (
        <>
          The obvious fix is to give the agent a key. The obvious problem
          with that is that a key gives the agent unlimited authority over
          your entire wallet balance, any address, any contract, forever. A
          single jailbroken prompt drains the wallet.
          <br />
          <br />
          Loyal takes a different approach using{" "}
          <strong>on-chain policy enforcement</strong>: the agent gets a
          key, but the wallet it points at is a Smart Account that decides
          what the key can actually do. The policy lives in an Anchor
          program on Solana, not on a Loyal server, not in a config file
          the agent could rewrite.
        </>
      ),
    },
  },
  // Block 3 — Section (what an agent wallet on Loyal is)
  whatItIs: {
    title: "What an agent wallet on Loyal is",
    cards: {
      smartAccount: (
        <>
          Every Loyal wallet is a <strong>Smart Account</strong>: a
          Squads-based on-chain program that holds the funds and evaluates
          every transaction against a policy you set. When you onboard an
          agent, the agent gets its own sub-account with its own signing
          key, and you assign it a permission tier plus, optionally, a
          spending cap and an allowlist of approved destinations.
          <br />
          <br />
          The agent can sign transactions whenever it wants. The Smart
          Account decides whether to co-sign and let them land on Solana.
          If the transaction doesn&apos;t match the policy, it&apos;s
          rejected on-chain. There&apos;s no Loyal server in the loop that
          can be bribed or subverted; the rules live in Anchor programs.
        </>
      ),
      identity: (
        <>
          Each agent on Loyal also has a name and an avatar (Stash,
          Spotty, Buddy) so you can see at a glance which agent is holding
          what and which one is allowed to do what. These are defaults; you
          can rename them and add more.
        </>
      ),
    },
  },
  // Block 4 — Section-5 (three bold permission-tier cards)
  tiers: {
    title: "The three permission tiers",
    description:
      "You don't trust every agent the same way. Loyal's permission model has three levels, set per agent:",
    cards: {
      suggest: {
        title: "Can Suggest",
        body: "Propose a transaction. You sign each one. No autonomy, full visibility. Best for new agents you're evaluating and advisory bots.",
      },
      sign: {
        title: "Can Sign",
        body: "Co-sign alongside you. The transaction lands when both signatures are present. Best for high-value flows where you want the agent's signature and your approval.",
      },
      execute: {
        title: "Can Execute",
        body: "Sign autonomously within the spending cap and allowlist. Best for trusted agents on routine flows: subscriptions, micropayments, vetted strategies.",
      },
    },
  },
  // Block 5 — Section-7 (two muted cards: spending limits + allowlists)
  limits: {
    title: "Spending limits and allowlists",
    description: (
      <>
        Permission tier sets how an agent can transact. Spending limits and
        allowlists set what it can transact on.
        <br />
        <br />
        Together, permission tier plus spending limits plus address
        allowlists form the agent guardrails every transaction is checked
        against on-chain.
      </>
    ),
    cards: {
      cap: {
        title: "Spending cap",
        body: "A dollar amount per day, per week, or per month. The agent cannot exceed the cap, even with Can Execute. Caps reset on the schedule you set.",
      },
      allowlist: {
        title: "Address allowlist",
        body: "A list of pre-approved destinations: specific routers, payees, or contracts. Off-list destinations are rejected at the Smart Account layer.",
      },
    },
  },
  // Block 6 — Section-14 (muted grid: what you can build)
  build: {
    title: "What you can build",
    description:
      "With scoped, on-chain enforcement, entire categories of agent behavior become safe to deploy without supervision.",
    cards: {
      subscription: {
        title: "Subscription agents",
        body: "Autonomous bots paying for API credits, RPC endpoints, model inference. Can Execute with a monthly cap means a runaway agent can't drain the wallet.",
      },
      trading: {
        title: "Trading bots",
        body: "DEX-routing strategies. An allowlist limits the agent to vetted routers (Jupiter, Phoenix, Raydium) so it can't bridge funds to an attacker-controlled venue.",
      },
      social: {
        title: "Social and content bots",
        body: "Agents that tip, reward, or pay creators on Solana. The cap limits the monthly budget; the allowlist restricts to known creator addresses.",
      },
      mcp: {
        title: "MCP-driven assistants",
        body: "Claude, ChatGPT, or any MCP-connected assistant signing transactions on the user's behalf. The user defines the tier and the cap; the assistant operates within them.",
      },
      treasury: {
        title: "Treasury operations",
        body: (
          <>
            A DAO or team treasury that delegates routine payouts to an
            agent (payroll, vendor invoices) while keeping principal signers
            on the multisig. Can Sign is the natural fit. The same pattern
            routes idle reserves to a{" "}
            <Link
              className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
              href="/earn"
            >
              best-rate optimizer
            </Link>
            .
          </>
        ),
      },
      commerce: {
        title: "Commerce agents",
        body: "Checkout and payments agents that pay merchants or settle invoices on their own. Can Execute with a per-merchant allowlist and a monthly cap turns 'let the agent buy it' into a bounded, auditable action.",
      },
    },
  },
  // Block 7 — Section-16 (muted 2-col grid + closing: security model)
  security: {
    title: "Security model",
    description: "Every constraint is enforced on Solana, not on a Loyal server:",
    cards: {
      onChain: {
        title: "On-chain enforcement",
        body: (
          <>
            Permission tier, cap, and allowlist are all evaluated by the
            Smart Account&apos;s Anchor program before a transaction lands.
            <br />
            <br />
            There&apos;s no off-chain rule-checker that can be compromised.
          </>
        ),
      },
      squads: {
        title: "Squads underneath",
        body: (
          <>
            The Smart Account is a Squads multisig (the most-deployed
            smart-account framework on Solana) extended with a policy
            module.
            <br />
            <br />
            The signing model has been battle-tested across thousands of
            teams.
          </>
        ),
      },
      selfCustodial: {
        title: "Self-custodial",
        body: "Each agent holds its own signing key. You hold the Smart Account control key. Neither Loyal nor any third party can move funds without one of those keys.",
      },
      revocable: {
        title: "Revocable",
        body: "You can revoke an agent's permissions at any time from the wallet UI. The change takes effect on the next transaction.",
      },
      noHiddenExecution: {
        title: "No hidden execution",
        body: "Every action the agent takes is a regular Solana transaction with the agent's signature on it. Block explorers see exactly what happened.",
      },
    },
    closingStatement:
      "The result is a safe wallet for autonomous agent behavior at scale: every constraint is in code, on-chain, with no off-chain authority Loyal or anyone else can override.",
  },
  // Block 9 — Section-19 (image-left feature row: get started)
  getStarted: {
    title: "Get started",
    body: "Runs in the web app, browser extension, Telegram mini-app, and Android app, all backed by the same Squads Smart Account. Supported assets: USDC, SOL, USDT.",
    cta: "Get started",
    imageAlt: "Loyal browser extension wallet showing balance and tokens",
  },
  faqs: [
    {
      question: "What is an agent wallet?",
      answer:
        "An agent wallet is a self-custodial crypto wallet designed for an AI agent to operate autonomously. It holds funds and signs transactions on the agent's behalf, but is constrained by an on-chain Smart Account policy (permission tier, spending cap, address allowlist) so the agent cannot exceed the limits its user defined. Loyal is an agent wallet on Solana with these guardrails built in.",
    },
    {
      question: "What's a Smart Account in Loyal?",
      answer:
        "Every wallet address in Loyal is a Smart Account: a Squads-based on-chain program with its own policies and spending caps. Agents you authorize get sub-accounts with permission tiers; the Smart Account evaluates every transaction against the policy before it lands on Solana.",
    },
    {
      question: "How do the three permission tiers work?",
      answer:
        "Loyal has three permission tiers per agent: Can Suggest (agent proposes, you sign), Can Sign (agent co-signs alongside you), and Can Execute (agent signs autonomously within a spending cap and allowlist). Tiers are stackable across a fleet, so different agents can run on different tiers at the same time.",
    },
    {
      question: "Can the agent drain my wallet?",
      answer:
        "No, with a permission tier and a cap or allowlist set. Can Execute is gated by a spending cap per period and an address allowlist. With both active, the agent's worst case is a transfer up to the cap, to an address you already trust. Can Suggest and Can Sign require your signature for every transaction, so an agent on those tiers can't move funds without you.",
    },
    {
      question:
        "How does Loyal compare to MetaMask Advanced Permissions or Coinbase Agentic Wallets?",
      answer:
        "All three solve the same problem (scoped agent access without giving up the wallet) at different layers of the stack. Coinbase Agentic Wallets are wallet infrastructure for Base; MetaMask Advanced Permissions are an EVM standard (ERC-7715) implemented in the MetaMask Smart Accounts Kit. Loyal is a deployed self-custodial agent wallet on Solana with the same intent-based model, built on Squads smart accounts.",
    },
    {
      question:
        "How does Loyal compare to Crossmint, Privy, Turnkey, or Cobo for agent wallets?",
      answer:
        "Crossmint, Privy, Turnkey, and Cobo are wallet infrastructure for developers: embedded wallets, signer APIs, MPC custody, and policy engines that other teams compose into their own product. Loyal is a self-custodial agent wallet you use directly. Where those platforms sell the building blocks to teams shipping agent products, Loyal ships the assembled product on Solana, with Squads-based Smart Account policies (permission tiers, spending caps, address allowlists) in the box. If you're building a product, those infra platforms may fit. If you want an agent wallet to use, Loyal is one.",
    },
    {
      question: "Why Solana for AI agents?",
      answer:
        "Three reasons. Transaction cost: agents that spend often need micro-spends to stay economical, and Solana fees are sub-cent. Latency: Smart Account policy evaluation finishes in one slot (~400ms), fast enough that agent-driven UX doesn't feel laggy. Composability: Squads, Jupiter, Phoenix, Kamino, and most of the agent-relevant ecosystem are Solana-native, which is why we think the best wallet for AI agents on Solana looks more like Loyal than like a generic EVM smart account.",
    },
    {
      question: "Is the agent wallet self-custodial?",
      answer:
        "Yes. Each agent holds its own signing key. You hold the Smart Account control key. Neither Loyal nor any third party can move funds without one of those keys. The Smart Account is policy-enforcement code, not a custodian.",
    },
  ] satisfies FaqItem[],
};

export type AgentsDict = typeof enAgents;
