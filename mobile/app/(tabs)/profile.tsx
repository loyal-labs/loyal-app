import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import {
  Bell,
  ChevronRight,
  CircleHelp,
  Fingerprint,
  Globe,
  Key,
  RotateCcw,
  Trash2,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Switch } from "react-native";

import { LogoHeader } from "@/components/LogoHeader";
import { PinPadInput } from "@/components/wallet/PinPadInput";
import { isBiometricAvailable } from "@/lib/wallet/biometrics";
import { WALLET_PIN_LENGTH } from "@/lib/wallet/pin";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { Image } from "@/tw/image";

const SUPPORT_URL = "https://t.me/spacesymmetry";

const AVATARS = [
  require("../../assets/images/avatars/avatar-01.png"),
  require("../../assets/images/avatars/avatar-02.png"),
  require("../../assets/images/avatars/avatar-03.png"),
  require("../../assets/images/avatars/avatar-04.png"),
  require("../../assets/images/avatars/Avatar-05.png"),
];

const TAB_BAR_HEIGHT = 90;

function SettingsSection({ children }: { children: React.ReactNode }) {
  return <View style={styles.section}>{children}</View>;
}

type CellProps = {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  rightDetail?: string;
  showChevron?: boolean;
  toggle?: {
    value: boolean;
    onValueChange: (v: boolean) => void;
  };
  onPress?: () => void;
  disabled?: boolean;
  danger?: boolean;
};

function ProfileCell({
  icon,
  title,
  subtitle,
  rightDetail,
  showChevron,
  toggle,
  onPress,
  disabled,
  danger,
}: CellProps) {
  const content = (
    <View style={[styles.cell, disabled && styles.cellDisabled]}>
      <View style={styles.cellLeft}>
        <View style={styles.cellIconWrap}>{icon}</View>
      </View>

      <View style={[styles.cellMiddle, subtitle ? styles.cellMiddleCompact : undefined]}>
        <Text style={[styles.cellTitle, danger && styles.cellTitleDanger]}>{title}</Text>
        {subtitle && <Text style={styles.cellSubtitle}>{subtitle}</Text>}
      </View>

      {rightDetail != null && (
        <View style={styles.cellRight}>
          <Text style={styles.cellDetail}>{rightDetail}</Text>
        </View>
      )}

      {toggle && (
        <View style={styles.cellRight}>
          <Switch
            value={toggle.value}
            onValueChange={toggle.onValueChange}
            trackColor={{ false: "rgba(120,120,128,0.16)", true: "#f9363c" }}
            thumbColor="#fff"
            disabled={disabled}
          />
        </View>
      )}

      {showChevron && (
        <View style={styles.cellChevron}>
          <ChevronRight size={16} color="rgba(60,60,67,0.3)" strokeWidth={2} />
        </View>
      )}
    </View>
  );

  if (onPress && !disabled) {
    return (
      <Pressable onPress={onPress} style={styles.cellPressable}>
        {content}
      </Pressable>
    );
  }

  return content;
}

