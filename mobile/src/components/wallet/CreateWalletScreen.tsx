import { Keypair } from "@solana/web3.js";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInLeft,
  FadeInRight,
  FadeOut,
} from "react-native-reanimated";

import ShieldIcon from "../../../assets/images/Shield_40.svg";
import {
  getCreateWalletBackTarget,
  scheduleCreateWalletDeferredAction,
  scheduleCreateWalletConfirmTransition,
  type CreateWalletScreenStep,
} from "@/components/wallet/create-wallet-transition";
import { PinPadInput } from "@/components/wallet/PinPadInput";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, ScrollView, Text, View } from "@/tw";

type TransitionDirection = "forward" | "backward";

type Props = {
  onComplete: (keypair: Keypair, pin: string) => void;
  onBack?: () => void;
};

function getStepEnteringAnimation(direction: TransitionDirection) {
  const easing = Easing.out(Easing.cubic);

  return direction === "forward"
    ? FadeInRight.duration(240).easing(easing)
    : FadeInLeft.duration(240).easing(easing);
}

const STEP_EXITING_ANIMATION = FadeOut.duration(160).easing(
  Easing.out(Easing.quad),
);

export function CreateWalletScreen({ onComplete, onBack }: Props) {
  const { createWallet } = useWallet();

  const [step, setStep] = useState<CreateWalletScreenStep>("pin");
  const [transitionDirection, setTransitionDirection] =
    useState<TransitionDirection>("forward");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [pinTransitionPending, setPinTransitionPending] = useState(false);
  const [confirmTransitionPending, setConfirmTransitionPending] = useState(false);
  const [stepAnimationsReady, setStepAnimationsReady] = useState(false);

  const cancelConfirmTransitionRef = useRef<null | (() => void)>(null);
  const cancelConfirmCompletionRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    setStepAnimationsReady(true);
  }, []);

  const clearConfirmTransition = useCallback(() => {
    cancelConfirmTransitionRef.current?.();
    cancelConfirmTransitionRef.current = null;
    setPinTransitionPending(false);
  }, []);

  const clearConfirmCompletion = useCallback(() => {
    cancelConfirmCompletionRef.current?.();
    cancelConfirmCompletionRef.current = null;
    setConfirmTransitionPending(false);
  }, []);

  useEffect(() => clearConfirmTransition, [clearConfirmTransition]);
  useEffect(() => clearConfirmCompletion, [clearConfirmCompletion]);

  const handlePinComplete = useCallback(
    (nextPin: string) => {
      clearConfirmTransition();
      setPin(nextPin);
      setConfirmPin("");
      setConfirmError(null);
      setPinTransitionPending(true);

      cancelConfirmTransitionRef.current = scheduleCreateWalletConfirmTransition(
        nextPin,
        (resolvedPin) => {
          cancelConfirmTransitionRef.current = null;
          setTransitionDirection("forward");
          setPin(resolvedPin);
          setConfirmPin("");
          setConfirmError(null);
          setPinTransitionPending(false);
          setStep("confirm");
        },
      );
    },
    [clearConfirmTransition],
  );

  const handleConfirmComplete = useCallback(
    (nextConfirmPin: string) => {
      clearConfirmCompletion();
      setConfirmPin(nextConfirmPin);
      setConfirmTransitionPending(true);

      cancelConfirmCompletionRef.current = scheduleCreateWalletDeferredAction(
        () => {
          cancelConfirmCompletionRef.current = null;
          setConfirmTransitionPending(false);

          if (nextConfirmPin !== pin) {
            setConfirmError("PINs don't match");
            setConfirmPin("");
            return;
          }

          setConfirmError(null);
          try {
            const kp = createWallet(nextConfirmPin);
            onComplete(kp, nextConfirmPin);
          } catch (e) {
            setConfirmError(
              e instanceof Error ? e.message : "Failed to create wallet",
            );
          }
        },
      );
    },
    [clearConfirmCompletion, pin, createWallet, onComplete],
  );

  const handleBack = useCallback(() => {
    clearConfirmTransition();
    clearConfirmCompletion();

    const backTarget = getCreateWalletBackTarget(step);
    if (backTarget === "chooser") {
      setPin("");
      setConfirmPin("");
      setConfirmError(null);
      onBack?.();
      return;
    }

    setTransitionDirection("backward");
    setPin("");
    setConfirmPin("");
    setConfirmError(null);
    setStep("pin");
  }, [clearConfirmCompletion, clearConfirmTransition, onBack, step]);

  const currentTitle = step === "pin" ? "Create PIN" : "Confirm PIN";
  const currentSubtitle =
    step === "pin"
      ? "Use a 4-digit PIN to protect your wallet"
      : "Enter your PIN again";

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="flex-grow px-6 pt-16 pb-10"
      keyboardShouldPersistTaps="handled"
    >
      <Animated.View
        key={step}
        style={styles.stepContainer}
        entering={
          stepAnimationsReady
            ? getStepEnteringAnimation(transitionDirection)
            : FadeIn.duration(0)
        }
        exiting={
          stepAnimationsReady ? STEP_EXITING_ANIMATION : FadeOut.duration(0)
        }
      >
        <View style={styles.stepHeader}>
          <Pressable
            onPress={handleBack}
            hitSlop={16}
            className="h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: "rgba(0,0,0,0.05)" }}
          >
            <ArrowLeft size={20} color="#000" strokeWidth={2} />
          </Pressable>
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.title}>{currentTitle}</Text>
          <ShieldIcon width={30} height={30} />
        </View>
        <Text style={styles.subtitle}>{currentSubtitle}</Text>

        <View className="mt-10">
          {step === "pin" ? (
            <PinPadInput
              value={pin}
              onChange={setPin}
              onComplete={handlePinComplete}
              disabled={pinTransitionPending}
            />
          ) : (
            <PinPadInput
              value={confirmPin}
              onChange={(value) => {
                setConfirmPin(value);
                if (confirmError) setConfirmError(null);
              }}
              onComplete={handleConfirmComplete}
              error={confirmError}
              disabled={confirmTransitionPending}
            />
          )}
        </View>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stepContainer: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: 64,
  },
  stepHeader: {
    height: 56,
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontFamily: "Geist_700Bold",
    fontSize: 28,
    color: "#000",
    lineHeight: 34,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  subtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 18,
    color: "rgba(0,0,0,0.5)",
    marginTop: 8,
    lineHeight: 24,
  },
});
