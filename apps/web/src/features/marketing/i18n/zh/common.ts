import type { CommonDict } from "../en/common";

export const zhCommon: CommonDict = {
  header: {
    homeAriaLabel: "Loyal 首页",
    mainNavAriaLabel: "主导航",
    mobileNavAriaLabel: "移动端导航",
    openMenuAriaLabel: "打开菜单",
    closeMenuAriaLabel: "关闭菜单",
    nav: {
      features: "功能",
      developers: "开发者",
      blog: "博客",
      links: "链接",
    },
    features: {
      earn: {
        title: "Earn",
        description: "Solana 上最优的稳定币收益",
      },
      agents: {
        title: "Agents",
        description: "面向 AI 代理的智能账户",
      },
    },
    noPages: "暂无营销页面。",
    startEarning: "开始赚取收益",
    openApp: "打开应用",
  },
  languageSwitch: { ariaLabel: "语言" },
  footer: {
    homeAriaLabel: "Loyal 首页",
    columns: {
      documentation: {
        title: "文档",
        smartAccounts: "智能账户",
      },
      legal: {
        title: "法律信息",
        privacyPolicy: "隐私政策（英文）",
        trust: "信任与安全",
        risks: "风险",
        transparency: "透明度",
      },
      contact: { title: "联系我们" },
    },
    rateFootnote:
      "以资金分配时受支持协议中可用的利率为准。利率随时变动，不作任何保证。",
    copyright: "© 2026 Loyal。保留所有权利。",
    statusBadgeTitle: "Loyal 状态标识",
    wordmarkAlt: "Loyal",
  },
  faq: {
    heading: ["有疑问？", "看这里。"],
    items: [
      {
        question: "Loyal 是什么？",
        answer:
          "Loyal 是一款让你的资金自动生息的 Solana 自托管钱包。闲置的稳定币会自动按当前最优的借贷利率赚取收益，而且每个钱包都是带有策略和支出上限的智能账户，所以应用和代理永远无法动用你未批准的资金。",
      },
      {
        question: "Autodeposit（自动存入）是如何运作的？",
        answer:
          "存入美元稳定币，设定其中多大比例用于赚取收益。Loyal 会把这部分资金分配到当前利率最高的可靠借贷储备池，并在利率变化时重新分配。整个自动化程序通过你自己智能账户上的链上策略运行，从不托管你的资金，你随时可以提取。",
      },
      {
        question: "Loyal 安全吗？有哪些风险？",
        answer:
          "Loyal Earn 承担的是向 Kamino（Solana 上最大的借贷协议）供应稳定币的风险：储备池出现漏洞、坏账，或者稳定币脱锚。你的资金始终留在自己的 Squads 智能账户里，链上策略只允许自动化程序从白名单内的 Kamino 储备池提取资金或向其存入资金，所以它最坏也只是选中一个较低的利率。自 2025 年 10 月以来，没有任何用户资金损失。完整的风险说明见 askloyal.com/zh/risks。",
      },
      {
        question: "Loyal 有自己的智能合约吗？",
        answer:
          "目前 Loyal Earn 没有。Earn 运行在 Squads 智能账户程序和 Kamino K-Lend 之上，两者都经过 OtterSec 审计。Loyal 自己的代码是链下的自动化程序和各个应用，它们全部开源，并且受链上策略约束。",
      },
      {
        question: "Loyal 经过审计吗？",
        answer:
          "Loyal Earn 没有自己的审计，因为它没有自己的智能合约可供审计。安全审计审查的是链上程序代码，而 Earn 没有部署任何链上程序。你的资金存放在 Squads 智能账户程序中，并在 Kamino K-Lend 中赚取收益，两者都经过 OtterSec 审计。Loyal 在此之上增加的是一份策略：它是存储在你 Squads 账户中的配置，由经过审计的 Squads 程序强制执行，其中列出了自动化程序可以调用的两条指令（存入和提取），以及可以调用这两条指令的 Kamino 储备池。任何人都可以在链上读取这份策略。Loyal 的链下自动化程序是开源的，但未经审计，不过它只能提交策略允许的交易，所以即使其中存在漏洞，也无法把资金转出你的账户。",
      },
      {
        question: "如何使用 Loyal？",
        answer:
          "从浏览器扩展、网页应用或移动应用开始：创建钱包，开启收益功能，然后只授予每个应用或代理所需的权限。",
      },
      {
        question: "可以创建多个钱包吗？",
        answer:
          "可以。你可以在一个智能账户下保留多个钱包，并按用途分开管理余额、应用、代理和权限。",
      },
      {
        question: "如何把 Loyal 钱包连接到其他应用？",
        answer:
          "通过 Loyal 的 Chrome 扩展连接，或者使用你熟悉的支持 Solana 的钱包：Phantom、Solflare、Backpack、Trust Wallet 或 Ledger。你可以为每个应用单独设定它能做什么：签名、支出（以及额度）、发送交易。",
      },
      {
        question: "什么是智能账户？",
        answer:
          "智能账户是可编程的钱包，能够在交易签名或执行之前强制执行规则，例如额度限制、允许的目标地址和代理权限。",
      },
      {
        question: "可以把现有钱包导入 Loyal 吗？",
        answer:
          "可以。现有钱包可以导入 Loyal。导入的密钥与智能账户的委托权限会分开存放。",
      },
      {
        question: "可以跨设备、跨平台使用 Loyal 吗？",
        answer:
          "可以。Loyal 可在浏览器扩展、网页端和手机上运行，同一套账户模型在你的所有设备上都可用。",
      },
    ],
  },
};
