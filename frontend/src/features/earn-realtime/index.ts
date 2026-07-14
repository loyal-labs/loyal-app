export {
  EARN_REALTIME_EVENT_TYPES,
  isEarnAutodepositTerminalState,
  mergeEarnAutodepositProgress,
  type EarnAutodepositProgress,
  type EarnAutodepositProgressState,
  type EarnRealtimeConnectionState,
  type EarnRealtimeInvalidation,
} from "./types";
export { fetchEarnAutodepositProgress } from "./fallback";
export {
  useEarnRealtime,
  type EarnRealtimeIdentity,
} from "./use-earn-realtime";
