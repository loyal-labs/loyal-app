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

const CHECK_COOLDOWN_MS = 10 * 60 * 1000;

export function OtaUpdateBanner() {
  const [isVisible, setIsVisible] = useState(false);
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

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    setError(null);
  }, []);

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
    <View pointerEvents="box-none" style={styles.overlay}>
      <View style={styles.banner}>
        <View style={styles.copy}>
          <Text style={styles.title}>Update available</Text>
          <Text style={styles.subtitle}>
            Restart Loyal to use the latest version.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={isApplying}
            onPress={handleDismiss}
            style={[styles.button, styles.secondaryButton]}
          >
            <Text style={styles.secondaryText}>Later</Text>
          </Pressable>
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
    bottom: 24,
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
  secondaryButton: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  primaryButton: {
    backgroundColor: "#f9363c",
  },
  secondaryText: {
    color: "rgba(255,255,255,0.82)",
    fontFamily: "Geist_600SemiBold",
    fontSize: 14,
  },
  primaryText: {
    color: "#fff",
    fontFamily: "Geist_600SemiBold",
    fontSize: 14,
  },
});
