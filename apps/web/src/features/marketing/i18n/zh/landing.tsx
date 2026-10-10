import type { LandingDict } from "../en/landing";

export const zhLanding: LandingDict = {
  meta: {
    title: "Loyal：自动赚取收益的 Solana 钱包",
    description:
      "自托管 Solana 钱包，自动把你的稳定币分配到当前最优的收益来源。代理防护、私密转账、开源。",
    ogImageAlt: "Loyal：自动赚取稳定币收益的 Solana 钱包",
  },
  hero: {
    headline: "让闲置资金更聪明",
    subtitle: (
      <>
        只需连接一次钱包，你在 Solana 上的资金就会自动按当前最优利率
        <sup className="text-[0.65em]">
          <a
            aria-label="利率说明"
            className="no-underline"
            href="#rate-footnote"
          >
            1
          </a>
        </sup>
        赚取收益
      </>
    ),
    startEarning: "开始赚取收益",
    openWebApp: "打开网页应用",
    downloadLoyal: "下载 Loyal",
    phoneAlt:
      "Loyal Earn 界面，显示 9.48% APY、已开启 Autodeposit 和已赚取的 $822.66",
    animationAriaLabel:
      "Loyal 应用动画：连接钱包，看着余额增长，并设置 Autodeposit",
    moreInfo: "了解更多",
    // {label} is the stat label.
    loadingTemplate: "正在加载：{label}",
    statsAriaLabel: "Loyal 数据",
    stats: {
      aum: {
        label: "Earn 管理资产",
        tooltip: "存入当前生效的 Earn 分配策略的累计资金总额。",
      },
      volume: {
        label: "优化总量",
        tooltip:
          "由已确认的 Earn 优化重新分配的 USDC 总额。该指标衡量的是储备池之间的调度吞吐量，因此同一笔存入的资金在被后续优化再次调动时会重复计入总量。",
      },
      users: {
        label: "用户总数",
      },
    },
  },
  supportedBy: {
    title: "支持方",
  },
  features: {
    automation: {
      src: "/landing/figma/feature-automation-steps.png",
      alt: "三个步骤：连接钱包、设置 Autodeposit、赚取最优 APY",
      text: "体验强大的链上自动化，同时资金所有权始终归你",
    },
    earn: {
      alt: "手机上的 Loyal Earn 界面，显示已赚取 $192 和一条上升的收益曲线",
      text: "借助 Loyal 的自动化程序，让闲置资金始终拿到 Solana 上最优的低风险 APY",
    },
    actions: {
      src: "/landing/figma/feature-actions-pills.png",
      alt: "发送、接收和 Earn 按钮，以及一个已开启的“私密”开关",
      text: "连接任意钱包，在一个顺手的界面里完成所有操作",
    },
  },
  wallets: {
    title: "多个钱包，一个智能账户",
    startEarning: "开始赚取收益",
    howItWorks: "工作原理",
    phoneAnimationAriaLabel:
      "手机上的 Loyal 钱包：总余额、Earn 收益曲线、稳定币和加密资产持仓",
  },
  developers: {
    technology: {
      title: "了解 Loyal 背后最新的 Solana 技术",
      cta: "工作原理",
    },
    builders: {
      title: "面向开发者",
      cta: "探索 SDK",
    },
  },
  trust: {
    title: "你的资金由 Squads 保护",
    standard:
      "Squads 是 Solana 上的智能账户标准，450 多个团队用它保护着超过 150 亿美元的资产。Loyal 从不持有你的密钥。",
    automation:
      "在你自己的账户内，Earn 的自动化程序只能做两件事：向白名单内的 Kamino（Solana 上最大的借贷协议）储备池存入资金，以及从中提取资金。它最坏也只是选中一个较低的利率。自 2025 年 10 月以来，没有任何用户资金损失。",
    securedCta: "资金如何受到保护",
    risksCta: "Earn 的风险",
  },
  blog: {
    title: "团队最新动态",
  },
  getStarted: {
    title: "开始使用",
    platformAriaLabel: "选择平台",
    segments: {
      Web: "网页",
      Mobile: "手机",
      Extension: "扩展",
    },
    previews: {
      Web: { alt: "Loyal 网页应用钱包预览" },
      Mobile: { alt: "Loyal 移动应用钱包预览" },
      Extension: { alt: "Loyal 浏览器扩展钱包预览" },
    },
    openWebApp: "打开网页应用",
    comingSoon: "即将推出",
    seekerQrAriaLabel: "Seeker dApp Store 二维码",
    showSeekerQrAriaLabel: "显示 Seeker dApp Store 二维码",
    seekerQrTitle: "Loyal 在 Seeker dApp Store 的页面二维码",
    seekerOnly: "仅在 Seeker 上提供",
  },
};
