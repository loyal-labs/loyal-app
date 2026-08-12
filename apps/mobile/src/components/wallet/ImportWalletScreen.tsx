import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
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

import { PinPadInput } from "@/components/wallet/PinPadInput";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, SafeAreaView, Text, View } from "@/tw";

type Step = "pin" | "confirm" | "import";

type Props = {
  onComplete: (keypair: Keypair, pin: string) => void;
};

const HEX_REGEX = /^[0-9a-fA-F]+$/;
const SECRET_KEY_BYTES = 64; // Solana ed25519 keypair: 32-byte seed + 32-byte pubkey
const SECRET_KEY_HEX_LENGTH = SECRET_KEY_BYTES * 2;

/**
 * Accept Solana secret keys in any of the three formats users paste:
 *   - Base58 (miniapp `bs58.encode(keypair.secretKey)`, Phantom, Solflare).
 *     The standard 64-byte secret encodes to 87–88 base58 chars.
 *   - Hex (extension, with optional 0x prefix). Exactly 128 chars.
 *   - JSON byte array `[n, n, …]` (solana-keygen default). Exactly 64 numbers.
 *
 * We detect shape first, then validate length. Returns Uint8Array of length
 * 64 on success. The error strings are user-facing so they hint at the
 * accepted formats when input is ambiguous.
 */
function parseSecretKey(
  raw: string,
): { bytes: Uint8Array | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { bytes: null, error: "Please paste your secret key" };
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed) || parsed.length !== SECRET_KEY_BYTES) {
        return {
          bytes: null,
          error: `JSON array must contain ${SECRET_KEY_BYTES} bytes (got ${Array.isArray(parsed) ? parsed.length : "non-array"})`,
        };
      }
      const bytes = new Uint8Array(SECRET_KEY_BYTES);
      for (let i = 0; i < SECRET_KEY_BYTES; i += 1) {
        const value = parsed[i];
        if (typeof value !== "number" || value < 0 || value > 255 || !Number.isInteger(value)) {
          return {
            bytes: null,
            error: `Invalid byte at position ${i} (must be integer 0–255)`,
          };
        }
        bytes[i] = value;
      }
      return { bytes, error: null };
    } catch {
      return { bytes: null, error: "Invalid JSON array" };
    }
  }

  const hex = trimmed.startsWith("0x") || trimmed.startsWith("0X")
    ? trimmed.slice(2)
    : trimmed;
  if (HEX_REGEX.test(hex) && hex.length === SECRET_KEY_HEX_LENGTH) {
    const bytes = new Uint8Array(SECRET_KEY_BYTES);
    for (let i = 0; i < SECRET_KEY_BYTES; i += 1) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return { bytes, error: null };
  }

  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length !== SECRET_KEY_BYTES) {
      return {
        bytes: null,
        error: `Base58 key must decode to ${SECRET_KEY_BYTES} bytes (got ${decoded.length})`,
      };
    }
    return { bytes: new Uint8Array(decoded), error: null };
  } catch {
    // fall through to the format-hint error below
  }

  return {
    bytes: null,
    error:
      "Unrecognized key format. Expected base58, 128-char hex, or JSON byte array.",
  };
}

export function ImportWalletScreen({ onComplete }: Props) {
  const { importWallet } = useWallet();

  const [step, setStep] = useState<Step>("pin");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [hexKey, setHexKey] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handlePinComplete = useCallback((nextPin: string) => {
    setPin(nextPin);
    setConfirmError(null);
    setConfirmPin("");
    setStep("confirm");
  }, []);

  const handleConfirmComplete = useCallback((nextConfirmPin: string) => {
    setConfirmPin(nextConfirmPin);

    if (nextConfirmPin !== pin) {
      setConfirmError("PINs don't match");
      setConfirmPin("");
      return;
    }

    setConfirmError(null);
    setImportError(null);
    setHexKey("");
    setStep("import");
  }, [pin]);

  const handleBack = useCallback(() => {
    if (step === "confirm") {
      setPin("");
      setConfirmError(null);
      setConfirmPin("");
      setStep("pin");
    } else if (step === "import") {
      setImportError(null);
      setHexKey("");
      setStep("confirm");
    }
  }, [step]);

  const handleImport = useCallback(async () => {
    const { bytes, error } = parseSecretKey(hexKey);
    if (error || !bytes) {
      setImportError(error);
      return;
    }

    setIsImporting(true);
    setImportError(null);

    try {
      const keypair = await importWallet(bytes, pin);
      onComplete(keypair, pin);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Failed to import wallet");
    } finally {
      setIsImporting(false);
    }
  }, [hexKey, pin, importWallet, onComplete]);

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
            {step !== "pin" && (
              <Pressable onPress={handleBack} hitSlop={12} className="mr-3">
                <ArrowLeft size={24} color="#000" strokeWidth={1.5} />
              </Pressable>
            )}
            <View className="flex-1" />
          </View>

          {/* Step: PIN */}
          {step === "pin" && (
            <View className="flex-1 justify-center pb-16">
              <Text style={styles.title}>Create PIN</Text>
              <Text style={styles.subtitle}>
                Use a 4-digit PIN to protect your wallet
              </Text>
              <View className="mt-10">
                <PinPadInput
                  value={pin}
                  onChange={setPin}
                  onComplete={handlePinComplete}
                />
              </View>
            </View>
          )}

          {/* Step: Confirm */}
          {step === "confirm" && (
            <View className="flex-1 justify-center pb-16">
              <Text style={styles.title}>Confirm PIN</Text>
              <Text style={styles.subtitle}>Enter your PIN again</Text>
              <View className="mt-10">
                <PinPadInput
                  value={confirmPin}
                  onChange={(value) => {
                    setConfirmPin(value);
                    setConfirmError(null);
                  }}
                  onComplete={handleConfirmComplete}
                  error={confirmError}
                />
              </View>
            </View>
          )}

          {/* Step: Import */}
          {step === "import" && (
            <View className="flex-1">
              <Text style={styles.title}>Import Secret Key</Text>
              <Text style={styles.subtitle}>
                Paste your secret key — base58, hex, or JSON byte array
              </Text>
              <View className="mt-6">
                <TextInput
                  style={styles.hexInput}
                  value={hexKey}
                  onChangeText={(text) => {
                    setHexKey(text);
                    setImportError(null);
                  }}
                  placeholder="Paste secret key..."
                  placeholderTextColor="rgba(0,0,0,0.3)"
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
    fontSize: 18,
    color: "rgba(0,0,0,0.5)",
    lineHeight: 24,
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
    color: "#000",
    backgroundColor: "rgba(0,0,0,0.04)",
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
