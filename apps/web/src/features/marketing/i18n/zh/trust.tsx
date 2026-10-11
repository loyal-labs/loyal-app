import Link from "next/link";

import { TRUST_LINK_CLASS } from "../../pages/trust-page";
import type { TrustDict } from "../en/trust";

export const zhTrust: TrustDict = {
  meta: {
    title: "信任与安全 | Loyal",
    description:
      "Loyal 在架构上就是非托管的。你的账户是 Squads 智能账户，收益来自 Kamino，无论 Loyal 是否还在运营，你的资金都会继续工作。",
    ogImageAlt: "Loyal 的信任与安全",
  },
  breadcrumb: { home: "首页", page: "信任" },
  hero: {
    title: "你的资金不依赖 Loyal",
    body: "密钥始终在你手里。你的账户是 Squads 智能账户，收益来自 Kamino（Solana 上最大的借贷协议），这些基础设施在 Solana 上保护着数十亿美元的资产。无论我们是否还在运营，一切都会照常运转。",
    cta: "打开钱包",
    imageAlt: "Loyal 浏览器扩展钱包，显示账户余额",
  },
  secures: {
    title: "是什么在保护你的资金",
    description: (
      <>
        你和你的资金之间，大部分环节都是已经在 Solana
        上保护着数十亿美元的基础设施。至于仍然可能出错的地方，请看{" "}
        <Link className={TRUST_LINK_CLASS} href="/zh/risks">
          Earn 的风险
        </Link>
        。
      </>
    ),
    cards: {
      squads: {
        title: "Squads",
        body: "你的账户运行在 Squads 智能账户程序上。它是开源的，经过 OtterSec 审计，也是 Solana 上使用最广泛的智能账户标准。",
      },
      kamino: {
        title: "Kamino",
        body: "收益来自 Kamino 的借贷金库，Phantom 和 Anchorage 也把资金路由到同一套基础设施。",
      },
      nonCustodial: {
        title: "非托管",
        body: "Loyal 从不持有你的私钥，对你的账户也没有任何签名权限。",
      },
      policy: {
        title: "链上策略",
        body: "支出上限、代币白名单和允许调用的程序都由 Squads 程序强制执行，而不是由我们的服务器。",
      },
    },
  },
  noLockIn: {
    title: "没有锁定",
    body: (
      <>
        你的智能账户存在于 Squads 程序上。它不依赖我们的前端、我们的 API
        或我们的许可。任何 Solana 客户端都能访问它，包括你自己电脑上的命令行工具。
      </>
    ),
    cta: "如果 Loyal 消失了会怎样",
    ctaHref: "/zh/risks",
    imageAlt: "Loyal SDK 快速入门，展示与链上程序交互的客户端库",
  },
  verify: {
    title: "亲自验证",
    description: (
      <>
        Loyal 写的所有代码都以 AGPL-3.0 协议开源：钱包、扩展、SDK
        和自动化程序。你可以阅读代码、自己构建，或者整个分叉出去。状态保存在链上，所以分叉版本与其他一切依然兼容。
      </>
    ),
    cards: {
      accounts: {
        title: "智能账户",
        body: "运行在 Solana 主网上，基于经过审计的 Squads 智能账户程序。",
      },
      clients: {
        title: "开源客户端",
        body: "钱包、扩展和 SDK 都是公开仓库，你可以自己构建并运行。",
      },
    },
    closing: (
      <>
        每一行代码都在{" "}
        <Link className={TRUST_LINK_CLASS} href="https://github.com/loyal-labs">
          github.com/loyal-labs
        </Link>
        。
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
              className={TRUST_LINK_CLASS}
              href="https://stats.askloyal.com"
            >
              stats.askloyal.com
            </Link>{" "}
            实时更新。
          </>
        ),
      },
      reports: {
        title: "季度透明度报告",
        body: (
          <>
            自 2025 年第四季度起每季度发布，包含国库地址和余额。{" "}
            <Link
              className={TRUST_LINK_CLASS}
              href="https://docs.askloyal.com/transparency/q2-2026"
            >
              阅读最新一期
            </Link>
            。
          </>
        ),
      },
    },
  },
  onTheRecord: {
    title: "公开记录",
    description:
      "Loyal 披露的信息超出了义务范围，而且披露的地方都可以由我们以外的人核实。",
    cards: {
      blockworks: {
        title: "Blockworks B2 披露",
        body: (
          <>
            与 Jupiter、dYdX 和 Morpho 一起，成为完成 B2 透明度披露的 35
            个协议之一。2026 年上半年的披露已提交并保持最新。{" "}
            <Link
              className={TRUST_LINK_CLASS}
              href="https://blockworks.com/token-transparency/filing/loyal/loyal-2026-h1-b2-v1.0"
            >
              阅读披露文件
            </Link>
            。
          </>
        ),
      },
      metadao: {
        title: "MetaDAO",
        body: (
          <>
            2025 年 10 月的 ICO 以 250 万美元为目标，吸引了 7,590
            万美元的认购，超额约 30 倍。国库由 futarchy（预测市场治理）管理，而不是由创始人钱包管理。{" "}
            <Link
              className={TRUST_LINK_CLASS}
              href="https://www.metadao.fi/projects/loyal/fundraise"
            >
              查看募资详情
            </Link>
            。
          </>
        ),
      },
    },
    closing: "此外，Solana Mobile 将 Loyal 收录进 Seeker Summer 精选，Superteam 也为其提供支持。",
  },
};
