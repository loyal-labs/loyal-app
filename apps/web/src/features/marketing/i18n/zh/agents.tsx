import Link from "next/link";

import type { AgentsDict } from "../en/agents";

export const zhAgents: AgentsDict = {
  meta: {
    title: "Solana 上的代理钱包 | 面向 AI 代理的智能账户 | Loyal",
    description:
      "Loyal 是 Solana 上的代理钱包。每个钱包都是带有策略和支出上限的智能账户，让你的 AI 代理始终在边界之内行事。",
    ogImageAlt: "Loyal：Solana 上面向 AI 代理的智能账户",
  },
  breadcrumb: { home: "首页", page: "Agents" },
  // Block 1 — Hero (dark)
  hero: {
    title: "面向 AI 代理的智能账户",
    body: "Loyal 中的每一个钱包地址都是一个智能账户，有自己的策略和支出上限，所以你的代理既不能超额花费，也不能把资金发往你未批准的地方。",
    cta: "开始使用",
    imageAlt: "Loyal 代理权限阶梯，带有支出限额卡片",
  },
  // Block 2 — Section (why we built this)
  whyWeBuilt: {
    title: "我们为什么做这个",
    cards: {
      problem:
        "AI 代理越来越擅长决定该做什么，但在被信任用真金白银去做这件事上却差得多。一个交易机器人可能在凌晨三点发现一个不错的再平衡机会，但除非它能在没有你参与的情况下签名交易，否则它无法行动。一个订阅代理能发现你需要续费的 API 密钥，却付不了钱。今天大多数代理都卡在只能建议、不能执行的边界上。",
      solution: (
        <>
          显而易见的解决办法是给代理一把密钥。显而易见的问题是，这把密钥让代理对你整个钱包余额、任何地址、任何合约都拥有无限且永久的权限。一条被越狱的提示词就能掏空钱包。
          <br />
          <br />
          Loyal 采用了另一种方式：<strong>链上策略执行</strong>
          。代理拿到一把密钥，但这把密钥指向的钱包是一个智能账户，由它来决定这把密钥到底能做什么。策略存在于
          Solana 上的一个 Anchor 程序里，不在 Loyal
          的服务器上，也不在某个代理可以改写的配置文件里。
        </>
      ),
    },
  },
  // Block 3 — Section (what an agent wallet on Loyal is)
  whatItIs: {
    title: "Loyal 上的代理钱包是什么",
    cards: {
      smartAccount: (
        <>
          每一个 Loyal 钱包都是一个<strong>智能账户</strong>：一个基于 Squads
          的链上程序，持有资金并按照你设定的策略评估每一笔交易。当你接入一个代理时，代理会得到自己的子账户和自己的签名密钥，你为它分配一个权限等级，还可以选择设置支出上限和已批准目标地址的白名单。
          <br />
          <br />
          代理随时可以签名交易。智能账户则决定是否联合签名并让交易在 Solana
          上落地。如果交易不符合策略，就会在链上被拒绝。整个环节里没有可以被收买或颠覆的
          Loyal 服务器；规则存在于 Anchor 程序中。
        </>
      ),
      identity: (
        <>
          Loyal 上的每个代理还有自己的名字和头像（Stash、Spotty、Buddy），让你一眼就能看出哪个代理持有什么、哪个代理被允许做什么。这些只是默认设置；你可以重命名，也可以添加更多代理。
        </>
      ),
    },
  },
  // Block 4 — Section-5 (three bold permission-tier cards)
  tiers: {
    title: "三个权限等级",
    description:
      "你对每个代理的信任程度并不相同。Loyal 的权限模型分为三个等级，按代理逐个设置：",
    cards: {
      suggest: {
        title: "可建议（Can Suggest）",
        body: "提出一笔交易，每一笔都由你签名。没有自主权，完全可见。最适合你正在评估的新代理和顾问型机器人。",
      },
      sign: {
        title: "可签名（Can Sign）",
        body: "与你联合签名。两个签名都到位时交易才落地。最适合既需要代理签名又需要你批准的高价值流程。",
      },
      execute: {
        title: "可执行（Can Execute）",
        body: "在支出上限和白名单范围内自主签名。最适合处理例行流程的可信代理：订阅、小额支付、经过审核的策略。",
      },
    },
  },
  // Block 5 — Section-7 (two muted cards: spending limits + allowlists)
  limits: {
    title: "支出限额与地址白名单",
    description: (
      <>
        权限等级决定代理如何交易。支出限额和白名单决定它能对什么进行交易。
        <br />
        <br />
        权限等级、支出限额和地址白名单三者合在一起，构成了每一笔交易在链上都要对照检查的代理防护。
      </>
    ),
    cards: {
      cap: {
        title: "支出上限",
        body: "按日、按周或按月设定的美元金额。即使拥有可执行权限，代理也无法超出上限。上限按你设定的周期重置。",
      },
      allowlist: {
        title: "地址白名单",
        body: "一份预先批准的目标地址清单：特定的路由器、收款方或合约。名单之外的目标地址会在智能账户层被拒绝。",
      },
    },
  },
  // Block 6 — Section-14 (muted grid: what you can build)
  build: {
    title: "你可以构建什么",
    description:
      "有了限定范围的链上执行，整类代理行为都可以在无人监督的情况下安全部署。",
    cards: {
      subscription: {
        title: "订阅代理",
        body: "自主为 API 额度、RPC 端点、模型推理付费的机器人。可执行权限配上月度上限，意味着失控的代理也掏不空钱包。",
      },
      trading: {
        title: "交易机器人",
        body: "DEX 路由策略。白名单把代理限制在经过审核的路由器（Jupiter、Phoenix、Raydium）上，这样它就无法把资金桥接到攻击者控制的场所。",
      },
      social: {
        title: "社交与内容机器人",
        body: "在 Solana 上打赏、奖励或向创作者付款的代理。上限控制月度预算；白名单把目标限定在已知的创作者地址。",
      },
      mcp: {
        title: "由 MCP 驱动的助手",
        body: "Claude、ChatGPT 或任何通过 MCP 连接的助手代表用户签名交易。用户定义等级和上限；助手在其中运作。",
      },
      treasury: {
        title: "国库运营",
        body: (
          <>
            DAO 或团队国库把例行付款（工资、供应商账单）委托给代理，同时把主要签名人留在多签上。可签名权限是自然的选择。同样的模式还能把闲置储备分配给一个{" "}
            <Link
              className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
              href="/zh/earn"
            >
              最优利率优化器
            </Link>
            。
          </>
        ),
      },
      commerce: {
        title: "商务代理",
        body: "自行向商家付款或结算账单的结账与支付代理。可执行权限配上按商家设置的白名单和月度上限，就把“让代理去买”变成了一个有边界、可审计的动作。",
      },
    },
  },
  // Block 7 — Section-16 (muted 2-col grid + closing: security model)
  security: {
    title: "安全模型",
    description: "每一项约束都在 Solana 上执行，而不是在 Loyal 的服务器上：",
    cards: {
      onChain: {
        title: "链上执行",
        body: (
          <>
            权限等级、上限和白名单全部由智能账户的 Anchor
            程序在交易落地前评估。
            <br />
            <br />
            不存在可以被攻破的链下规则检查器。
          </>
        ),
      },
      squads: {
        title: "底层是 Squads",
        body: (
          <>
            智能账户是一个 Squads 多签（Solana
            上部署最多的智能账户框架），并扩展了一个策略模块。
            <br />
            <br />
            这套签名模型已经在数千个团队中经受过实战检验。
          </>
        ),
      },
      selfCustodial: {
        title: "自托管",
        body: "每个代理持有自己的签名密钥。你持有智能账户的控制密钥。没有这些密钥之一，Loyal 和任何第三方都无法动用资金。",
      },
      revocable: {
        title: "可撤销",
        body: "你可以随时在钱包界面撤销某个代理的权限。更改在下一笔交易时生效。",
      },
      noHiddenExecution: {
        title: "没有隐藏的执行",
        body: "代理采取的每一个动作都是一笔带有代理签名的普通 Solana 交易。区块浏览器能看到发生的一切。",
      },
    },
    closingStatement:
      "结果是一个能让自主代理行为安全地规模化的钱包：每一项约束都写在代码里、在链上，没有任何 Loyal 或其他人可以凌驾其上的链下权限。",
  },
  // Block 9 — Section-19 (image-left feature row: get started)
  getStarted: {
    title: "开始使用",
    body: "可在网页应用、浏览器扩展、Telegram 小程序和 Android 应用中运行，全部基于同一个 Squads 智能账户。支持的资产：USDC、SOL、USDT。",
    cta: "开始使用",
    imageAlt: "Loyal 浏览器扩展钱包，显示余额和代币",
  },
  faqs: [
    {
      question: "什么是代理钱包？",
      answer:
        "代理钱包是专为 AI 代理自主运作而设计的自托管加密钱包。它持有资金并代表代理签名交易，但受到链上智能账户策略（权限等级、支出上限、地址白名单）的约束，所以代理无法超出用户设定的限制。Loyal 是 Solana 上内置这些防护的代理钱包。",
    },
    {
      question: "Loyal 中的智能账户是什么？",
      answer:
        "Loyal 中的每一个钱包地址都是一个智能账户：一个基于 Squads 的链上程序，有自己的策略和支出上限。你授权的代理会得到带有权限等级的子账户；智能账户会在每一笔交易在 Solana 上落地之前，按照策略对它进行评估。",
    },
    {
      question: "三个权限等级是如何运作的？",
      answer:
        "Loyal 为每个代理提供三个权限等级：可建议（代理提议，你签名）、可签名（代理与你联合签名）和可执行（代理在支出上限和白名单范围内自主签名）。等级可以在一组代理中叠加使用，所以不同的代理可以同时运行在不同的等级上。",
    },
    {
      question: "代理会掏空我的钱包吗？",
      answer:
        "不会，只要设置了权限等级，并配上上限或白名单。可执行权限受每周期支出上限和地址白名单的限制。两者都启用时，代理最坏的情况就是向你已经信任的地址转账不超过上限的金额。可建议和可签名权限的每一笔交易都需要你的签名，所以这些等级上的代理没有你就无法动用资金。",
    },
    {
      question:
        "Loyal 与 MetaMask Advanced Permissions 或 Coinbase Agentic Wallets 相比如何？",
      answer:
        "三者解决的是同一个问题（在不交出钱包的前提下给代理限定范围的访问权限），只是处在技术栈的不同层面。Coinbase Agentic Wallets 是面向 Base 的钱包基础设施；MetaMask Advanced Permissions 是在 MetaMask Smart Accounts Kit 中实现的 EVM 标准（ERC-7715）。Loyal 是已经部署在 Solana 上的自托管代理钱包，采用同样基于意图的模型，构建在 Squads 智能账户之上。",
    },
    {
      question: "在代理钱包方面，Loyal 与 Crossmint、Privy、Turnkey 或 Cobo 相比如何？",
      answer:
        "Crossmint、Privy、Turnkey 和 Cobo 是面向开发者的钱包基础设施：嵌入式钱包、签名 API、MPC 托管和策略引擎，供其他团队组合进自己的产品。Loyal 是你可以直接使用的自托管代理钱包。那些平台把积木卖给正在开发代理产品的团队，而 Loyal 在 Solana 上交付的是组装好的产品，开箱就带有基于 Squads 的智能账户策略（权限等级、支出上限、地址白名单）。如果你在开发产品，那些基础设施平台可能更合适。如果你想要一个可以直接用的代理钱包，Loyal 就是。",
    },
    {
      question: "为什么 AI 代理要选 Solana？",
      answer:
        "三个原因。交易成本：频繁支出的代理需要小额支付也划算，而 Solana 的手续费不到一美分。延迟：智能账户的策略评估在一个 slot（约 400 毫秒）内完成，快到代理驱动的体验不会显得卡顿。可组合性：Squads、Jupiter、Phoenix、Kamino 以及大部分与代理相关的生态都是 Solana 原生的，这也是为什么我们认为 Solana 上最好的 AI 代理钱包看起来更像 Loyal，而不是一个通用的 EVM 智能账户。",
    },
    {
      question: "代理钱包是自托管的吗？",
      answer:
        "是的。每个代理持有自己的签名密钥。你持有智能账户的控制密钥。没有这些密钥之一，Loyal 和任何第三方都无法动用资金。智能账户是策略执行代码，不是托管方。",
    },
  ],
};
