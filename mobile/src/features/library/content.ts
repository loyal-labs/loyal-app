export type LibraryArticleSection = {
  heading: string;
  paragraphs: string[];
  callout?: string;
};

export type LibraryArticle = {
  slug: string;
  category: "How-to" | "Tutorial" | "FAQ";
  title: string;
  subtitle: string;
  description: string;
  readTime: string;
  updatedAtLabel: string;
  eyebrow: string;
  accentColor: string;
  accentSoftColor: string;
  sections: LibraryArticleSection[];
};

export type LibrarySection = {
  title: "How-tos" | "Tutorials" | "FAQs";
  description: string;
  articles: LibraryArticle[];
};

const libraryArticles: LibraryArticle[] = [
  {
    slug: "move-assets-into-your-seeker-wallet",
    category: "How-to",
    title: "Move assets into your Seeker wallet",
    subtitle: "A quick path for funding your device wallet without losing context.",
    description:
      "Fund your Seeker in a way that keeps your first send, swap, or shield flow frictionless.",
    readTime: "4 min read",
    updatedAtLabel: "Updated today",
    eyebrow: "Featured",
    accentColor: "#2094F3",
    accentSoftColor: "#D9EEFF",
    sections: [
      {
        heading: "Why this matters",
        paragraphs: [
          "The fastest onboarding path is the one that gets users from empty balance to first action without context switching.",
          "A clean deposit flow also reduces support load because users can tell whether they are funding, swapping, or shielding at each step.",
        ],
      },
      {
        heading: "Move funds in",
        paragraphs: [
          "Open the wallet tab, tap Receive, and copy the wallet address shown for your current device profile.",
          "Send a small amount first, wait for the balance card to refresh, and only then move the full balance you plan to use.",
        ],
        callout:
          "If you are bridging from an exchange, start with a test transfer so you can confirm network and memo requirements first.",
      },
      {
        heading: "Check readiness",
        paragraphs: [
          "Once the balance appears, verify that both the total balance and activity feed reflect the incoming transfer.",
          "At that point the wallet is ready for swaps, shielding, or sending funds to another address.",
        ],
      },
    ],
  },
  {
    slug: "create-your-first-shielded-transfer",
    category: "How-to",
    title: "Create your first shielded transfer",
    subtitle: "Use Shield when you want movement without exposing the destination in the obvious path.",
    description:
      "A practical walkthrough for moving from transparent balance into a shielded flow inside Seeker.",
    readTime: "5 min read",
    updatedAtLabel: "Updated yesterday",
    eyebrow: "How-to",
    accentColor: "#111111",
    accentSoftColor: "#EAEAEA",
    sections: [
      {
        heading: "Before you begin",
        paragraphs: [
          "Shield works best when the wallet already has a confirmed balance and the device is fully set up.",
          "Make sure the network toggle is on the environment you expect before preparing a transfer.",
        ],
      },
      {
        heading: "Send with intent",
        paragraphs: [
          "Tap Shield from the wallet action row and review the amount, destination, and any destination memo requirements.",
          "Treat the review step as a final checkpoint rather than a speed bump because this is the last place to catch address mistakes.",
        ],
      },
    ],
  },
  {
    slug: "set-up-your-wallet-in-five-minutes",
    category: "Tutorial",
    title: "Set up your wallet in five minutes",
    subtitle: "A guided tutorial for first-time Seeker owners.",
    description:
      "From PIN creation to receiving your first transfer, this covers the happy path for a fresh install.",
    readTime: "6 min read",
    updatedAtLabel: "Updated Apr 8",
    eyebrow: "Tutorial",
    accentColor: "#6B5BFF",
    accentSoftColor: "#ECE8FF",
    sections: [
      {
        heading: "Start with security",
        paragraphs: [
          "Choose a PIN you will remember and enable biometrics when the device supports it.",
          "That combination gives the app a native feel while still keeping recovery and export steps explicit.",
        ],
      },
      {
        heading: "Fund and explore",
        paragraphs: [
          "After setup, move a small amount of SOL into the wallet and explore send, receive, swap, and shield from the main action row.",
          "Use the activity sheet to confirm your first interactions landed where you expected.",
        ],
      },
    ],
  },
  {
    slug: "understand-the-wallet-home-screen",
    category: "Tutorial",
    title: "Understand the wallet home screen",
    subtitle: "Learn what each card, section, and action does before you move money around.",
    description:
      "A visual walkthrough of the balance card, token list, banners, and activity sections.",
    readTime: "3 min read",
    updatedAtLabel: "Updated Apr 7",
    eyebrow: "Tutorial",
    accentColor: "#13A76A",
    accentSoftColor: "#DFF7EC",
    sections: [
      {
        heading: "Read the hierarchy",
        paragraphs: [
          "The balance card is the summary surface, the action row is the fastest way into money movement, and the activity feed is the trust layer.",
          "That order is intentional because users first ask what they have, then what they can do, then what already happened.",
        ],
      },
    ],
  },
  {
    slug: "what-is-shielded-balance",
    category: "FAQ",
    title: "What is a shielded balance?",
    subtitle: "A short answer to the most common privacy question in the app.",
    description:
      "Shielded balance refers to funds users manage through the app's private movement flows rather than the plain transfer path.",
    readTime: "2 min read",
    updatedAtLabel: "Updated Apr 10",
    eyebrow: "FAQ",
    accentColor: "#F4B63D",
    accentSoftColor: "#FFF2D7",
    sections: [
      {
        heading: "Short version",
        paragraphs: [
          "A shielded balance is money that has moved through Seeker's privacy-preserving flow instead of staying only in the obvious public path.",
          "It is still your money, but the product explains and presents it differently so the privacy intent stays understandable.",
        ],
      },
      {
        heading: "When to use it",
        paragraphs: [
          "Use shielded movement when privacy is part of the goal and the extra review step is worth the tradeoff.",
        ],
      },
    ],
  },
  {
    slug: "why-is-my-transfer-still-pending",
    category: "FAQ",
    title: "Why is my transfer still pending?",
    subtitle: "Most pending states resolve quickly once the network catches up.",
    description:
      "What to check when a transfer does not appear in the wallet immediately.",
    readTime: "2 min read",
    updatedAtLabel: "Updated Apr 5",
    eyebrow: "FAQ",
    accentColor: "#FF7A59",
    accentSoftColor: "#FFE6DF",
    sections: [
      {
        heading: "Check the basics",
        paragraphs: [
          "Confirm the selected network, look at the activity feed timestamp, and refresh the wallet before assuming the transfer failed.",
          "If you sent from an exchange, remember that their outbound queue can lag behind the on-chain confirmation window.",
        ],
      },
    ],
  },
];

export const librarySections: LibrarySection[] = [
  {
    title: "How-tos",
    description: "Practical walkthroughs for common wallet jobs.",
    articles: libraryArticles.filter((article) => article.category === "How-to"),
  },
  {
    title: "Tutorials",
    description: "Guided learn-the-product flows for new users.",
    articles: libraryArticles.filter((article) => article.category === "Tutorial"),
  },
  {
    title: "FAQs",
    description: "Short answers to the questions users ask most often.",
    articles: libraryArticles.filter((article) => article.category === "FAQ"),
  },
];

export function getLibraryArticleBySlug(slug: string) {
  return libraryArticles.find((article) => article.slug === slug);
}

export function getFeaturedLibraryArticle() {
  return getLibraryArticleBySlug("move-assets-into-your-seeker-wallet")!;
}
