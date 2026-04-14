import { TabBar } from "@/components/TabBar";
import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
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
