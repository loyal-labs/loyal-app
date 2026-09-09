import { ArrowLeft } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
} from "react-native";

import { Pressable, SafeAreaView, Text, View } from "@/tw";

export type PrivySignInMethod = "email" | "google" | "apple";

type Props = {
  /** Copy only: Privy login is login-or-signup either way. */
  intent: "create" | "login";
  pending: PrivySignInMethod | null;
  error: string | null;
  onSendEmailCode: (email: string) => Promise<void>;
  onSubmitEmailCode: (code: string) => Promise<void>;
  onOAuth: (provider: "google" | "apple") => void;
  onBack: () => void;
};

// "Create New Wallet" step: a Privy account (email / Google / Apple) backs a
// new embedded wallet, so there is no seed phrase to write down. Layout and
// type mirror ImportWalletScreen so the two flows feel like one product.
export function PrivySignInScreen({
  intent,
  pending,
  error,
  onSendEmailCode,
  onSubmitEmailCode,
  onOAuth,
  onBack,
}: Props) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const disabled = pending !== null;

  const submitEmail = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    await onSendEmailCode(trimmed);
    setCodeSent(true);
  };

  const submitCode = () => {
    if (code.trim().length < 6) return;
    void onSubmitEmailCode(code.trim());
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View className="flex-1 px-6 pt-4">
          <View className="mb-8 flex-row items-center">
            <Pressable
              onPress={() => {
                if (codeSent) {
                  setCodeSent(false);
                  setCode("");
                } else {
                  onBack();
                }
              }}
              hitSlop={12}
              className="mr-3"
              disabled={disabled}
            >
              <ArrowLeft size={24} color="#000" strokeWidth={1.5} />
            </Pressable>
            <View className="flex-1" />
          </View>

          {codeSent ? (
            <View className="flex-1">
              <Text style={styles.title}>Check your email</Text>
              <Text style={styles.subtitle}>
                Enter the 6-digit code sent to {email.trim()}
              </Text>
              <View className="mt-8">
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={setCode}
                  placeholder="000000"
                  placeholderTextColor="rgba(0,0,0,0.3)"
                  keyboardType="number-pad"
                  autoFocus
                  editable={!disabled}
                  maxLength={6}
                  onSubmitEditing={submitCode}
                />
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </View>
              <View className="flex-1" />
              <View className="pb-4">
                <Pressable
                  style={[
                    styles.primaryButton,
                    (disabled || code.trim().length < 6) &&
                      styles.buttonDisabled,
                  ]}
                  onPress={submitCode}
                  disabled={disabled || code.trim().length < 6}
                >
                  {pending === "email" ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Continue</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <View className="flex-1">
              <Text style={styles.title}>
                {intent === "create" ? "Create New Wallet" : "Log In"}
              </Text>
              <Text style={styles.subtitle}>
                {intent === "create"
                  ? "Sign in to create a wallet you can recover from any device. No seed phrase to write down."
                  : "Use the email or Google account linked to your wallet."}
              </Text>
              <View className="mt-8">
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
                  editable={!disabled}
                  onSubmitEditing={() => void submitEmail()}
                />
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </View>
              <View className="flex-1" />
              <View className="gap-3 pb-4">
                <Pressable
                  style={[
                    styles.primaryButton,
                    (disabled || !email.trim()) && styles.buttonDisabled,
                  ]}
                  onPress={() => void submitEmail()}
                  disabled={disabled || !email.trim()}
                >
                  {pending === "email" ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      Continue with Email
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.secondaryButton, disabled && styles.buttonDisabled]}
                  onPress={() => onOAuth("google")}
                  disabled={disabled}
                >
                  {pending === "google" ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={styles.secondaryButtonText}>
                      Continue with Google
                    </Text>
                  )}
                </Pressable>
                {Platform.OS === "ios" ? (
                  <Pressable
                    style={[styles.secondaryButton, disabled && styles.buttonDisabled]}
                    onPress={() => onOAuth("apple")}
                    disabled={disabled}
                  >
                    {pending === "apple" ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <Text style={styles.secondaryButtonText}>
                        Continue with Apple
                      </Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 28,
    color: "#000",
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 18,
    color: "rgba(0,0,0,0.5)",
    lineHeight: 24,
  },
  input: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    color: "#000",
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: 16,
    height: 56,
    paddingHorizontal: 16,
  },
  primaryButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 17,
    color: "#fff",
  },
  secondaryButton: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 17,
    color: "#000",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  errorText: {
    fontFamily: "Geist_500Medium",
    fontSize: 13,
    color: "#FF3B30",
    marginTop: 8,
  },
});
