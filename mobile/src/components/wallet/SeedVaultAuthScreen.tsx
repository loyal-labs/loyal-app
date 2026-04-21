import { ArrowLeft, RefreshCcw } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import * as SeedVault from "expo-seed-vault";
import type { VaultAccount } from "expo-seed-vault";

import { Pressable, ScrollView, Text, View } from "@/tw";

type Props = {
  onComplete: (account: VaultAccount) => void;
  onBack: () => void;
};

async function authorizeExistingSeed(): Promise<VaultAccount> {
  const existing = await SeedVault.listAuthorizedSeeds();
  if (existing.length > 0) return existing[0];
  return SeedVault.authorizeExistingSeed();
}

export function SeedVaultAuthScreen({ onComplete, onBack }: Props) {
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const autoStartedRef = useRef(false);

  const run = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const granted = await SeedVault.requestPermission();
      if (!granted) {
        setError(
          "Seed Vault access is required. Grant the permission in Settings → Apps → Loyal → Permissions.",
        );
        return;
      }
      const account = await authorizeExistingSeed();
      onComplete(account);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Seed Vault operation failed";
      setError(msg);
    } finally {
      setPending(false);
    }
  }, [onComplete]);

  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    void run();
  }, [run]);

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="flex-grow px-6 pt-16 pb-10"
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.stepHeader}>
        <Pressable
          onPress={onBack}
          hitSlop={16}
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(0,0,0,0.05)" }}
          disabled={pending}
        >
          <ArrowLeft size={20} color="#000" strokeWidth={2} />
        </Pressable>
      </View>

      <Text style={styles.title}>Use Seed Vault</Text>
      <Text style={styles.subtitle}>
        Your Seeker keeps your seed in a secure vault. Every signature needs
        your approval.
      </Text>

      <View style={styles.body}>
        {pending ? (
          <View style={styles.centerColumn}>
            <ActivityIndicator size="large" color="#000" />
            <Text style={styles.statusText}>
              Waiting for vault approval…
            </Text>
          </View>
        ) : error !== null ? (
          <>
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
            <Pressable onPress={run} style={styles.retryButton}>
              <RefreshCcw size={18} color="#fff" strokeWidth={2} />
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stepHeader: {
    height: 56,
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontFamily: "Geist_700Bold",
    fontSize: 28,
    color: "#000",
    lineHeight: 34,
  },
  subtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 16,
    color: "rgba(0,0,0,0.5)",
    marginTop: 8,
    lineHeight: 22,
  },
  body: {
    marginTop: 32,
    gap: 16,
  },
  centerColumn: {
    alignItems: "center",
    gap: 16,
    paddingVertical: 24,
  },
  statusText: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    color: "rgba(0,0,0,0.55)",
  },
  errorCard: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(220,38,38,0.08)",
  },
  errorText: {
    fontFamily: "Geist_500Medium",
    fontSize: 14,
    color: "#b91c1c",
    lineHeight: 20,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "#f9363c",
  },
  retryText: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 16,
    color: "#fff",
  },
});
