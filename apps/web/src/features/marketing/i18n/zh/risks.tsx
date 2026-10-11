import Link from "next/link";

import { RISKS_LINK_CLASS } from "../../pages/risks-page";
import type { RisksDict } from "../en/risks";

export const zhRisks: RisksDict = {
  meta: {
    title: "Loyal Earn 的风险 | Loyal",
    description:
      "Loyal Earn 存款可能亏损的每一种方式，自动化程序被允许做什么，以及不能做什么。Earn 从你自己的 Squads 智能账户出发，把你的稳定币借出到 Kamino。",
    ogImageAlt: "Loyal Earn 的风险",
  },
  breadcrumb: { home: "首页", page: "风险" },
  legalNotice:
    "本页面为译文。如中文版与英文版有出入，以英文版为准。",
  hero: {
    title: "Loyal Earn 的风险，说得明白些",
    body: "Earn 从你自己的 Squads 智能账户出发，把你的稳定币借出到 Kamino（Solana 上最大的借贷协议）。本页列出了这件事可能亏钱的每一种方式、自动化程序被允许做什么，以及它不能做什么。",
    cta: "打开钱包",
    imageAlt: "Loyal 浏览器扩展钱包，显示账户余额",
  },
  automation: {
    title: "自动化程序能做什么",
    description:
      "Squads 程序会对照你的策略检查每一笔交易，并拒绝策略之外的一切。Earn 的策略只允许两条指令。",
    cards: {
      withdraw: {
        title: "从白名单 Kamino 储备池提取",
        body: "只能从五个已批准的 Kamino 市场提取，只能是你存入的那种稳定币，而且只能提回你自己的智能账户。",
      },
      deposit: {
        title: "存入白名单 Kamino 储备池",
        body: "纯粹的供应，所有者是你的智能账户。策略不允许借款，所以没有杠杆，也没有任何可被清算的东西。",
      },
      blocked: {
        title: "其他一切都被禁止",
        body: "它不能把资金发往其他地址、不能换成其他代币、不能借款、不能触碰任何其他程序，也不能改写自己的策略。",
      },
      keys: {
        title: "你的密钥从不离开你",
        body: "Loyal 从不持有你的私钥。只有你的密钥才能把你的余额提取到另一个钱包。",
      },
    },
  },
  riskTable: {
    title: "风险在哪里",
    description:
      "你的存款经过的每一层、那里可能出什么问题，以及影响范围能有多大。",
  },
  compareTable: {
    title: "与其他选择的比较",
    description:
      "Earn 的借贷风险与直接向 Kamino 供应资金相同。区别在于托管方式、利率和历史记录。",
  },
  table: {
    risk: {
      layer: "层级",
      failure: "可能出什么问题",
      containment: "影响范围",
    },
    compare: {
      property: "属性",
      loyal: "Loyal Earn",
      kamino: "直接使用 Kamino",
      aave: "Aave，仅供应",
      exchange: "交易所理财产品",
    },
  },
  markets: {
    title: "Earn 使用的五个市场",
    description:
      "Kamino 的各个市场是相互隔离的。一个市场中的出借方只暴露于该市场接受的抵押品，与其他市场无关。",
    cards: {
      whitelisted: {
        title: "白名单市场",
        body: "Kamino Main、Figure、Maple、OnRe 和 Ethena。市场参数、抵押品和利用率在 Kamino 上都是公开的。",
      },
      noQuiet: {
        title: "不会悄悄加入风险更高的市场",
        body: "白名单存在于你的链上策略里。新增一个市场意味着一份新的策略，而那需要你的批准。",
      },
    },
    closing: (
      <>
        你可以在{" "}
        <Link className={RISKS_LINK_CLASS} href="https://kamino.finance">
          kamino.finance
        </Link>{" "}
        上亲自核查这些市场。
      </>
    ),
  },
  trackRecord: {
    title: "历史记录",
    description: "可以查证的数字，而不是只能凭信任接受的说法。",
    cards: {
      incidents: {
        title: "零事故",
        body: "自 2025 年 10 月上线以来，没有任何用户资金损失。",
      },
      aum: {
        title: "实时管理资产",
        body: (
          <>
            在{" "}
            <Link
              className={RISKS_LINK_CLASS}
              href="https://stats.askloyal.com"
            >
              stats.askloyal.com
            </Link>{" "}
            实时更新。
          </>
        ),
      },
      audits: {
        title: "审计",
        body: (
          <>
            Earn 没有自己的合约可供审计。持有并出借你资金的 Squads 智能账户和
            Kamino K-Lend 都经过 OtterSec 评估。{" "}
            <Link
              className={RISKS_LINK_CLASS}
              href="https://docs.askloyal.com/trust/audits-and-deployments"
            >
              查看审计报告
            </Link>
            。
          </>
        ),
      },
    },
  },
  // Every layer a Loyal Earn deposit touches, in the order money flows through
  // them. Keep this in sync with the Earn policy in packages/loyal-actions.
  riskRows: [
    {
      layer: "Kamino 借贷储备池",
      failure:
        "智能合约漏洞，或者当该市场中某个借款方的抵押品失效且清算不足以覆盖贷款时产生坏账。当一个储备池被完全借空时，提取需要等待流动性回流。",
      containment:
        "Earn 只使用五个相互隔离的 Kamino 市场。一个市场出问题不会波及另一个市场中的存款。与你自己向 Kamino 供应资金的风险相同。",
    },
    {
      layer: "你存入的稳定币",
      failure: "该稳定币脱锚，或者发行方冻结了它。",
      containment:
        "Earn 让你的资金始终以你存入的那种稳定币存放，不会把你换成其他美元稳定币。",
    },
    {
      layer: "Squads 智能账户程序",
      failure: "持有你的账户并执行策略的程序出现漏洞。",
      containment:
        "经过 OtterSec 审计，在整个 Solana 上被广泛使用。Loyal 不对它做任何修改。",
    },
    {
      layer: "Loyal 的自动化程序",
      failure:
        "它选中了一个利率较低的储备池，或者在 Loyal 的服务器宕机时停止再平衡。",
      containment:
        "最坏的情况是利率偏低。链上策略只允许它从白名单 Kamino 储备池提取资金或向其存入资金，而且两边的所有者都是你的账户。",
    },
    {
      layer: "Loyal 这家公司",
      failure: "Loyal 停止运营。",
      containment:
        "你的资金留在你的智能账户里。任何 Solana 客户端（包括命令行工具）都能把它们提取出来。",
    },
  ],
  compareRows: [
    {
      label: "谁持有资金",
      loyal: "你，在你自己的智能账户里",
      kamino: "你",
      aave: "你",
      exchange: "交易所",
    },
    {
      label: "借贷合约风险",
      loyal: "Kamino",
      kamino: "Kamino",
      aave: "Aave",
      exchange: "交易所使用的任何东西，不公开",
    },
    {
      label: "杠杆或清算",
      loyal: "无，仅供应",
      kamino: "只供应则无",
      aave: "不借款则无",
      exchange: "视产品而定",
    },
    {
      label: "额外的一层",
      loyal: "受链上策略约束的自动化程序",
      kamino: "无",
      aave: "无",
      exchange: "交易所的偿付能力和提现限制",
    },
    {
      label: "利率",
      loyal: "白名单内最优的储备池，自动再平衡",
      kamino: "你自己选的那一个储备池",
      aave: "你自己选的那一个市场",
      exchange: "由交易所设定",
    },
    {
      label: "上线时间",
      loyal: "2025 年 10 月",
      kamino: "2023 年",
      aave: "2020 年",
      exchange: "各不相同",
    },
  ],
  faqs: [
    {
      question: "Loyal Earn 安全吗？",
      answer:
        "Loyal Earn 承担的是向 Kamino 供应稳定币的风险，外加一层受约束的自动化。你的资金留在你自己的 Squads 智能账户里，链上策略只允许自动化程序做两件事：从白名单 Kamino 储备池提取资金，以及向其存入资金。剩下的风险是 Kamino 储备池出问题、稳定币脱锚，以及 Squads 程序出现漏洞。自 2025 年 10 月上线以来，没有任何用户资金损失。",
    },
    {
      question: "Loyal 有自己的智能合约吗？",
      answer:
        "目前 Loyal Earn 没有。Earn 运行在两个经过外部审计的程序上：持有你的账户并执行策略的 Squads 智能账户程序，以及支付收益的 Kamino K-Lend。Loyal 自己的代码是链下的自动化程序和各个应用，它们全部开源。",
    },
    {
      question: "Loyal 的自动化程序最坏能做什么？",
      answer:
        "把你的存款调度到一个利率较低的白名单储备池，或者在 Loyal 的服务器宕机时停止再平衡。它不能把资金转出你的智能账户、不能借款、不能换成其他代币，也不能更改自己的策略，因为 Squads 程序会拒绝任何策略之外的交易。",
    },
    {
      question: "Loyal Earn 比我自己存入 Kamino 风险更高吗？",
      answer:
        "借贷风险是一样的，因为你的稳定币存放在同样的 Kamino 储备池里。Earn 增加了一层自动化，它只能在你自己账户内的白名单储备池之间调动资金。作为交换，你无需自己盯着利率，就能待在利率最高的储备池里。",
    },
    {
      question: "我随时都能提取吗？",
      answer:
        "没有锁定期，你随时可以提取。唯一的限制来自 Kamino：如果某个储备池被完全借空，从它提取就要等借款方还款或新存款到来。这对该储备池里的每一位出借方都适用，不只是 Loyal 用户。",
    },
    {
      question: "Loyal 经过审计吗？",
      answer:
        "Loyal Earn 没有自己的审计，因为它没有自己的智能合约可供审计。安全审计审查的是链上程序代码，而 Earn 没有部署任何链上程序。你的资金存放在 Squads 智能账户程序中，并在 Kamino K-Lend 中赚取收益，两者都经过 OtterSec 审计。Loyal 在此之上增加的是一份策略：它是存储在你 Squads 账户中的配置，由经过审计的 Squads 程序强制执行，其中列出了自动化程序可以调用的两条指令（存入和提取），以及可以调用这两条指令的 Kamino 储备池。任何人都可以在链上读取这份策略。Loyal 的链下自动化程序是开源的，但未经审计，不过它只能提交策略允许的交易，所以即使其中存在漏洞，也无法把资金转出你的账户。",
    },
    {
      question: "Loyal 能防范 Kamino 被攻击吗？",
      answer:
        "目前还不能自动防范。Loyal Watchdog 正在与 Webacy 联合开发，它将监控所连接协议的健康度下降和被黑信号，并通过白名单策略把资金撤回到你自己的账户。在它上线之前，Kamino 遭到攻击对 Earn 存款的影响与对任何 Kamino 出借方的影响相同。",
    },
  ],
};
