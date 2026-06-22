import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { ScanLine, Settings } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Pressable, View } from "@/tw";

import Wordmark from "../../assets/images/loyal-wordmark.svg";

const ICON_COLOR = "#3C3C43";

function triggerHaptic() {
  if (process.env.EXPO_OS !== "web") {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

function IconButton({
  onPress,
  label,
  children,
}: {
  onPress: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={styles.iconButton}
    >
      {children}
    </Pressable>
  );
}

type LogoHeaderProps = {
  /**
   * Override the scan button. When omitted, the button routes to the Wallet tab
   * and asks it to open the Send flow's QR scanner — so "scan an address" works
   * from any screen the header appears on (wallet, library, settings).
   */
  onScanPress?: () => void;
  /** Override the settings button. Defaults to the Settings (profile) tab. */
  onSettingsPress?: () => void;
};

// Shared top toolbar: the `loyal` wordmark on the left, scan + settings on the
// right (Figma 141:5844). Present on Wallet, Library, and Settings.
export function LogoHeader({ onScanPress, onSettingsPress }: LogoHeaderProps) {
  const { top } = useSafeAreaInsets();
  const router = useRouter();

  const handleScan = () => {
    triggerHaptic();
    if (onScanPress) {
      onScanPress();
      return;
    }
    router.navigate({
      pathname: "/(tabs)/wallet",
      params: { scan: String(Date.now()) },
    });
  };

  const handleSettings = () => {
    triggerHaptic();
    if (onSettingsPress) {
      onSettingsPress();
      return;
    }
    router.navigate("/(tabs)/profile");
  };

  return (
    <View style={[styles.container, { paddingTop: top + 12 }]}>
      <Wordmark width={66} height={28} />
      <View style={styles.actions}>
        <IconButton onPress={handleScan} label="Scan QR code">
          <ScanLine size={28} color={ICON_COLOR} strokeWidth={1.8} opacity={0.6} />
        </IconButton>
        <IconButton onPress={handleSettings} label="Settings">
          <Settings size={28} color={ICON_COLOR} strokeWidth={1.8} opacity={0.6} />
        </IconButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#ffffff",
    paddingLeft: 16,
    paddingRight: 8,
    paddingBottom: 8,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
});
