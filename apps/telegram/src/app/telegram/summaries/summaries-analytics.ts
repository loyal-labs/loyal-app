export const SUMMARIES_ANALYTICS_PATH = "/telegram/summaries/feed";

export const SUMMARIES_ANALYTICS_EVENTS = {
  viewCommunitySummaryDay: "View Community Summary Day",
} as const;

export const SUMMARY_SELECTION_SOURCES = {
  initial: "initial",
  swipe: "swipe",
  datePicker: "date_picker",
  todayButton: "today_button",
} as const;

export type SummarySelectionSource =
  (typeof SUMMARY_SELECTION_SOURCES)[keyof typeof SUMMARY_SELECTION_SOURCES];
