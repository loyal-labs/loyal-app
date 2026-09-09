import { useLinkEmail, usePrivy } from "@privy-io/expo";
import type { User as PrivyUser } from "@privy-io/expo";
import { X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput } from "react-native";

import { isPrivyConfigured } from "@/components/wallet/PrivyProviderRoot";
import { mmkv } from "@/lib/storage";
import { Text, View } from "@/tw";

const DISMISSED_KEY = "loyal:add-email-nudge-dismissed";

/** Email from any linked email/Google/Apple account, or null. */
export function privyEmail(user: PrivyUser | null): string | null {
  for (const a of user?.linked_accounts ?? []) {
    if (a.type === "email") return a.address;
    if ((a.type === "google_oauth" || a.type === "apple_oauth") && a.email) {
      return a.email;
    }
  }
  return null;
}

// One-time nudge for users who reached Privy through a wallet (migration or
// wallet sign-in) and have no email to recover with on a new phone.
export function AddEmailNudge() {
  if (!isPrivyConfigured()) return null;
  return <Inner />;
}

function Inner() {
  const { user } = usePrivy();
  const [dismissed, setDismissed] = useState(
    () => mmkv.getBoolean(DISMISSED_KEY) === true,
  );
  if (!user || dismissed || privyEmail(user)) return null;
  return (
    <View style={styles.card}>
      <View className="flex-row items-start justify-between">
        <Text style={styles.title}>Add an email</Text>
        <Pressable
          hitSlop={12}
          onPress={() => {
            mmkv.setBoolean(DISMISSED_KEY, true);
            setDismissed(true);
          }}
        >
          <X size={18} color="rgba(0,0,0,0.5)" />
        </Pressable>
      </View>
      <Text style={styles.body}>
        Recover your wallet on a new phone by linking an email.
      </Text>
      <LinkEmailForm />
    </View>
  );
}

/** Inline email + code entry that links an email to the current Privy user. */
export function LinkEmailForm({ onLinked }: { onLinked?: () => void } = {}) {
  const { sendCode, linkWithCode } = useLinkEmail();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-2 pt-2">
      {sent ? (
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          placeholder="6-digit code"
          placeholderTextColor="rgba(0,0,0,0.3)"
          keyboardType="number-pad"
          editable={!busy}
          onSubmitEditing={() =>
            void run(async () => {
              await linkWithCode({ code: code.trim() });
              onLinked?.();
            })
          }
        />
      ) : (
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email address"
          placeholderTextColor="rgba(0,0,0,0.3)"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          editable={!busy}
          onSubmitEditing={() =>
            void run(async () => {
              await sendCode({ email: email.trim() });
              setSent(true);
            })
          }
        />
      )}
      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        disabled={busy || (sent ? code.trim().length < 6 : !email.trim())}
        onPress={() =>
          void run(async () => {
            if (sent) {
              await linkWithCode({ code: code.trim() });
              onLinked?.();
            } else {
              await sendCode({ email: email.trim() });
              setSent(true);
            }
          })
        }
      >
        <Text style={styles.buttonText}>{sent ? "Verify" : "Send code"}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.04)",
  },
  title: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 16,
    color: "#000",
  },
  body: {
    fontFamily: "Geist_400Regular",
    fontSize: 14,
    lineHeight: 18,
    color: "rgba(60, 60, 67, 0.6)",
    marginTop: 4,
  },
  input: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    color: "#000",
    backgroundColor: "#fff",
    borderRadius: 999,
    height: 44,
    paddingHorizontal: 16,
  },
  button: {
    height: 44,
    borderRadius: 999,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    color: "#fff",
  },
  error: {
    fontFamily: "Geist_500Medium",
    fontSize: 13,
    color: "#b91c1c",
  },
});
