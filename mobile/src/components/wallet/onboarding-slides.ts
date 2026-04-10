export type OnboardingSlide = {
  title: string;
  description: string;
  image: number;
};

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    title: "Group Summaries",
    description:
      "Filter noise and Instantly see what’s happening in group chats you don’t have time to read.",
    image: require("../../../assets/images/onboarding/on1.png"),
  },
  {
    title: "Swipe Through Your DMs",
    description: "Quickly review and manage your Telegram DMs in one place.",
    image: require("../../../assets/images/onboarding/on2.png"),
  },
  {
    title: "Private Transactions",
    description:
      "Send crypto privately over Telegram username. Don’t reveal your address and sensitive data onchain.",
    image: require("../../../assets/images/onboarding/on3.png"),
  },
];
