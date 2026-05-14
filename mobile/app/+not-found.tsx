import { Link, Stack } from "expo-router";

import { Text, View } from "@/tw";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not Found" }} />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text>This screen doesn&apos;t exist.</Text>
        <Link href="/" style={{ marginTop: 16, color: "#007AFF" }}>
          <Text>Go to home screen</Text>
        </Link>
      </View>
    </>
  );
}
