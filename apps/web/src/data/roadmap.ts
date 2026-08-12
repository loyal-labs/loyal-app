export type RoadmapPeriodType = "Q" | "H" | "Y";

export type RoadmapEventItem = {
  title: string;
  isChecked: boolean;
};

export type RoadmapEvent = {
  year: number;
  periodType: RoadmapPeriodType;
  periodNumber: number;
  isChecked: boolean;
  isActive?: boolean;
  events: RoadmapEventItem[];
};

export const roadmapEvents: RoadmapEvent[] = [
  {
    year: 2025,
    periodType: "Q" as const,
    periodNumber: 4,
    isChecked: true,
    events: [
      { title: "Transactions over Telegram", isChecked: true },
      { title: "Telegram chat summaries", isChecked: true },
      { title: "Rudimentary workflow representation", isChecked: true },
      { title: "Branded community agents", isChecked: true },
    ],
  },
  {
    year: 2026,
    periodType: "Q" as const,
    periodNumber: 1,
    isChecked: true,
    events: [
      { title: "Squads multisig interoperability", isChecked: true },
      { title: "LP management & staking automation", isChecked: false },
      { title: "Knowledge graph data visualization", isChecked: false },
      { title: "Fiat on-/off-ramping", isChecked: false },
    ],
  },
  {
    year: 2026,
    periodType: "Q" as const,
    periodNumber: 2,
    isChecked: false,
    isActive: true,
    events: [
      { title: "Workflow builder & executor", isChecked: false },
      { title: "Data connectors for email & calendar", isChecked: false },
      { title: "Decentralized data storage for business", isChecked: false },
      { title: "Widgets workspace customization", isChecked: false },
    ],
  },
  {
    year: 2026,
    periodType: "Q" as const,
    periodNumber: 3,
    isChecked: false,
    events: [
      { title: "Enterprise finance agents", isChecked: false },
      { title: "Workflow marketplace", isChecked: false },
      { title: "Explainability layer for SOL transactions", isChecked: false },
    ],
  },
  {
    year: 2026,
    periodType: "Q" as const,
    periodNumber: 4,
    isChecked: false,
    events: [
      { title: "Workflows SDK for developers", isChecked: false },
      {
        title: "3rd party workflow publication & monetization",
        isChecked: false,
      },
    ],
  },
  {
    year: 2027,
    periodType: "H" as const,
    periodNumber: 1,
    isChecked: false,
    events: [{ title: "Compute oracle marketplace", isChecked: false }],
  },
];