export default function ProfileScreen() {
  const [pushNotifications, setPushNotifications] = useState(true);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [showBioPinInput, setShowBioPinInput] = useState(false);
  const [bioPin, setBioPin] = useState("");
  const [bioPinError, setBioPinError] = useState<string | null>(null);

  const wallet = useWallet();
  const isUnlocked = wallet.state === "unlocked";

  useEffect(() => {
    isBiometricAvailable().then(setBiometricsAvailable);
  }, []);

  const avatarSource = useMemo(
    () => AVATARS[Math.floor(Math.random() * AVATARS.length)],
    [],
  );

  const handleSupport = useCallback(() => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Linking.openURL(SUPPORT_URL);
  }, []);

  const handleReplayOnboarding = useCallback(() => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    wallet.startOnboardingReplay();
  }, [wallet]);

  const handleNotificationToggle = useCallback((value: boolean) => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setPushNotifications(value);
  }, []);

  const handleBiometricToggle = useCallback(
    (value: boolean) => {
      if (process.env.EXPO_OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      if (!value) {
        // Disabling — no PIN needed
        wallet.setBiometricEnabled("", false);
        return;
      }
      // Enabling — need PIN confirmation
      setBioPin("");
      setBioPinError(null);
      setShowBioPinInput(true);
    },
    [wallet],
  );

  const handleBioPinSubmit = useCallback(async () => {
    if (bioPin.length !== WALLET_PIN_LENGTH) {
      setBioPinError("PIN must be 4 digits");
      return;
    }
    try {
      await wallet.setBiometricEnabled(bioPin, true);
      setShowBioPinInput(false);
      setBioPin("");
      setBioPinError(null);
    } catch {
      setBioPinError("Incorrect PIN or biometric setup failed");
    }
  }, [bioPin, wallet]);

  const handleBioPinCancel = useCallback(() => {
    setShowBioPinInput(false);
    setBioPin("");
    setBioPinError(null);
  }, []);

  const handleExportSecretKey = useCallback(() => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const hex = wallet.getSecretKeyHex();
    if (hex) {
      Alert.alert("Secret Key", hex);
    } else {
      Alert.alert("Error", "Unable to export secret key");
    }
  }, [wallet]);

  const handleResetWallet = useCallback(() => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    Alert.alert(
      "Reset Wallet",
      "This will permanently delete your wallet from this device. Make sure you have backed up your secret key. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => wallet.resetWallet(),
        },
      ],
    );
  }, [wallet]);

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT }}
    >
      <LogoHeader />

      {/* Avatar + Name */}
      <View style={styles.header}>
        <View style={styles.avatarWrap}>
          <Image source={avatarSource} style={styles.avatar} transition={150} />
        </View>
        <View style={styles.nameContainer}>
          <Text style={styles.name}>Test User</Text>
        </View>
      </View>

      {/* Settings */}
      <View style={styles.container}>
        {/* Language + Push Notifications */}
        <SettingsSection>
          <ProfileCell
            icon={<Globe size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />}
            title="Language"
            rightDetail="English"
            disabled
          />
          <ProfileCell
            icon={<Bell size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />}
            title="Push Notifications"
            toggle={{
              value: pushNotifications,
              onValueChange: handleNotificationToggle,
            }}
          />
        </SettingsSection>

        {/* Support */}
        <SettingsSection>
          <ProfileCell
            icon={<CircleHelp size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />}
            title="Support"
            subtitle="Report a bug or ask any question"
            showChevron
            onPress={handleSupport}
          />
          <ProfileCell
            icon={<RotateCcw size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />}
            title="Replay Onboarding"
            subtitle="View intro slides again"
            showChevron
            onPress={handleReplayOnboarding}
          />
        </SettingsSection>

        {/* Wallet Management — only when unlocked */}
        {isUnlocked && (
          <SettingsSection>
            {biometricsAvailable && (
              <>
                <ProfileCell
                  icon={
                    <Fingerprint size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />
                  }
                  title="Biometric Unlock"
                  toggle={{
                    value: wallet.biometricEnabled,
                    onValueChange: handleBiometricToggle,
                  }}
                />
                {showBioPinInput && (
                  <View style={styles.bioPinContainer}>
                    <Text style={styles.bioPinLabel}>
                      Enter PIN to enable biometrics
                    </Text>
                    <PinPadInput
                      value={bioPin}
                      onChange={(value) => {
                        setBioPin(value);
                        if (bioPinError) setBioPinError(null);
                      }}
                      error={bioPinError}
                    />
                    <View style={styles.bioPinActions}>
                      <Pressable
                        onPress={handleBioPinSubmit}
                        style={[
                          styles.bioPinButton,
                          bioPin.length !== WALLET_PIN_LENGTH &&
                            styles.bioPinButtonDisabled,
                        ]}
                        disabled={bioPin.length !== WALLET_PIN_LENGTH}
                      >
                        <Text style={styles.bioPinButtonText}>Confirm</Text>
                      </Pressable>
                      <Pressable
                        onPress={handleBioPinCancel}
                        style={styles.bioPinCancelButton}
                      >
                        <Text style={styles.bioPinCancelText}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </>
            )}

            <ProfileCell
              icon={<Key size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />}
              title="Export Secret Key"
              showChevron
              onPress={handleExportSecretKey}
            />

            <ProfileCell
              icon={<Trash2 size={28} strokeWidth={1.5} color="#f9363c" />}
              title="Reset Wallet"
              danger
              onPress={handleResetWallet}
            />
          </SettingsSection>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    paddingTop: 32,
    paddingBottom: 24,
    paddingHorizontal: 32,
    gap: 16,
  },
  avatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#e5e5ea",
    overflow: "hidden",
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  nameContainer: {
    alignItems: "center",
    gap: 4,
  },
  name: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 24,
    lineHeight: 28,
    color: "#000",
    textAlign: "center",
  },
  container: {
    paddingHorizontal: 16,
    gap: 16,
  },
  section: {
    backgroundColor: "#f2f2f7",
    borderRadius: 20,
    paddingVertical: 4,
  },
  cell: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    overflow: "hidden",
  },
  cellDisabled: {
    opacity: 0.5,
  },
  cellPressable: {
    // Pressable wraps cell for tap feedback
  },
  cellLeft: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 12,
    paddingVertical: 6,
  },
  cellIconWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingRight: 4,
    paddingVertical: 10,
  },
  cellMiddle: {
    flex: 1,
    paddingVertical: 13,
  },
  cellMiddleCompact: {
    paddingVertical: 9,
  },
  cellTitle: {
    fontFamily: "Geist_500Medium",
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.187,
    color: "#000",
  },
  cellSubtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: "rgba(60,60,67,0.6)",
  },
  cellRight: {
    paddingLeft: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  cellDetail: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "rgba(60,60,67,0.6)",
    textAlign: "right",
  },
  cellTitleDanger: {
    color: "#f9363c",
  },
  cellChevron: {
    paddingLeft: 12,
    justifyContent: "center",
    alignItems: "center",
    height: 40,
    paddingVertical: 8,
  },
  bioPinContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  bioPinLabel: {
    fontFamily: "Geist_400Regular",
    fontSize: 14,
    lineHeight: 18,
    color: "rgba(60,60,67,0.6)",
  },
  bioPinActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bioPinButton: {
    flex: 1,
    backgroundColor: "#f9363c",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
  },
  bioPinButtonDisabled: {
    opacity: 0.5,
  },
  bioPinButtonText: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    lineHeight: 22,
    color: "#fff",
  },
  bioPinCancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bioPinCancelText: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(60,60,67,0.6)",
  },
});
