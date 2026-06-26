import { useLocalSearchParams } from "expo-router";

import type { ActivitySection } from "@/features/activity/model/activity-unread";
import { ActivityScreen } from "@/features/activity/ui/ActivityScreen";

export default function ActivityTab() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const initialSection: ActivitySection | undefined =
    section === "earn" || section === "wallet" ? section : undefined;
  return <ActivityScreen initialSection={initialSection} />;
}
