export type BentoItem = {
  title: string;
  description: string;
  animationPath: string;
  colSpan: 1 | 2;
  aspectRatio?: string;
};

export const bentoItems: BentoItem[] = [
  {
    title: "Sensitive data protected",
    description:
      "Summarize Telegram chats and filter signal from noise with fully encrypted AI — now in beta.",
    animationPath: "/bento/01-Sensitive-data.json",
    colSpan: 1,
  },
  {
    title: "Telegram anti-spam",
    description:
      "Loyal agent protects your inbox. Every person DMing you for the first time gets screened by AI and verified before they can talk to you.",
    animationPath: "/bento/02-Anti-Spam.json",
    colSpan: 1,
  },
  {
    title: "Private transactions over Telegram",
    description:
      "Now you can privately send Solana and SPL tokens with minimal fees. Don't doxx your wallet address either — just use their Telegram username instead.",
    animationPath: "/bento/03-Private-transactions.json",
    colSpan: 1,
    aspectRatio: "1 / 0.95",
  },
  {
    title: "Community agents",
    description:
      "Automate repetitive tasks, post summaries in your community and protect it from spam.",
    animationPath: "/bento/04-Community-Agents.json",
    colSpan: 1,
  },
  {
    title: "Automated workflows",
    description:
      "Supercharge your wallets and save time with automated workflows.",
    animationPath: "/bento/05-Automated workflows.json",
    colSpan: 2,
  },
];
