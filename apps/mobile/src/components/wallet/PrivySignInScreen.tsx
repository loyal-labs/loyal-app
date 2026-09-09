import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LogoHeader } from "@/components/LogoHeader";
import type { WalletConnectMode } from "@/components/wallet/onboarding-slides";
import { Pressable, Text, View } from "@/tw";

export type PrivySignInMethod = "email" | "google" | "apple" | "wallet";

type Props = {
  connectMode: WalletConnectMode;
  /** True on a Seeker: names the device wallet instead of a generic label. */
  seekerWallet: boolean;
  pending: PrivySignInMethod | null;
  error: string | null;
  onSendEmailCode: (email: string) => Promise<void>;
  onSubmitEmailCode: (code: string) => Promise<void>;
  onOAuth: (provider: "google" | "apple") => void;
  onConnectWallet: () => void;
};

function walletLabel(connectMode: WalletConnectMode, seeker: boolean) {
  if (connectMode === "none") return null;
  if (seeker) return "Continue with Seeker wallet";
  return "Connect wallet";
}

export function PrivySignInScreen({
  connectMode,
  seekerWallet,
  pending,
  error,
  onSendEmailCode,
  onSubmitEmailCode,
  onOAuth,
  onConnectWallet,
}: Props) {
  const { bottom } = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const disabled = pending !== null;
  const wallet = walletLabel(connectMode, seekerWallet);

  const submitEmail = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    await onSendEmailCode(trimmed);
    setCodeSent(true);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <LogoHeader />
      <View className="flex-1 justify-end px-6" style={{ paddingBottom: Math.max(bottom + 12, 24) }}>
        <Text style={styles.title}>Sign in to Loyal</Text>

        <View className="gap-3">
          {codeSent ? (
            <>
              <Text style={styles.helperText}>Enter the code sent to {email.trim()}</Text>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                placeholder="6-digit code"
                placeholderTextColor="rgba(0,0,0,0.3)"
                keyboardType="number-pad"
                autoFocus
                editable={!disabled}
                onSubmitEditing={() => void onSubmitEmailCode(code.trim())}
              />
              <Button
                label="Continue"
                primary
                busy={pending === "email"}
                disabled={disabled || code.trim().length < 6}
                onPress={() => void onSubmitEmailCode(code.trim())}
              />
              <Pressable
                onPress={() => {
                  setCodeSent(false);
                  setCode("");
                }}
                disabled={disabled}
              >
                <Text style={styles.linkText}>Use a different email</Text>
              </Pressable>
            </>
          ) : (
            <>
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
              <Button
                label="Continue with email"
                primary
                busy={pending === "email"}
                disabled={disabled || !email.trim()}
                onPress={() => void submitEmail()}
              />
              <Button
                label="Continue with Google"
                busy={pending === "google"}
                disabled={disabled}
                onPress={() => onOAuth("google")}
              />
              {Platform.OS === "ios" ? (
                <Button
                  label="Continue with Apple"
                  busy={pending === "apple"}
                  disabled={disabled}
                  onPress={() => onOAuth("apple")}
                />
              ) : null}
              {wallet ? (
                <Button
                  label={wallet}
                  busy={pending === "wallet"}
                  disabled={disabled}
                  onPress={onConnectWallet}
                />
              ) : null}
            </>
          )}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Button({
  label,
  primary = false,
  busy = false,
  disabled = false,
  onPress,
}: {
  label: string;
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        primary ? styles.primaryButton : styles.secondaryButton,
        disabled && !busy && styles.disabledButton,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      {busy ? (
        <ActivityIndicator size="small" color={primary ? "#fff" : "#000"} />
      ) : (
        <Text
          style={[
            primary ? styles.primaryButtonText : styles.secondaryButtonText,
            disabled && styles.disabledButtonText,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 22,
    lineHeight: 28,
    color: "#000",
    textAlign: "center",
    marginBottom: 20,
  },
  input: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    color: "#000",
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: 999,
    height: 52,
    paddingHorizontal: 20,
  },
  primaryButton: {
    height: 52,
    borderRadius: 999,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontFamily: "Geist_500Medium",
    fontSize: 17,
    lineHeight: 22,
    color: "#fff",
  },
  secondaryButton: {
    height: 52,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontFamily: "Geist_500Medium",
    fontSize: 17,
    lineHeight: 22,
    color: "#000",
  },
  disabledButton: {
    backgroundColor: "rgba(0,0,0,0.06)",
    borderColor: "transparent",
  },
  disabledButtonText: {
    color: "rgba(0,0,0,0.38)",
  },
  helperText: {
    fontFamily: "Geist_400Regular",
    fontSize: 14,
    lineHeight: 18,
    color: "rgba(60, 60, 67, 0.6)",
    textAlign: "center",
  },
  linkText: {
    fontFamily: "Geist_500Medium",
    fontSize: 14,
    lineHeight: 18,
    color: "rgba(60, 60, 67, 0.6)",
    textAlign: "center",
    paddingVertical: 8,
  },
  errorText: {
    fontFamily: "Geist_500Medium",
    fontSize: 14,
    lineHeight: 18,
    color: "#b91c1c",
    textAlign: "center",
  },
});
