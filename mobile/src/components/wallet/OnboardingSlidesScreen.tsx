import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from "react-native";

import { LogoHeader } from "@/components/LogoHeader";
import {
  advanceOnboardingSlidePlayback,
  createOnboardingMomentumEndUpdater,
  createOnboardingSlidePlaybackState,
  disableOnboardingSlidePlayback,
} from "@/components/wallet/onboarding-slide-playback";
import { ONBOARDING_SLIDES } from "@/components/wallet/onboarding-slides";
import { Pressable, Text, View } from "@/tw";
import { Image } from "@/tw/image";

type Props = {
  onDone: () => void;
};

export function OnboardingSlidesScreen({ onDone }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const { width, height } = useWindowDimensions();
  const [playbackState, setPlaybackState] = useState(() =>
    createOnboardingSlidePlaybackState(),
  );
  const currentIndex = playbackState.currentIndex;

  const isLast = currentIndex === ONBOARDING_SLIDES.length - 1;

  const imageHeight = useMemo(
    () => Math.min(Math.max(height * 0.38, 240), 380),
    [height],
  );

  const triggerLightHaptic = useCallback(() => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const scrollToIndex = useCallback(
    (nextIndex: number) => {
      scrollRef.current?.scrollTo({ x: nextIndex * width, animated: true });
    },
    [width],
  );

  useEffect(() => {
    if (!playbackState.autoAdvanceEnabled || ONBOARDING_SLIDES.length <= 1) {
      return;
    }

    const timer = setTimeout(() => {
      const nextState = advanceOnboardingSlidePlayback(
        playbackState,
        ONBOARDING_SLIDES.length,
      );
      scrollToIndex(nextState.currentIndex);
      setPlaybackState(nextState);
    }, 2500);

    return () => clearTimeout(timer);
  }, [currentIndex, playbackState, scrollToIndex]);

  const handleNext = useCallback(() => {
    triggerLightHaptic();
    if (isLast) {
      onDone();
      return;
    }

    const next = Math.min(currentIndex + 1, ONBOARDING_SLIDES.length - 1);
    setPlaybackState((currentState) => ({
      ...currentState,
      currentIndex: next,
    }));
    scrollToIndex(next);
  }, [currentIndex, isLast, onDone, scrollToIndex, triggerLightHaptic]);

  const handleSkip = useCallback(() => {
    triggerLightHaptic();
    onDone();
  }, [onDone, triggerLightHaptic]);

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setPlaybackState(
        createOnboardingMomentumEndUpdater(
          event,
          width,
          ONBOARDING_SLIDES.length,
        ),
      );
    },
    [width],
  );

  const handleScrollBeginDrag = useCallback(() => {
    setPlaybackState((currentState) =>
      disableOnboardingSlidePlayback(currentState),
    );
  }, []);

  return (
    <View className="flex-1 bg-white">
      <LogoHeader />

      <View className="flex-1">
        <View className="relative flex-row items-center justify-center px-4 pb-2 pt-4">
          <View className="flex-row items-center gap-[6px]">
            {ONBOARDING_SLIDES.map((slide, index) => (
              <View
                key={`dot-${slide.title}`}
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

          {!isLast ? (
            <Pressable
              onPress={handleSkip}
              className="absolute right-4 h-[44px] items-center justify-center rounded-full px-4"
              style={{ backgroundColor: "rgba(249, 54, 60, 0.14)" }}
            >
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={handleScrollBeginDrag}
          onMomentumScrollEnd={handleMomentumEnd}
          className="flex-1"
        >
          {ONBOARDING_SLIDES.map((slide) => (
            <View
              key={slide.title}
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

        <View className="px-8 pb-10 pt-2">
          <Pressable onPress={handleNext} style={styles.nextButton}>
            <Text style={styles.nextButtonText}>
              {isLast ? "Get Started" : "Next"}
            </Text>
          </Pressable>
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
  skipText: {
    fontFamily: "Geist_500Medium",
    fontSize: 17,
    lineHeight: 22,
    color: "#000",
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
  nextButton: {
    height: 50,
    borderRadius: 999,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  nextButtonText: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "#fff",
  },
});
