export const ONBOARDING_EVENTS = {
  started: "Onboarding Started",
  slideViewed: "Onboarding Slide Viewed",
  ended: "Onboarding Ended",
} as const;

export const ONBOARDING_COMPLETION_METHODS = {
  completed: "completed",
  skipped: "skipped",
} as const;

export type OnboardingCompletionMethod =
  (typeof ONBOARDING_COMPLETION_METHODS)[keyof typeof ONBOARDING_COMPLETION_METHODS];
