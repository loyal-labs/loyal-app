import { TabBar } from "@/components/TabBar";
import { router, Tabs } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

// After this long in the background, snap back to the wallet home on resume
// regardless of which tab/screen the user had open. Short absences leave the
// navigation state alone.
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

      // Pop any screens pushed on top of the tabs (token detail, browser,
      // etc.), then switch to the wallet (index) tab.
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
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        animation: "shift",
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="browser" />
      <Tabs.Screen name="library" />
      <Tabs.Screen name="profile" />
      {/* Summaries tab hidden — keep code for potential reinstatement */}
      <Tabs.Screen name="summaries" options={{ href: null }} />
    </Tabs>
  );
}
