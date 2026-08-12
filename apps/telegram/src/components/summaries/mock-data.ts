import type { ChatSummary } from "./SummaryFeed";

// Helper to get date string N days ago
function daysAgo(n: number): string {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toISOString();
}

/**
 * Mock summaries data for development purposes.
 * Enable by setting NEXT_PUBLIC_USE_MOCK_SUMMARIES=true in .env
 *
 * Note: Each group can have multiple summaries on different dates.
 * The createdAt field is used for date-based filtering in the feed view.
 */
export const MOCK_SUMMARIES: ChatSummary[] = [
  // Telegram Developers Community - 3 days of summaries
  {
    id: "mock-tg-dev-1",
    title: "Telegram Developers Community",
    messageCount: 847,
    createdAt: daysAgo(0), // Today
    topics: [
      {
        id: "topic-tg-1-1",
        title: "Bot API 7.0 Update Discussion",
        content:
          "The community discussed the new Bot API 7.0 features including inline mode improvements and webhook updates. Several developers shared their migration experiences.",
        sources: ["Alex Chen", "Maria K.", "DevBot"],
      },
      {
        id: "topic-tg-1-2",
        title: "Mini App Performance Tips",
        content:
          "Performance optimization strategies for Telegram Mini Apps were shared, focusing on reducing bundle size and improving initial load times.",
        sources: ["Viktor N.", "TechLead"],
      },
    ],
  },
  {
    id: "mock-tg-dev-2",
    title: "Telegram Developers Community",
    messageCount: 523,
    createdAt: daysAgo(1), // Yesterday
    topics: [
      {
        id: "topic-tg-2-1",
        title: "WebApp.ready() Best Practices",
        content:
          "Discussion about the correct timing and usage of WebApp.ready() method to ensure smooth user experience when launching mini apps.",
        sources: ["Sarah Dev", "Alex Chen"],
      },
      {
        id: "topic-tg-2-2",
        title: "Cloud Storage API Patterns",
        content:
          "Best practices for using Telegram Cloud Storage API for persistent user data. Community shared caching strategies and sync patterns.",
        sources: ["CloudMaster", "DevBot"],
      },
    ],
  },
  {
    id: "mock-tg-dev-3",
    title: "Telegram Developers Community",
    messageCount: 312,
    createdAt: daysAgo(3), // 3 days ago
    topics: [
      {
        id: "topic-tg-3-1",
        title: "Payment Integration Guide",
        content:
          "Step-by-step walkthrough of implementing Telegram Payments in mini apps. Covered Stars payments and invoice creation.",
        sources: ["PaymentPro", "Maria K."],
      },
    ],
  },

  // Solana Builders - 2 days of summaries
  {
    id: "mock-sol-1",
    title: "Solana Builders",
    messageCount: 723,
    createdAt: daysAgo(0), // Today
    topics: [
      {
        id: "topic-sol-1-1",
        title: "Token-2022 Extensions Deep Dive",
        content:
          "Detailed walkthrough of Token-2022 program extensions including transfer fees, confidential transfers, and permanent delegate features.",
        sources: ["SolDev", "BlockchainBob", "Alice W."],
      },
      {
        id: "topic-sol-1-2",
        title: "Anchor Framework Updates",
        content:
          "New Anchor version brings improved error handling and better TypeScript client generation. Migration guide was shared by core contributors.",
        sources: ["Armani", "SolDev"],
      },
    ],
  },
  {
    id: "mock-sol-2",
    title: "Solana Builders",
    messageCount: 456,
    createdAt: daysAgo(2), // 2 days ago
    topics: [
      {
        id: "topic-sol-2-1",
        title: "Priority Fees Optimization",
        content:
          "Strategies for optimizing priority fees during network congestion. Dynamic fee estimation algorithms were discussed.",
        sources: ["TxOptimizer", "SolDev"],
      },
    ],
  },

  // React Native Enthusiasts - 2 days
  {
    id: "mock-rn-1",
    title: "React Native Enthusiasts",
    messageCount: 512,
    createdAt: daysAgo(0), // Today
    topics: [
      {
        id: "topic-rn-1-1",
        title: "New Architecture Migration",
        content:
          "Teams shared their experiences migrating to React Native's new architecture with Fabric and TurboModules. Common pitfalls and solutions were discussed.",
        sources: ["RN_Expert", "MobileFirst", "Jason K."],
      },
      {
        id: "topic-rn-1-2",
        title: "Expo SDK 50 Features",
        content:
          "Overview of new features in Expo SDK 50 including improved native module support and better development experience.",
        sources: ["ExpoFan", "RN_Expert"],
      },
    ],
  },
  {
    id: "mock-rn-2",
    title: "React Native Enthusiasts",
    messageCount: 234,
    createdAt: daysAgo(4), // 4 days ago
    topics: [
      {
        id: "topic-rn-2-1",
        title: "Reanimated 3 Performance",
        content:
          "Tips for achieving 60fps animations using Reanimated 3 with practical examples for common UI patterns.",
        sources: ["AnimationPro"],
      },
    ],
  },

  // TypeScript Tips & Tricks - 1 day
  {
    id: "mock-ts-1",
    title: "TypeScript Tips & Tricks",
    messageCount: 189,
    createdAt: daysAgo(1), // Yesterday
    topics: [
      {
        id: "topic-ts-1-1",
        title: "Advanced Generic Patterns",
        content:
          "Community members shared advanced TypeScript generic patterns including conditional types, mapped types, and template literal types.",
        sources: ["TSWizard", "TypeHero"],
      },
      {
        id: "topic-ts-1-2",
        title: "Zod vs Yup for Validation",
        content:
          "Comparison of Zod and Yup for runtime validation with TypeScript integration. Zod's type inference was highlighted as a major advantage.",
        sources: ["ValidatorPro", "TSWizard", "CodeClean"],
      },
    ],
  },

  // AI/ML Engineers Hub - 2 days
  {
    id: "mock-ai-1",
    title: "AI/ML Engineers Hub",
    messageCount: 656,
    createdAt: daysAgo(0), // Today
    topics: [
      {
        id: "topic-ai-1-1",
        title: "Claude API Integration Patterns",
        content:
          "Best practices for integrating Claude API into production applications, including retry strategies and token optimization.",
        sources: ["AIEngineer", "MLOps_Pro", "DataSci"],
      },
      {
        id: "topic-ai-1-2",
        title: "RAG Implementation Tips",
        content:
          "Retrieval-Augmented Generation implementation strategies with focus on embedding selection and vector database choices.",
        sources: ["RAGMaster", "AIEngineer"],
      },
    ],
  },
  {
    id: "mock-ai-2",
    title: "AI/ML Engineers Hub",
    messageCount: 345,
    createdAt: daysAgo(1), // Yesterday
    topics: [
      {
        id: "topic-ai-2-1",
        title: "Fine-tuning Cost Optimization",
        content:
          "Discussion about reducing fine-tuning costs while maintaining model quality. Data preprocessing and batch strategies were covered.",
        sources: ["MLOps_Pro"],
      },
    ],
  },

  // Next.js Community - 2 days
  {
    id: "mock-next-1",
    title: "Next.js Community",
    messageCount: 878,
    createdAt: daysAgo(0), // Today
    topics: [
      {
        id: "topic-next-1-1",
        title: "App Router vs Pages Router",
        content:
          "Comprehensive comparison of Next.js App Router and Pages Router with migration considerations and performance benchmarks.",
        sources: ["NextExpert", "FullStackDev", "ReactPro"],
      },
      {
        id: "topic-next-1-2",
        title: "Server Actions Security",
        content:
          "Security considerations when using Server Actions, including input validation and authentication patterns.",
        sources: ["SecurityFirst", "NextExpert"],
      },
    ],
  },
  {
    id: "mock-next-2",
    title: "Next.js Community",
    messageCount: 432,
    createdAt: daysAgo(2), // 2 days ago
    topics: [
      {
        id: "topic-next-2-1",
        title: "Turbopack Migration",
        content:
          "Early adopters shared their experience migrating to Turbopack. Build time improvements and compatibility issues were discussed.",
        sources: ["TurboPacker", "NextExpert"],
      },
    ],
  },
];

