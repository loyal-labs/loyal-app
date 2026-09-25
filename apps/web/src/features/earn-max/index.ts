import { EARN_MAX_BACKEND } from "./constants";
import { useEarnMax as useLegacyEarnMax } from "./use-earn-max";
import { useEarnMaxVoltr } from "./use-earn-max-voltr";

export { EARN_MAX_FALLBACK_APY_BPS, EARN_MAX_STRATEGY_NAME } from "./constants";

export const useEarnMax =
  EARN_MAX_BACKEND === "voltr" ? useEarnMaxVoltr : useLegacyEarnMax;
export { useEarnMaxInvite } from "./use-earn-max-invite";
export type { EarnMaxInviteState } from "./use-earn-max-invite";
export type {
  EarnMaxActions,
  EarnMaxActivityResponse,
  EarnMaxActivityItem,
  EarnMaxPerformancePoint,
  EarnMaxSummary,
  EarnMaxSummaryResponse,
  EarnMaxViewModel,
  EarnMaxWithdrawalView,
} from "./types";
