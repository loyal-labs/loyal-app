import { Keypair } from "@solana/web3.js";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { MIN_PASSWORD_LENGTH } from "@/lib/wallet/password-strength";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, SafeAreaView, Text, View } from "@/tw";

import { PasswordInput } from "./PasswordInput";

type Step = "password" | "confirm" | "import";

type Props = {
  onComplete: (keypair: Keypair, password: string) => void;
};

const HEX_REGEX = /^[0-9a-fA-F]+$/;
const SECRET_KEY_HEX_LENGTH = 128; // 64 bytes = 128 hex chars

function parseHexKey(raw: string): { bytes: Uint8Array | null; error: string | null } {
  let hex = raw.trim();
  if (hex.startsWith("0x") || hex.startsWith("0X")) {
    hex = hex.slice(2);
  }

  if (hex.length === 0) {
    return { bytes: null, error: "Please paste your secret key" };
  }

  if (!HEX_REGEX.test(hex)) {
    return { bytes: null, error: "Key must contain only hex characters (0-9, a-f)" };
  }

  if (hex.length !== SECRET_KEY_HEX_LENGTH) {
    return {
      bytes: null,
      error: `Key must be ${SECRET_KEY_HEX_LENGTH} hex characters (got ${hex.length})`,
    };
  }

  const bytes = new Uint8Array(
    hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
  );
  return { bytes, error: null };
}

export function ImportWalletScreen({ onComplete }: Props) {
  const { importWallet } = useWallet();

  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [hexKey, setHexKey] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handlePasswordContinue = useCallback(() => {
    if (password.length >= MIN_PASSWORD_LENGTH) {
      setConfirmError(null);
      setConfirmPassword("");
      setStep("confirm");
    }
  }, [password]);

  const handleConfirmContinue = useCallback(() => {
    if (confirmPassword !== password) {
      setConfirmError("Passwords don't match");
      return;
    }
    setConfirmError(null);
    setImportError(null);
    setHexKey("");
    setStep("import");
  }, [confirmPassword, password]);

  const handleBack = useCallback(() => {
    if (step === "confirm") {
      setConfirmError(null);
      setConfirmPassword("");
      setStep("password");
    } else if (step === "import") {
      setImportError(null);
      setHexKey("");
      setStep("confirm");
    }
  }, [step]);

  const handleImport = useCallback(async () => {
    const { bytes, error } = parseHexKey(hexKey);
    if (error || !bytes) {
      setImportError(error);
      return;
    }

    setIsImporting(true);
    setImportError(null);

    try {
      const keypair = await importWallet(bytes, password);
      onComplete(keypair, password);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Failed to import wallet");
    } finally {
      setIsImporting(false);
    }
  }, [hexKey, password, importWallet, onComplete]);

  const isPasswordValid = password.length >= MIN_PASSWORD_LENGTH;

  // Full-screen loading while encrypting + storing
  if (isImporting) {
    return (
      <Animated.View
        entering={FadeIn.duration(150)}
        style={styles.loadingContainer}
      >
        <ActivityIndicator size="large" color="#000" />
        <Text style={styles.loadingText}>Importing wallet...</Text>
      </Animated.View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View className="flex-1 px-6 pt-4">
          {/* Header */}
          <View className="mb-8 flex-row items-center">
            {step !== "password" && (
              <Pressable onPress={handleBack} hitSlop={12} className="mr-3">
                <ArrowLeft size={24} color="#000" strokeWidth={1.5} />
              </Pressable>
            )}
            <View className="flex-1" />
          </View>

          {/* Step: Password */}
          {step === "password" && (
            <View className="flex-1">
              <Text style={styles.title}>Create Password</Text>
              <Text style={styles.subtitle}>
                This password encrypts your wallet
              </Text>
              <View className="mt-6">
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  onSubmit={handlePasswordContinue}
                  showStrength
                  autoFocus
                  placeholder="Enter password"
                />
              </View>
              <View className="flex-1" />
              <Pressable
                onPress={handlePasswordContinue}
                style={[styles.primaryButton, !isPasswordValid && styles.buttonDisabled]}
                disabled={!isPasswordValid}
              >
                <Text style={styles.primaryButtonText}>Continue</Text>
              </Pressable>
              <View className="h-8" />
            </View>
          )}

          {/* Step: Confirm */}
          {step === "confirm" && (
            <View className="flex-1">
              <Text style={styles.title}>Confirm Password</Text>
              <Text style={styles.subtitle}>Enter your password again</Text>
              <View className="mt-6">
                <PasswordInput
                  value={confirmPassword}
                  onChange={(text) => {
                    setConfirmPassword(text);
                    setConfirmError(null);
                  }}
                  onSubmit={handleConfirmContinue}
                  error={confirmError}
                  autoFocus
                  placeholder="Confirm password"
                />
              </View>
              <View className="flex-1" />
              <Pressable
                onPress={handleConfirmContinue}
                style={[
                  styles.primaryButton,
                  confirmPassword.length === 0 && styles.buttonDisabled,
                ]}
                disabled={confirmPassword.length === 0}
              >
                <Text style={styles.primaryButtonText}>Continue</Text>
              </Pressable>
              <View className="h-8" />
            </View>
          )}

          {/* Step: Import */}
          {step === "import" && (
            <View className="flex-1">
              <Text style={styles.title}>Import Secret Key</Text>
              <Text style={styles.subtitle}>
                Paste your 128-character hex secret key
              </Text>
              <View className="mt-6">
                <TextInput
                  style={styles.hexInput}
                  value={hexKey}
                  onChangeText={(text) => {
                    setHexKey(text);
                    setImportError(null);
                  }}
                  placeholder="Paste hex secret key..."
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  multiline
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  textAlignVertical="top"
                />
              </View>
              {importError && (
                <Text style={styles.errorText}>{importError}</Text>
              )}
              <View className="flex-1" />
              <Pressable
                onPress={handleImport}
                style={[styles.primaryButton, isImporting && styles.buttonDisabled]}
                disabled={isImporting}
              >
                {isImporting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Import Wallet</Text>
                )}
              </Pressable>
              <View className="h-8" />
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    color: "rgba(0,0,0,0.5)",
    marginTop: 16,
  },
  flex: {
    flex: 1,
  },
  title: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 28,
    color: "#000",
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 16,
    color: "rgba(0,0,0,0.5)",
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
  buttonDisabled: {
    opacity: 0.4,
  },
  hexInput: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 14,
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.9)",
    borderRadius: 16,
    padding: 16,
    minHeight: 120,
    textAlignVertical: "top",
  },
  errorText: {
    fontFamily: "Geist_500Medium",
    fontSize: 13,
    color: "#FF3B30",
    marginTop: 8,
  },
});
