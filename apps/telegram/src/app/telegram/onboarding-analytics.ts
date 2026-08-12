export const ONBOARDING_ANALYTICS_EVENTS = {
  onboardingStarted: "Onboarding Started",
  onboardingEnded: "Onboarding Ended",
} as const;

export const ONBOARDING_COMPLETION_METHODS = {
  completed: "completed",
  skipped: "skipped",
} as const;

export type OnboardingCompletionMethod =
  (typeof ONBOARDING_COMPLETION_METHODS)[keyof typeof ONBOARDING_COMPLETION_METHODS];
