import { TabBar } from "@/components/TabBar";
import { ActivityProvider } from "@/features/activity/model/ActivityProvider";
import { router, Tabs } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

// After this long in the background, snap back to the Earn home on resume
// regardless of which tab/screen the user had open.
const RESET_TO_HOME_AFTER_MS = 20 * 60 * 1000;

export default function TabsLayout() {
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        if (backgroundedAt.current === null) {
          backgroundedAt.current = Date.now();
        }
        return;
      }

      if (next !== "active" || backgroundedAt.current === null) return;

      const elapsed = Date.now() - backgroundedAt.current;
      backgroundedAt.current = null;
      if (elapsed < RESET_TO_HOME_AFTER_MS) return;

      try {
        router.dismissAll();
      } catch {
        // No stack entries to dismiss — ignore.
      }
      router.navigate("/(tabs)");
    });
    return () => subscription.remove();
  }, []);

  return (
    <ActivityProvider>
      <Tabs
        tabBar={(props) => <TabBar {...props} />}
        screenOptions={{
          headerShown: false,
          animation: "shift",
        }}
      >
        {/* index.tsx renders the Earn screen — it's the route group's default so
            cold start (URL "/") lands here without any extra config. */}
        <Tabs.Screen name="index" />
        <Tabs.Screen name="wallet" />
        <Tabs.Screen name="activity" />
        <Tabs.Screen name="browser" />
        <Tabs.Screen name="library" />
        {/* Profile/Settings dropped from the bottom nav (reachable from the
            header gear), but kept registered so direct navigation still works. */}
        <Tabs.Screen name="profile" />
        {/* Summaries tab hidden — keep code for potential reinstatement */}
        <Tabs.Screen name="summaries" options={{ href: null }} />
      </Tabs>
    </ActivityProvider>
  );
}
