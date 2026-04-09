import { ArrowLeft, Key, Download, Plus } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import * as SeedVault from "expo-seed-vault";
import type { VaultAccount } from "expo-seed-vault";

import { Pressable, ScrollView, Text, View } from "@/tw";

type Props = {
  onComplete: (account: VaultAccount) => void;
  onBack: () => void;
};

type Action = "authorize" | "create" | "import";

type ActionMeta = {
  id: Action;
  title: string;
  description: string;
  icon: typeof Key;
  loadingLabel: string;
  run: () => Promise<VaultAccount>;
};

export function SeedVaultChooserScreen({ onComplete, onBack }: Props) {
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = useCallback(
    async (action: ActionMeta) => {
      if (pending) return;
      setPending(action.id);
      setError(null);
      try {
        const account = await action.run();
        onComplete(account);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Seed Vault operation failed";
        setError(msg);
      } finally {
        setPending(null);
      }
    },
    [pending, onComplete],
  );

  const actions: ActionMeta[] = [
    {
      id: "authorize",
      title: "Use existing seed",
      description:
        "Pick a seed that's already stored in your Seeker's Seed Vault.",
      icon: Key,
      loadingLabel: "Waiting for vault approval…",
      run: () => SeedVault.authorizeExistingSeed(),
    },
    {
      id: "create",
      title: "Create new seed",
      description:
        "Generate a fresh 24-word seed inside the vault. It never leaves the vault.",
      icon: Plus,
      loadingLabel: "Creating seed in vault…",
      run: () => SeedVault.createNewSeed(),
    },
    {
      id: "import",
      title: "Import seed phrase",
      description:
        "Enter a 12- or 24-word seed phrase into the vault's secure UI.",
      icon: Download,
      loadingLabel: "Importing seed…",
      run: () => SeedVault.importSeed(),
    },
  ];

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
          disabled={pending !== null}
        >
          <ArrowLeft size={20} color="#000" strokeWidth={2} />
        </Pressable>
      </View>

      <Text style={styles.title}>Use Seed Vault</Text>
      <Text style={styles.subtitle}>
        Your Seeker keeps your seed in a secure vault. Every signature
        needs your approval.
      </Text>

      <View className="mt-8 gap-3">
        {actions.map((action) => {
          const Icon = action.icon;
          const isPending = pending === action.id;
          const disabled = pending !== null && !isPending;
          return (
            <Pressable
              key={action.id}
              onPress={() => handle(action)}
              disabled={pending !== null}
              style={[
                styles.card,
                disabled && styles.cardDisabled,
              ]}
            >
              <View style={styles.iconWrap}>
                {isPending ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Icon size={20} color="#000" strokeWidth={1.8} />
                )}
              </View>
              <View className="flex-1">
                <Text style={styles.cardTitle}>{action.title}</Text>
                <Text style={styles.cardDescription}>
                  {isPending ? action.loadingLabel : action.description}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {error !== null && (
        <View className="mt-6 rounded-2xl px-4 py-3" style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
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
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.04)",
  },
  cardDisabled: {
    opacity: 0.4,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  cardTitle: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 16,
    color: "#000",
  },
  cardDescription: {
    fontFamily: "Geist_400Regular",
    fontSize: 13,
    color: "rgba(0,0,0,0.55)",
    marginTop: 4,
    lineHeight: 18,
  },
  errorCard: {
    backgroundColor: "rgba(220,38,38,0.08)",
  },
  errorText: {
    fontFamily: "Geist_500Medium",
    fontSize: 13,
    color: "#b91c1c",
  },
});
