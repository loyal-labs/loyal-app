import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import { Pressable, Text, View } from "@/tw";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { AsYouType, isValidPhoneNumber } from "libphonenumber-js";
import { Globe, X } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { Keyboard, Platform, StyleSheet, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function countryCodeToFlag(code: string): string {
  return [...code.toUpperCase()]
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

export default function PhoneScreen() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const kbHeight = useKeyboardHeight();
  const inputRef = useRef<TextInput>(null);
  const [rawValue, setRawValue] = useState("+");

  const { formatted, country, isValid } = useMemo(() => {
    const digitsAfterPlus = rawValue.replace(/[^\d]/g, "");
    if (!digitsAfterPlus) {
      return { formatted: "+", country: null, isValid: false };
    }
    const withPlus = `+${digitsAfterPlus}`;
    const formatter = new AsYouType();
    const result = formatter.input(withPlus);
    const detectedCountry = formatter.getCountry() ?? null;
    return {
      formatted: result || withPlus,
      country: detectedCountry,
      isValid: isValidPhoneNumber(withPlus),
    };
  }, [rawValue]);

  const flagOrIcon = country ? (
    <Text style={styles.flag}>{countryCodeToFlag(country)}</Text>
  ) : (
    <Globe size={28} color="rgba(60,60,67,0.6)" strokeWidth={1.5} />
  );

  const handleChangeText = useCallback((text: string) => {
    if (!text.startsWith("+")) {
      text = "+" + text.replace(/\+/g, "");
    }
    setRawValue(text);
  }, []);

  const handleClear = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setRawValue("+");
    inputRef.current?.focus();
  }, []);

  const handleContinue = useCallback(() => {
    if (!isValid) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    Keyboard.dismiss();
    router.push({
      pathname: "/login/code",
      params: { phone: formatted },
    });
  }, [isValid, formatted, router]);

  const showClear = rawValue.length > 1;
  const keyboardUp = kbHeight > 0;

  return (
    <View className="flex-1 bg-white">
      <Pressable
        style={styles.content}
        onPress={() => inputRef.current?.focus()}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Log In</Text>
          <Text style={styles.subtitle}>Enter your phone number</Text>
        </View>

        <View style={styles.inputContainer}>
          <View style={styles.leftIcon}>{flagOrIcon}</View>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={formatted}
            onChangeText={handleChangeText}
            keyboardType="phone-pad"
            placeholder="+000 000 000 000"
            placeholderTextColor="rgba(60,60,67,0.6)"
            autoFocus
            selectionColor="#000"
          />
          {showClear && (
            <Pressable style={styles.rightIcon} onPress={handleClear}>
              <X size={24} color="rgba(60,60,67,0.3)" strokeWidth={2} />
            </Pressable>
          )}
        </View>
      </Pressable>

      <View
        style={[
          styles.buttonBody,
          { bottom: keyboardUp ? kbHeight : 0 },
        ]}
      >
        <LinearGradient
          colors={["rgba(255,255,255,0)", "#fff"]}
          style={styles.gradient}
        />
        <View
          style={[
            styles.buttonWrap,
            { paddingBottom: keyboardUp ? 24 : bottom + 24 },
          ]}
        >
          <Pressable
            style={[styles.button, !isValid && styles.buttonDisabled]}
            onPress={handleContinue}
            disabled={!isValid}
          >
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 48,
    gap: 32,
    alignItems: "center",
  },
  header: {
    alignItems: "center",
    gap: 4,
  },
  title: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 22,
    lineHeight: 28,
    color: "#000",
    textAlign: "center",
  },
  subtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "rgba(60,60,67,0.6)",
    textAlign: "center",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f2f2f7",
    borderRadius: 47,
    paddingHorizontal: 16,
    width: "100%",
  },
  leftIcon: {
    paddingRight: 12,
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  flag: {
    fontSize: 28,
    lineHeight: 28,
  },
  input: {
    flex: 1,
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "#000",
    paddingVertical: 15,
  },
  rightIcon: {
    paddingLeft: 12,
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonBody: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  gradient: {
    height: 16,
  },
  buttonWrap: {
    backgroundColor: "#fff",
    paddingHorizontal: 32,
  },
  button: {
    height: 50,
    backgroundColor: "#000",
    borderRadius: 78,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  buttonDisabled: {
    backgroundColor: "#d0d0d2",
  },
  buttonText: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "#fff",
  },
});
