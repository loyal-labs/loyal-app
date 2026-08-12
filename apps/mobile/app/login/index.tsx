import { Pressable, Text, View } from "@/tw";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Logo from "../../assets/images/logo.svg";
import TelegramIcon from "../../assets/images/Telegram.svg";

export default function LoginScreen() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();

  const handlePress = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push("/login/phone");
  }, [router]);

  return (
    <View className="flex-1 bg-white">
      <View style={styles.logoContainer}>
        <Logo width={160} height={47} />
      </View>

      <View style={styles.buttonBody}>
        <LinearGradient
          colors={["rgba(255,255,255,0)", "#fff"]}
          style={styles.gradient}
        />
        <View style={[styles.buttonWrap, { paddingBottom: bottom + 24 }]}>
          <Pressable style={styles.button} onPress={handlePress}>
            <TelegramIcon width={28} height={28} />
            <Text style={styles.buttonText}>Continue with Telegram</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  logoContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonBody: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  gradient: {
    height: 16,
  },
  buttonWrap: {
    backgroundColor: "#fff",
    paddingHorizontal: 32,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    backgroundColor: "#000",
    borderRadius: 78,
    paddingHorizontal: 12,
  },
  buttonText: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "#fff",
  },
});
