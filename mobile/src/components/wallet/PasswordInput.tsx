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
    <View className="w-full gap-2">
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
        <View className="flex-row items-center gap-2">
          <View className="h-1 flex-1 overflow-hidden rounded-full bg-black/5">
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
          <Text
            className="text-xs"
            style={{ fontFamily: "Geist_500Medium", color: strength.color }}
          >
            {strength.label}
          </Text>
        </View>
      )}

      {error && (
        <Text
          className="text-xs"
          style={{ fontFamily: "Geist_500Medium", color: "#FF3B30" }}
        >
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
});
