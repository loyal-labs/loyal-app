import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const CHECK_COOLDOWN_MS = 10 * 60 * 1000;

const GENERIC_NOTES =
  "We are constantly improving the app, optimizing performance and fixing issues. Please update now to have the latest version running!";

// The incoming update's manifest embeds the app config published with it —
// including `extra.otaNotes`, the free-form release notes from ota-notes.txt.
function readManifestNotes(manifest: unknown): string | null {
  const extra = (
    manifest as
      | { extra?: { expoClient?: { extra?: Record<string, unknown> } } }
      | undefined
  )?.extra?.expoClient?.extra;
  const raw = extra?.otaNotes;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

export function OtaUpdateBanner() {
  const insets = useSafeAreaInsets();
  const [isVisible, setIsVisible] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCheckingRef = useRef(false);
  const isApplyingRef = useRef(false);
  const isVisibleRef = useRef(false);
  const lastCheckedAtRef = useRef(0);

  useEffect(() => {
    isApplyingRef.current = isApplying;
  }, [isApplying]);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  const checkForUpdate = useCallback(
    async ({ bypassCooldown = false }: { bypassCooldown?: boolean } = {}) => {
      if (
        __DEV__ ||
        !Updates.isEnabled ||
        isApplyingRef.current ||
        isVisibleRef.current
      ) {
        return;
      }

      const now = Date.now();
      if (
        !bypassCooldown &&
        now - lastCheckedAtRef.current < CHECK_COOLDOWN_MS
      ) {
        return;
      }
      if (isCheckingRef.current) return;

      isCheckingRef.current = true;
      lastCheckedAtRef.current = now;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) return;

        setNotes(readManifestNotes(result.manifest));
        setError(null);
        setIsVisible(true);
      } catch (err) {
        console.warn("[ota-update] update check failed", err);
      } finally {
        isCheckingRef.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    void checkForUpdate({ bypassCooldown: true });

    let previousState: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const becameActive = previousState !== "active" && nextState === "active";
      previousState = nextState;
      if (becameActive) {
        void checkForUpdate();
      }
    });

    return () => subscription.remove();
  }, [checkForUpdate]);

  const handleApply = useCallback(async () => {
    if (isApplying) return;

    setIsApplying(true);
    setError(null);
    try {
      const result = await Updates.fetchUpdateAsync();
      if (!result.isNew && !result.isRollBackToEmbedded) {
        setIsVisible(false);
        setIsApplying(false);
        return;
      }

      await Updates.reloadAsync();
    } catch (err) {
      console.warn("[ota-update] update apply failed", err);
      setError("Could not update. Try again later.");
      setIsApplying(false);
    }
  }, [isApplying]);

  if (!isVisible) return null;

  return (
    <View
      pointerEvents="box-none"
      // Mounted outside the tab navigator at zIndex 1000, so it must clear
      // both the floating tab bar and the home-indicator inset itself —
      // otherwise it covers the tab buttons and its Restart button lands in
      // the strip where iOS owns the first upward swipe.
      style={[styles.overlay, { bottom: Math.max(insets.bottom, 12) + 94 }]}
    >
      <View style={styles.banner}>
        <View style={styles.copy}>
          <Text style={styles.title}>Update available</Text>
          <Text style={styles.subtitle}>{notes ?? GENERIC_NOTES}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={isApplying}
            onPress={handleApply}
            style={[styles.button, styles.primaryButton]}
          >
            {isApplying ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryText}>Restart</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    left: 16,
    position: "absolute",
    right: 16,
    zIndex: 1000,
  },
  banner: {
    backgroundColor: "#111113",
    borderCurve: "continuous",
    borderRadius: 22,
    boxShadow: "0 12px 28px rgba(0, 0, 0, 0.22)",
    gap: 14,
    padding: 16,
  },
  copy: {
    gap: 3,
  },
  title: {
    color: "#fff",
    fontFamily: "Geist_600SemiBold",
    fontSize: 15,
    lineHeight: 20,
  },
  subtitle: {
    color: "rgba(255,255,255,0.72)",
    fontFamily: "Geist_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
  error: {
    color: "#ffb4b4",
    fontFamily: "Geist_400Regular",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  button: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 14,
    flex: 1,
    height: 42,
    justifyContent: "center",
  },
  primaryButton: {
    backgroundColor: "#f9363c",
  },
  primaryText: {
    color: "#fff",
    fontFamily: "Geist_600SemiBold",
    fontSize: 14,
  },
});
