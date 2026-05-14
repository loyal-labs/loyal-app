import { Eye, EyeOff } from "lucide-react-native";
import { useCallback, useState } from "react";
import { StyleSheet, TextInput } from "react-native";

import {
  getPasswordStrength,
} from "@/lib/wallet/password-strength";
import { Pressable, Text, View } from "@/tw";

type Props = {
  value: string;
  onChange: (text: string) => void;
  onSubmit?: () => void;
  error?: string | null;
  label?: string;
  showStrength?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
};

export function PasswordInput({
  value,
  onChange,
  onSubmit,
  error,
  label,
  showStrength = false,
  placeholder = "Enter password",
  autoFocus = false,
}: Props) {
  const [visible, setVisible] = useState(false);
  const strength = showStrength ? getPasswordStrength(value) : null;

  const toggleVisible = useCallback(() => setVisible((v) => !v), []);

  return (
    <View style={{ width: "100%", gap: 8 }}>
      {label && (
        <Text
          className="text-sm"
          style={{ fontFamily: "Geist_500Medium", color: "rgba(0,0,0,0.5)" }}
        >
          {label}
        </Text>
      )}
      <View
        className="flex-row items-center rounded-2xl px-4"
        style={[styles.inputContainer, error ? styles.inputError : null]}
      >
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          secureTextEntry={!visible}
          placeholder={placeholder}
          placeholderTextColor="rgba(0,0,0,0.3)"
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
        />
        <Pressable onPress={toggleVisible} hitSlop={12}>
          {visible ? (
            <EyeOff size={20} color="rgba(0,0,0,0.4)" strokeWidth={1.5} />
          ) : (
            <Eye size={20} color="rgba(0,0,0,0.4)" strokeWidth={1.5} />
          )}
        </Pressable>
      </View>

      {showStrength && strength && strength.label !== "" && (
        <View style={styles.strengthRow}>
          <View style={styles.strengthTrack}>
            <View
              style={{
                height: "100%",
                width:
                  strength.level === "weak"
                    ? "33%"
                    : strength.level === "fair"
                      ? "66%"
                      : "100%",
                backgroundColor: strength.color,
                borderRadius: 999,
              }}
            />
          </View>
          <Text style={[styles.strengthLabel, { color: strength.color }]}>
            {strength.label}
          </Text>
        </View>
      )}

      {error && (
        <Text style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inputContainer: {
    height: 52,
    backgroundColor: "rgba(0,0,0,0.03)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  inputError: {
    borderColor: "#FF3B30",
  },
  input: {
    flex: 1,
    fontFamily: "Geist_400Regular",
    fontSize: 16,
    color: "#000",
  },
  strengthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  strengthTrack: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.05)",
    overflow: "hidden",
  },
  strengthLabel: {
    fontFamily: "Geist_500Medium",
    fontSize: 13,
    lineHeight: 18,
  },
  errorText: {
    fontFamily: "Geist_500Medium",
    fontSize: 13,
    lineHeight: 18,
    color: "#FF3B30",
    marginTop: 4,
  },
});
