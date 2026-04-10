import { useMemo, useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LogoHeader } from "@/components/LogoHeader";
import {
  buildWalletSetupActions,
  ONBOARDING_SLIDES,
} from "@/components/wallet/onboarding-slides";
import { Pressable, Text, View } from "@/tw";
import { Image } from "@/tw/image";

type Props = {
  seedVaultAvailable: boolean;
  onUseSeedVault: () => void;
  onCreateWallet: () => void;
  onImportWallet: () => void;
};

export function WalletSetupOnboardingScreen({
  seedVaultAvailable,
  onUseSeedVault,
  onCreateWallet,
  onImportWallet,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const { bottom } = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(0);

  const actions = useMemo(
    () => buildWalletSetupActions(seedVaultAvailable),
    [seedVaultAvailable],
  );
  const imageHeight = useMemo(
    () => Math.min(Math.max(height * 0.24, 180), 250),
    [height],
  );

  const actionHandlers = useMemo(
    () => ({
      "seed-vault": onUseSeedVault,
      create: onCreateWallet,
      import: onImportWallet,
    }),
    [onCreateWallet, onImportWallet, onUseSeedVault],
  );

  const handleMomentumEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== currentIndex) {
      setCurrentIndex(next);
    }
  };

  return (
    <View className="flex-1 bg-white">
      <LogoHeader />

      <View className="flex-1">
        <View className="items-center px-4 pb-3 pt-2">
          <View className="flex-row items-center gap-[6px]">
            {ONBOARDING_SLIDES.map((_, index) => (
              <View
                // eslint-disable-next-line react/no-array-index-key
                key={index}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      index === currentIndex
                        ? "#F9363C"
                        : "rgba(249, 54, 60, 0.25)",
                  },
                ]}
              />
            ))}
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleMomentumEnd}
          className="flex-1"
        >
          {ONBOARDING_SLIDES.map((slide, index) => (
            <View
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              style={{ width }}
              className="items-center justify-center px-8"
            >
              <View className="w-full items-center" style={{ maxWidth: 400 }}>
                <View
                  className="w-full items-center justify-center"
                  style={{ height: imageHeight }}
                >
                  <Image
                    source={slide.image}
                    style={styles.slideImage}
                    contentFit="contain"
                    transition={150}
                  />
                </View>

                <View className="mt-6 items-center gap-1">
                  <Text style={styles.title}>{slide.title}</Text>
                  <Text style={styles.description}>{slide.description}</Text>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>

        <View
          className="gap-3 px-6 pt-4"
          style={{ paddingBottom: Math.max(bottom + 12, 24) }}
        >
          {actions.map((action, index) => {
            const isPrimary = index === 0;
            const pressableStyle = [
              isPrimary ? styles.primaryButton : styles.secondaryButton,
              action.disabled && styles.disabledButton,
            ];
            const textStyle = [
              isPrimary
                ? styles.primaryButtonText
                : styles.secondaryButtonText,
              action.disabled && styles.disabledButtonText,
            ];

            return (
              <View key={action.id} className="gap-2">
                <Pressable
                  style={pressableStyle}
                  onPress={actionHandlers[action.id]}
                  disabled={action.disabled}
                >
                  <Text style={textStyle}>{action.label}</Text>
                </Pressable>

                {action.helperText ? (
                  <Text style={styles.helperText}>{action.helperText}</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  slideImage: {
    width: "100%",
    height: "100%",
  },
  title: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 22,
    lineHeight: 28,
    color: "#000",
    textAlign: "center",
  },
  description: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "rgba(60, 60, 67, 0.6)",
    textAlign: "center",
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
});
