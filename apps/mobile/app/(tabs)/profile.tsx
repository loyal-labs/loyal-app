import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import * as Updates from "expo-updates";
import {
  Bell,
  ChevronRight,
  CircleHelp,
  Cloud,
  Fingerprint,
  Globe,
  Heart,
  Key,
  Lightbulb,
  MessageSquare,
  RotateCcw,
  Trash2,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LogoHeader } from "@/components/LogoHeader";
import { PinPadInput } from "@/components/wallet/PinPadInput";
import { getShowTips, setShowTips } from "@/lib/settings";
import { mmkv } from "@/lib/storage";
import { isBiometricAvailable } from "@/lib/wallet/biometrics";
import {
  getLastCloudBackupAt,
  isCloudBackupSupported,
  writeCloudBackup,
} from "@/lib/wallet/icloud-backup";
import {
  isICloudSyncEnabled,
  isICloudSyncSupported,
  setICloudSyncEnabled,
} from "@/lib/wallet/keypair-storage";
import { WALLET_PIN_LENGTH } from "@/lib/wallet/pin";
import { isWalletUnlocked, useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, ScrollView, Text, View } from "@/tw";

const SUPPORT_URL = "https://t.me/spacesymmetry";
const FEEDBACK_URL = "https://tally.so/r/ZjRpev";
const ANALYTICS_OPT_IN_KEY = "settings_analytics_opt_in";

// Height of the floating tab bar above the home-indicator inset (TabBar.tsx:
// paddingTop 8 + BLUR_PADDING 4*2 + TAB_CELL_HEIGHT 54). The inset itself is
// added per-device by the consumer — on an iPhone with a home indicator it is
// 34pt, which a flat 90 does not cover.
const TAB_BAR_HEIGHT = 70;

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

type BuildInfo = {
  short: string;
  full: string;
};