/**
 * Get unique group titles from mock summaries.
 * Used by the summaries list page.
 */
export function getUniqueGroups(): Array<{
  id: string;
  title: string;
  subtitle: string;
}> {
  const groupMap = new Map<
    string,
    { id: string; title: string; latestTopic: string }
  >();

  // Group by title and keep the most recent summary's first topic as subtitle
  for (const summary of MOCK_SUMMARIES) {
    const existing = groupMap.get(summary.title);
    if (!existing) {
      groupMap.set(summary.title, {
        id: summary.id,
        title: summary.title,
        latestTopic: summary.topics[0]?.content || "",
      });
    }
  }

  return Array.from(groupMap.values()).map((g) => ({
    id: g.id,
    title: g.title,
    subtitle: g.latestTopic,
  }));
}

/**
 * Get summaries for a specific group by title.
 * Used by the summary feed when viewing a single group's summaries.
 */
export function getSummariesByGroupTitle(title: string): ChatSummary[] {
  return MOCK_SUMMARIES.filter((s) => s.title === title).sort((a, b) => {
    // Sort by createdAt descending (newest first)
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });
}

/**
 * Get summaries for a specific group by any summary ID in that group.
 * Used when navigating from the list page.
 */
export function getSummariesByGroupId(summaryId: string): ChatSummary[] {
  const summary = MOCK_SUMMARIES.find((s) => s.id === summaryId);
  if (!summary) return [];
  return getSummariesByGroupTitle(summary.title);
}
