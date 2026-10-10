import Link from "next/link";

import type { EarnDict } from "../en/earn";

export const zhEarn: EarnDict = {
  meta: {
    title: "Solana 上最优的稳定币收益 | Loyal",
    description:
      "Loyal 在链上策略的约束下，把你的稳定币分配到 Solana 上利率最高的借贷储备池，让你在不放弃资金控制权的前提下拿到当前最优的利率。",
    ogImageAlt: "Loyal 自动赚取 Solana 上最优的稳定币收益",
  },
  breadcrumb: { home: "首页", page: "Earn" },
  // Block 1 — Hero (dark)
  hero: {
    title: "自动赚取 Solana 上最优的稳定币收益",
    body: "Solana 上的借贷利率时刻在变。Loyal 会把你的美元稳定币分配到当前利率最高的可靠借贷储备池，整个过程受链上策略约束，所以你既能拿到当前最优的利率，又不用放弃资金控制权。你只需存入资金，设定其中多大比例用于赚取收益，剩下的交给它。",
    cta: "打开钱包",
    imageAlt:
      "Loyal 优化器把资金分配到 Solana 上利率最高的 Kamino 借贷储备池",
  },
  // Block 2 — Section: How your dollars earn with Loyal
  howItEarns: {
    title: "你的资金如何在 Loyal 赚取收益",
    description: "存入资金，让优化器负责轮换。",
    cards: {
      optimized: (
        <>
          <strong>持续优化：让你的资金赚到它能赚到的最多收益。</strong>{" "}
          把资金交给优化器，一个{" "}
          <Link
            className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
            href="/zh/agents"
          >
            代理
          </Link>{" "}
          会持续把你的资金转移到利率最高的储备池，而不是让它躺在一个池子里不动。
        </>
      ),
      bounded: (
        <>
          <strong>受你批准的策略约束。</strong>
          资金调度通过你自己智能账户上的链上 Squads
          策略运行，只能在一份由成熟的 Kamino（Solana
          上最大的借贷协议）储备池组成的白名单内操作。它从不托管你的资金，你随时可以提取。
        </>
      ),
    },
  },
  // Block 3 — Section: Your stablecoins are all just dollars
  dollars: {
    title: "你的稳定币，说到底都是美元",
    cards: {
      interchangeable: (
        <>
          USDC 信誉良好。PYUSD 是 PayPal 的美元。USDT 是 Tether 的美元。USDS
          也是美元。就赚取借贷收益而言，如果持有其中一种而不是另一种并不会实质性地改变你的风险，那么它们就是可以互换的。它们都只是美元。
        </>
      ),
      rotation: (
        <>
          接受这一点之后，问题自然就来了：既然另一个储备池（有时持有的是另一种美元）此刻给的利率更高，为什么还要把你的资金钉在某一个借贷储备池里的某一种代币上？没有什么好理由。目前
          Loyal 会在你所存入的那种稳定币对应的白名单储备池之间轮换你的资金。跨不同美元稳定币的调度是路线图上的下一步。
        </>
      ),
    },
  },
  // Block 4 — Section: Why lending rates spike
  rateSpikes: {
    title: "借贷利率为什么会飙升（以及机会在哪里）",
    description: "这部分通常都讲得很糟，所以这里直白地说一遍。",
    cards: {
      supplyUtilization: (
        <>
          一个借贷储备池有两个关键数字：<strong>总供应量</strong>
          （存入了多少美元）和<strong>利用率</strong>
          （其中有多大比例正在被借出）。出借方的收益来自借款方支付的利息，所以储备池给出的利率取决于这两者之间的平衡。
        </>
      ),
      opening: (
        <>
          想象一个大额出借方把钱撤走。供应量下降，但借款方并没有离开，于是利用率跳升。储备池突然缺少资金，所以它会
          <strong>提高支付的 APY</strong>
          来吸引新的存款，有时会高出好几倍，直到新资金流入、利率回落。这些窗口期就是机会。靠手动去抓它们并不现实，而自动抓住它们正是
          Loyal 的意义所在。
        </>
      ),
    },
  },
  // Block 5 — Section: How Loyal routes to the best rate
  routing: {
    title: "Loyal 如何把资金调度到最优利率",
    cards: {
      motion: (
        <>
          从一个较差的储备池换到一个更好的储备池，机制上很简单。你从第一个池子
          <strong>提取</strong>，再<strong>存入</strong>
          第二个池子，而且这可以在一笔交易内完成。提取，存入。整个动作就是这样。
        </>
      ),
      automation: (
        <>
          Loyal 把这个动作自动化，并且只在一份
          <strong>它信任的储备池白名单</strong>
          内操作，而不是链上随便哪个池子。优化器盯着市场，看到利率往哪里走，就把你的资金调度过去，随着行情变化反复执行。你不用为每次调动签名，也不用守着仪表盘。这一切不是什么新代币，也不是你必须持有的收益产品，它只是架在你自己的资金之上的自动化。
        </>
      ),
    },
  },
  // Block 6 — CardsGrid (3 cols, muted): The three approaches we ruled out
  ruledOut: {
    title: "为什么不用一个大合约、一把后端私钥或一个金库",
    description:
      "要把这件事自动化，有几种显而易见的做法。我们仔细研究了每一种，而每一种都要用我们不愿放弃的东西来换。",
    cards: {
      contract: {
        title: "一个大型定制合约",
        body: "把所有调度逻辑塞进一个大型链上程序，那么每新增一个储备池、每改一次逻辑，都意味着重新部署和重新审计。审计面大而且永久，设计从一开始就是僵硬的。你会把时间都花在维护合约上，而不是抓收益。",
      },
      backendKey: {
        title: "一把后端私钥",
        body: "在机器人里跑一个钱包，让它直接发交易。这很灵活，一个老练的个人农民大致就是这么干的。但它把一把活的私钥放在了服务器上：私钥一旦泄露，资金就没了。这不是能交给普通用户的东西，而且规模一大，你最终还是会回到带人工审批的多签上。",
      },
      vault: {
        title: "由管理人运营的金库",
        body: "把钱存进一个托管式借贷金库，让管理人替你分配。对于一存了之的场景（尤其是机构资金）来说没问题。但你把托管权交给了管理人，常常还要接受锁定期，而且金库的动作不够快，抓不住真正有超额收益的短暂窗口。",
      },
    },
  },
  // Block 7 — Section: How the policy keeps it safe (Loyal's answer)
  policy: {
    title: "策略如何保证安全",
    description: "Loyal 的方案保留了上述做法中有用的部分，去掉了其中的风险。",
    cards: {
      intents: (
        <>
          调度逻辑不是放在一个管理一切的大合约里，而是{" "}
          <a
            className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
            href="https://squads.so"
            rel="noopener"
            target="_blank"
          >
            Squads
          </a>{" "}
          上的一份<strong>智能账户策略</strong>
          。它能执行的动作是<strong>白名单内的意图</strong>：从一个已批准的
          Kamino
          储备池提取，存入另一个已批准的储备池，而且两边的所有者都是你的智能账户。每个动作单独看都无害，也很容易验证。
        </>
      ),
      autoApproved: (
        <>
          这两种意图都无法把资金转出你的账户，所以这些只涉及收益的操作默认是
          <strong>自动批准</strong>的。Loyal
          的后端可以触发这些调动，但它从不持有你的密钥，也永远无法越出白名单。服务器上没有一把等着被偷的私钥，因为策略在链上，资金始终留在你自己的智能账户里。
        </>
      ),
    },
  },
  // Block 8 — CardsGrid (muted, 2 cols): Risk
  risks: {
    title: "理解风险",
    description: (
      <>
        这是纯粹的稳定币借贷：没有清算，没有无常损失，没有杠杆。剩下的是任何出借方都要承担的普通风险。{" "}
        <Link
          className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
          href="/zh/risks"
        >
          查看全部风险
        </Link>
        。
      </>
    ),
    cards: {
      reserve: {
        title: "储备池智能合约风险与脱锚风险",
        body: "你的资金存放在五个白名单 Kamino 市场中，这些市场存在智能合约风险：一次漏洞利用或坏账事件可能影响本金，这与该储备池中每一位出借方承担的风险相同。你存入的稳定币脱锚也是真实存在的风险。",
      },
      custody: {
        title: "托管风险不在其中",
        body: "自动化程序受链上策略约束，所以即使 Loyal 的系统遭到最坏情况的攻破，也无法把你的资金转出白名单意图之外，或扣押你的余额。密钥自始至终都在你手里。",
      },
      noLiquidations: {
        title: "没有清算，没有无常损失",
        body: "这套策略不持有任何杠杆头寸，所以不存在清算；也不持有任何流动性提供者头寸，所以不存在无常损失。它是纯粹的借贷，风险范围很窄。",
      },
      openSource: {
        title: "每个部分都开源",
        body: (
          <>
            Loyal 没有为 Earn 部署自己的程序。持有并出借你资金的程序（Squads
            智能账户和 Kamino K-Lend）都经过 OtterSec 审计。在此之上 Loyal
            自己写的每一行代码都是{" "}
            <a
              className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
              href="https://github.com/loyal-labs/loyal-app"
              rel="noopener"
              target="_blank"
            >
              开源
            </a>
            的。
          </>
        ),
      },
    },
  },
  // Block 9 — CardsGrid (muted, 2 cols): Who optimizes yield
  audiences: {
    title: "谁在用 Loyal 优化收益",
    cards: {
      treasuries: {
        title: "持有稳定币的国库",
        body: (
          <>
            如果你手里有一笔稳定币国库，一年下来，躺平利率和优化后利率之间的差距会复利成一笔实实在在的钱。Loyal
            自动赚取更优的利率，不需要你的团队手动轮换头寸，也不需要把托管权交给金库管理人。
          </>
        ),
      },
      daos: {
        title: "DAO 与链上组织",
        body: (
          <>
            DAO 国库可以让闲置稳定币持续按当前最优利率生息，并由组织自己控制的链上策略来管理，而不是信任单个管理人或运行一把有风险的后端私钥。再配合{" "}
            <Link
              className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
              href="/zh/agents"
            >
              智能账户
            </Link>{" "}
            策略，就能实现限定范围的付款。
          </>
        ),
      },
      runway: {
        title: "管理资金跑道的团队",
        body: "稳定币形式的运营资金在等待支出的同时可以赚取优化后的利率，而且没有锁定期，不会在发薪日把钱困住。你需要多少就提多少，什么时候需要就什么时候提。",
      },
      farmers: {
        title: "高阶用户与收益农民",
        body: "如果你原本打算自己跑一套后端去追储备池的利率飙升，Loyal 给你同样的调度能力，但服务器上没有活的私钥，也不用维护一个自己的大型定制合约。白名单和策略都是你可以亲自验证的。",
      },
    },
  },
  // Block 10 — TextImageHero (text-left): How it's built
  howItsBuilt: {
    title: "它是怎么构建的",
    body: (
      <>
        自动化程序构建在{" "}
        <a
          className="underline underline-offset-4 transition-colors hover:text-white"
          href="https://squads.so"
          rel="noopener"
          target="_blank"
        >
          Squads
        </a>{" "}
        智能账户之上，这是 Solana 上部署最多的智能账户框架。资金调度是一份
        <strong>带白名单意图的策略</strong>
        ，而不是一个大型定制程序。借贷本身发生在{" "}
        <a
          className="underline underline-offset-4 transition-colors hover:text-white"
          href="https://kamino.finance"
          rel="noopener"
          target="_blank"
        >
          Kamino
        </a>{" "}
        的储备池中，而 Loyal 所基于的隐私层使用 MagicBlock
        的临时运行时，签名器运行在硬件隔离的机密虚拟机（Confidential VM）中。
        <br />
        <br />
        整套技术栈都在 loyal-app 单一仓库里；去看看策略、调度和 Kamino
        集成是如何拼在一起的。
      </>
    ),
    cta: "阅读文档",
    imageAlt: "Loyal 的开源单一仓库和用于稳定币收益调度的 SDK",
  },
  // Block 11 — TextImageHero (text-right): Start earning
  startEarning: {
    title: "开始赚取收益",
    body: (
      <>
        存入资金，设定其中多大比例用于赚取收益，接下来 Loyal
        会把它调度到当前最优的利率。Loyal 有四个入口，全部基于同一个 Squads
        智能账户：网页应用、Chrome 扩展、Telegram 小程序和 Android 应用。{" "}
        <strong>Stay Loyal.</strong>
      </>
    ),
    cta: "开始使用",
    imageAlt: "Loyal 浏览器扩展钱包，显示一笔经过优化的稳定币头寸",
  },
  faqs: [
    {
      question: "如何在 Solana 上自动获得最优的稳定币借贷收益？",
      answer:
        "把资金存入 Loyal，设定其中多大比例用于赚取收益。Loyal 会把这部分资金分配到当前为你所存入的稳定币支付最高利率的白名单 Kamino 储备池，并在利率变化时重新分配。它通过链上 Squads 策略运行，所以自动化程序从不托管你的资金。你随时可以提取。",
    },
    {
      question: "借贷 APY 为什么会飙升？",
      answer:
        "储备池用借款方支付的利息来支付出借方，利率由总供应量和被借出的比例（利用率）之间的平衡决定。当一个大额出借方撤出而借款需求依然旺盛时，储备池就缺少资金，于是提高支付的 APY 来吸引存款。利率可能在几个小时内远高于正常水平，直到新资金到来、利率回落。在这些窗口期待在正确的储备池里，就是额外收益的来源。",
    },
    {
      question: "这是托管式的吗？",
      answer:
        "不是。自动化程序以策略的形式运行在你的 Squads 智能账户上，只有两种白名单意图：从一个已批准的 Kamino 储备池提取，以及存入另一个已批准的储备池，两边的所有者都是你的智能账户。Loyal 的后端可以触发这些调动，但从不持有你的私钥，也无法在白名单之外行事。只有你的密钥才能把资金转出你的账户。",
    },
    {
      question: "我能期待多少 APY？",
      answer:
        "一个浮动的市场利率，而不是固定的承诺。收益来自 Kamino 的借贷储备池，所以利率随链上供需浮动，优化器则让你的资金始终待在利率最高的储备池里。Loyal 不会报出什么神奇数字。存入之前，当前利率会显示在应用里，底层储备池的利率在 Kamino 上也是公开的，你可以自己核对。",
    },
    {
      question: "我会亏钱吗？",
      answer:
        "这套策略的设计目标是低波动。它是纯粹的稳定币借贷，没有清算，也没有无常损失，因为它既不用杠杆，也不持有流动性提供者头寸。你的资金以你存入的那种稳定币存放在五个白名单 Kamino 市场中，所以剩余的风险是任何出借方都要承担的普通风险：储备池出现智能合约问题或坏账，或者那种稳定币脱锚。托管权自始至终在你手里，自动化程序永远无法把资金转到白名单意图之外。完整的风险说明见 askloyal.com/zh/risks。",
    },
    {
      question: "这和 Kamino Earn 这类收益金库有什么区别？",
      answer:
        "托管式金库会接管你的资金并替你分配，通常还有锁定期，而且动作不够快，抓不住短暂的利率飙升。Loyal 让托管权留在你手里，没有锁定期，调度也更快，因为它持续监控储备池并在利率飙升发生时立即做出反应。代价是 Loyal 是一种更新的方案；金库则是更成熟的一存了之的选择，更适合想要委托管理的机构资金。",
    },
    {
      question: "我需要管理什么吗？",
      answer:
        "不需要。你存入资金，设定其中多大比例用于赚取收益。之后调度会自动运行，随着利率变化把你的资金转移到最优的储备池。你的资金全程留在你自己的智能账户里，想什么时候提取都可以。",
    },
    {
      question: "Loyal 经过审计吗？",
      answer:
        "Loyal Earn 没有自己的审计，因为它没有自己的智能合约可供审计。安全审计审查的是链上程序代码，而 Earn 没有部署任何链上程序。你的资金存放在 Squads 智能账户程序中，并在 Kamino K-Lend 中赚取收益，两者都经过 OtterSec 审计。Loyal 在此之上增加的是一份策略：它是存储在你 Squads 账户中的配置，由经过审计的 Squads 程序强制执行，其中列出了自动化程序可以调用的两条指令（存入和提取），以及可以调用这两条指令的 Kamino 储备池。任何人都可以在链上读取这份策略。Loyal 的链下自动化程序是开源的，但未经审计，不过它只能提交策略允许的交易，所以即使其中存在漏洞，也无法把资金转出你的账户。",
    },
  ],
};