function getBuildInfo(): BuildInfo {
  const version =
    Constants.expoConfig?.version ??
    Constants.nativeApplicationVersion ??
    "?";
  const nativeBuild = Constants.nativeBuildVersion;
  const runtime = Updates.runtimeVersion ?? "embedded";
  const channel = Updates.channel || "dev";
  const updateId = Updates.updateId ?? "embedded";

  // When the native build number isn't stamped into the binary (local
  // `expo run`, or EAS profiles without `autoIncrement`), fall back to
  // the first 7 chars of the OTA update id — still unique enough to
  // tell two installs apart — or the channel name if no OTA has been
  // applied yet. This keeps the settings footer actionable instead of
  // showing "?" for every dev/preview install.
  const buildLabel =
    nativeBuild ??
    (updateId !== "embedded" ? updateId.slice(0, 7) : channel);

  return {
    short: `Loyal Mobile v${version} · build ${buildLabel}`,
    full: [
      `Loyal Mobile v${version}`,
      `build ${buildLabel}`,
      `runtime ${runtime}`,
      `channel ${channel}`,
      `update ${updateId}`,
    ].join(" · "),
  };
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const [pushNotifications, setPushNotifications] = useState(true);
  const [analyticsOptIn, setAnalyticsOptIn] = useState(
    () => mmkv.getBoolean(ANALYTICS_OPT_IN_KEY) ?? true,
  );
  const [showTips, setShowTipsState] = useState(getShowTips);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [icloudSyncOn, setICloudSyncOn] = useState(isICloudSyncEnabled);
  const [lastBackupAt, setLastBackupAt] = useState(getLastCloudBackupAt);
  const [backingUp, setBackingUp] = useState(false);
  const [showBioPinInput, setShowBioPinInput] = useState(false);
  const [bioPin, setBioPin] = useState("");
  const [bioPinError, setBioPinError] = useState<string | null>(null);
  const [versionCopied, setVersionCopied] = useState(false);
  const buildInfo = getBuildInfo();

  const wallet = useWallet();
  const router = useRouter();
  const isUnlocked = isWalletUnlocked(wallet.state);
  const isVaultBacked = wallet.state === "vault-unlocked";

  useEffect(() => {
    isBiometricAvailable().then(setBiometricsAvailable);
  }, []);

  const handleSupport = useCallback(() => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Linking.openURL(SUPPORT_URL);
  }, []);

  const handleSendFeedback = useCallback(() => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Linking.openURL(FEEDBACK_URL);
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

  const handleAnalyticsToggle = useCallback((value: boolean) => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setAnalyticsOptIn(value);
    mmkv.setBoolean(ANALYTICS_OPT_IN_KEY, value);
  }, []);

  const handleShowTipsToggle = useCallback((value: boolean) => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setShowTipsState(value);
    setShowTips(value);
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

  const handleICloudBackup = useCallback(() => {
    if (backingUp) return;
    Alert.alert(
      "Back Up Wallet to iCloud",
      "Stores your encrypted wallet in your iCloud. Restoring it on a new phone requires your wallet PIN.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Back Up",
          onPress: () => {
            setBackingUp(true);
            writeCloudBackup()
              .then((envelope) => {
                setLastBackupAt(envelope.createdAt);
                Alert.alert("Backed Up", "Your wallet is backed up to iCloud.");
              })
              .catch((error: unknown) => {
                Alert.alert(
                  "Backup Failed",
                  error instanceof Error ? error.message : "Please try again.",
                );
              })
              .finally(() => setBackingUp(false));
          },
        },
      ],
    );
  }, [backingUp]);

  const handleICloudSyncToggle = useCallback((value: boolean) => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    // Optimistic — the keychain write is fast and failures are logged.
    setICloudSyncOn(value);
    setICloudSyncEnabled(value).catch((error) => {
      console.warn("[settings] iCloud Keychain toggle failed", error);
      setICloudSyncOn(!value);
    });
  }, []);

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
      Alert.alert("Secret Key", hex, [
        {
          text: "Copy",
          onPress: () => Clipboard.setStringAsync(hex),
        },
        { text: "Done" },
      ]);
    } else {
      Alert.alert("Error", "Unable to export secret key");
    }
  }, [wallet]);

  const handleCopyBuildInfo = useCallback(async () => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await Clipboard.setStringAsync(buildInfo.full);
    setVersionCopied(true);
    setTimeout(() => setVersionCopied(false), 1500);
  }, [buildInfo.full]);

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
          onPress: async () => {
            await wallet.resetWallet();
            // Land on the wallet tab so re-onboarding completion reveals the
            // wallet UI rather than the Settings page the user just left.
            router.replace("/");
          },
        },
      ],
    );
  }, [router, wallet]);

  return (
    <View className="flex-1 bg-white">
      <LogoHeader showSettings={false} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingBottom: TAB_BAR_HEIGHT + Math.max(insets.bottom, 12) + 20,
        }}
      >
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

        {/* Tips */}
        <SettingsSection>
          <ProfileCell
            icon={
              <Lightbulb size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />
            }
            title="Show tips"
            subtitle="Show in-app hints, like the chart swipe hint"
            toggle={{
              value: showTips,
              onValueChange: handleShowTipsToggle,
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
            icon={<MessageSquare size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />}
            title="Send feedback"
            subtitle="Share what you think about Loyal"
            showChevron
            onPress={handleSendFeedback}
          />
          <ProfileCell
            icon={<RotateCcw size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />}
            title="Replay Onboarding"
            subtitle="View intro slides again"
            showChevron
            onPress={handleReplayOnboarding}
          />
        </SettingsSection>

        {/* Wallet Management — only when unlocked. Vault-backed wallets hide
            biometrics (vault prompts on every signature) and export (the
            secret never leaves the vault). */}
        {isUnlocked && (
          <SettingsSection>
            {biometricsAvailable && !isVaultBacked && (
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

            {!isVaultBacked && isICloudSyncSupported() && (
              <ProfileCell
                icon={<Cloud size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />}
                title="Sync Wallet to iCloud Keychain"
                toggle={{
                  value: icloudSyncOn,
                  onValueChange: handleICloudSyncToggle,
                }}
              />
            )}

            {!isVaultBacked && isCloudBackupSupported() && (
              <ProfileCell
                icon={
                  <Cloud size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />
                }
                title={backingUp ? "Backing Up..." : "Back Up Wallet to iCloud"}
                subtitle={
                  lastBackupAt
                    ? `Last backup ${new Date(lastBackupAt).toLocaleDateString()}`
                    : undefined
                }
                showChevron
                disabled={backingUp}
                onPress={handleICloudBackup}
              />
            )}

            {!isVaultBacked && (
              <ProfileCell
                icon={<Key size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />}
                title="Export Secret Key"
                showChevron
                onPress={handleExportSecretKey}
              />
            )}

            <ProfileCell
              icon={<Trash2 size={28} strokeWidth={1.5} color="#f9363c" />}
              title="Reset Wallet"
              danger
              onPress={handleResetWallet}
            />
          </SettingsSection>
        )}
        <SettingsSection>
          <ProfileCell
            icon={<Heart size={28} strokeWidth={1.5} color="rgba(0,0,0,0.6)" />}
            title="Anonymously improve Loyal for everyone"
            toggle={{
              value: analyticsOptIn,
              onValueChange: handleAnalyticsToggle,
            }}
          />
        </SettingsSection>

        {/* Tap-to-copy build string so users can report exactly which
            native binary + OTA bundle they're running. */}
        <Pressable onPress={handleCopyBuildInfo} style={styles.versionRow}>
          <Text style={styles.versionText}>
            {versionCopied ? "Copied" : buildInfo.short}
          </Text>
        </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 20,
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
  versionRow: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 8,
  },
  versionText: {
    fontFamily: "Geist_400Regular",
    fontSize: 12,
    lineHeight: 16,
    color: "rgba(60,60,67,0.35)",
  },
});
