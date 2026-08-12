import { Stack } from "expo-router";
import { StyleSheet } from "react-native";
import { View } from "@/tw";

import Logo from "../../assets/images/logo.svg";

function LogoTitle() {
  return (
    <View style={styles.logoTitle}>
      <Logo width={96} height={28} />
    </View>
  );
}

export default function LoginLayout() {
  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerTitle: () => <LogoTitle />,
        headerBackVisible: false,
        headerStyle: { backgroundColor: "#fff" },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="phone" />
      <Stack.Screen name="code" />
      <Stack.Screen name="password" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  logoTitle: {
    alignItems: "center",
    justifyContent: "center",
  },
});
