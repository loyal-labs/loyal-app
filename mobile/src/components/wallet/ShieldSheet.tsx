import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { AlertCircle, ArrowDownUp, ArrowLeft, CheckCircle2 } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard } from "react-native";

import { useShield } from "@/hooks/wallet/useShield";
import { NATIVE_SOL_MINT } from "@/lib/solana/constants";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { Pressable, Text, View } from "@/tw";

type ShieldStep = "form" | "confirm" | "result";
type ShieldDirection = "shield" | "unshield";

type ShieldSheetProps = {
  open: boolean;
  onClose: () => void;
  walletAddress: string | null;
  tokenHoldings: TokenHolding[];
  onShieldComplete?: () => void;
};

function getFriendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("insufficient lamports") || lower.includes("not enough sol"))
    return "You don't have enough SOL to complete this transaction.";
  if (lower.includes("insufficient funds"))
    return "Insufficient funds for this transaction.";
  if (lower.includes("user rejected"))
    return "Transaction was rejected.";
  if (lower.includes("blockhash not found") || lower.includes("block height exceeded"))
    return "The transaction expired. Please try again.";
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "The transaction timed out. Please try again.";
  if (raw.length > 120) return "Something went wrong. Please try again.";
  return raw;
}

export function ShieldSheet({
  open,
  onClose,
  walletAddress,
  tokenHoldings,
  onShieldComplete,
}: ShieldSheetProps) {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [step, setStep] = useState<ShieldStep>("form");
  const [direction, setDirection] = useState<ShieldDirection>("shield");
  const [amountStr, setAmountStr] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultSuccess, setResultSuccess] = useState(false);

  const { executeShield, executeUnshield } = useShield();

  // Find public and secured SOL holdings
  const publicSolHolding = tokenHoldings.find(
    (t) => t.mint === NATIVE_SOL_MINT && !t.isSecured,
  );
  const securedSolHolding = tokenHoldings.find(
    (t) => t.mint === NATIVE_SOL_MINT && t.isSecured,
  );

  const publicBalance = publicSolHolding?.balance ?? 0;
  const securedBalance = securedSolHolding?.balance ?? 0;
  const sourceBalance = direction === "shield" ? publicBalance : securedBalance;

  const amountNum = parseFloat(amountStr) || 0;
  const isValidAmount = amountNum > 0 && amountNum <= sourceBalance;
  const isFormValid = isValidAmount;

  // Reset state when opening
  useEffect(() => {
    if (open) {
      bottomSheetRef.current?.present();
      setStep("form");
      setDirection("shield");
      setAmountStr("");
      setResultError(null);
      setResultSuccess(false);
      setIsProcessing(false);
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [open]);

  const handleConfirm = useCallback(async () => {
    if (!isFormValid || isProcessing || !walletAddress) return;

    Keyboard.dismiss();
    setIsProcessing(true);
    setResultError(null);
    setResultSuccess(false);
    setStep("result");

    try {
      const params = {
        tokenSymbol: "SOL",
        amount: amountNum,
        tokenMint: NATIVE_SOL_MINT,
      };

      const result =
        direction === "shield"
          ? await executeShield(params)
          : await executeUnshield(params);

      if (result.success) {
        setResultSuccess(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onShieldComplete?.();
      } else {
        setResultError(getFriendlyError(result.error ?? "Transaction failed"));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Transaction failed";
      setResultError(getFriendlyError(msg));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsProcessing(false);
    }
  }, [
    isFormValid,
    isProcessing,
    walletAddress,
    amountNum,
    direction,
    executeShield,
    executeUnshield,
    onShieldComplete,
  ]);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.dismiss();
    onClose();
  }, [onClose]);

  const handlePercentage = useCallback(
    (pct: number) => {
      let val = pct === 100 ? sourceBalance : sourceBalance * (pct / 100);
      // Reserve fee for SOL
      if (sourceBalance - val < 0.00005) {
        val = Math.max(0, sourceBalance - 0.00005);
      }
      setAmountStr(val > 0 ? String(Number(val.toFixed(6))) : "");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [sourceBalance],
  );

  const handleDirectionChange = useCallback(
    (newDirection: ShieldDirection) => {
      if (newDirection !== direction) {
        setDirection(newDirection);
        setAmountStr("");
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    },
    [direction],
  );

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.3}
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={["92%"]}
      enablePanDownToClose={step !== "result" || !isProcessing}
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleIndicatorStyle={{ backgroundColor: "rgba(0,0,0,0.15)", width: 36 }}
      backgroundStyle={{ borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetScrollView keyboardShouldPersistTaps="handled">
        <View className="px-6 pb-12 pt-2">
          {/* Header */}
          <View className="mb-4 flex-row items-center justify-center">
            {step === "confirm" && (
              <Pressable
                className="absolute left-0"
                onPress={() => setStep("form")}
              >
                <ArrowLeft size={24} color="#000" />
              </Pressable>
            )}
            <Text
              className="text-[17px] font-semibold text-black"
              style={{ lineHeight: 22 }}
            >
              {step === "form"
                ? "Shield"
                : step === "confirm"
                  ? "Confirm"
                  : ""}
            </Text>
          </View>

          {step === "form" && (
            <FormStep
              direction={direction}
              onDirectionChange={handleDirectionChange}
              amountStr={amountStr}
              onAmountChange={setAmountStr}
              onPercentage={handlePercentage}
              sourceBalance={sourceBalance}
              isValidAmount={amountStr.length > 0 ? isValidAmount : true}
              isFormValid={isFormValid}
              onNext={() => {
                Keyboard.dismiss();
                setStep("confirm");
              }}
            />
          )}

          {step === "confirm" && (
            <ConfirmStep
              direction={direction}
              amountNum={amountNum}
              isProcessing={isProcessing}
              onConfirm={handleConfirm}
            />
          )}

          {step === "result" && (
            <ResultStep
              isProcessing={isProcessing}
              resultError={resultError}
              resultSuccess={resultSuccess}
              direction={direction}
              amountNum={amountNum}
              onDone={handleClose}
            />
          )}
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

// --- Direction Toggle ---
function DirectionToggle({
  direction,
  onDirectionChange,
}: {
  direction: ShieldDirection;
  onDirectionChange: (d: ShieldDirection) => void;
}) {
  return (
    <View
      className="mb-4 flex-row self-start rounded-full p-1"
      style={{ backgroundColor: "rgba(0,0,0,0.04)" }}
    >
      <Pressable
        className="items-center justify-center rounded-full px-4 py-2"
        style={{
          backgroundColor: direction === "shield" ? "#000" : "transparent",
        }}
        onPress={() => onDirectionChange("shield")}
      >
        <Text
          className="text-[15px] font-medium"
          style={{ color: direction === "shield" ? "#fff" : "rgba(60,60,67,0.6)" }}
        >
          Shield
        </Text>
      </Pressable>
      <Pressable
        className="items-center justify-center rounded-full px-4 py-2"
        style={{
          backgroundColor: direction === "unshield" ? "#000" : "transparent",
        }}
        onPress={() => onDirectionChange("unshield")}
      >
        <Text
          className="text-[15px] font-medium"
          style={{ color: direction === "unshield" ? "#fff" : "rgba(60,60,67,0.6)" }}
        >
          Unshield
        </Text>
      </Pressable>
    </View>
  );
}

// --- Form Step ---
function FormStep({
  direction,
  onDirectionChange,
  amountStr,
  onAmountChange,
  onPercentage,
  sourceBalance,
  isValidAmount,
  isFormValid,
  onNext,
}: {
  direction: ShieldDirection;
  onDirectionChange: (d: ShieldDirection) => void;
  amountStr: string;
  onAmountChange: (v: string) => void;
  onPercentage: (pct: number) => void;
  sourceBalance: number;
  isValidAmount: boolean;
  isFormValid: boolean;
  onNext: () => void;
}) {
  return (
    <>
      {/* Direction toggle */}
      <DirectionToggle
        direction={direction}
        onDirectionChange={onDirectionChange}
      />

      {/* Token display */}
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">
        {direction === "shield" ? "From (Public)" : "From (Shielded)"}
      </Text>
      <View className="mb-1 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <View className="flex-row items-center">
          <View className="flex-row items-center rounded-xl bg-neutral-100 px-3 py-2">
            <Text className="text-[14px] font-semibold text-black">SOL</Text>
          </View>
          <BottomSheetTextInput
            style={{
              flex: 1,
              marginLeft: 12,
              textAlign: "right",
              fontSize: 18,
              color: "#000",
            }}
            placeholder="0.00"
            placeholderTextColor="#999"
            value={amountStr}
            onChangeText={onAmountChange}
            keyboardType="decimal-pad"
          />
          <View className="ml-2 flex-row gap-1.5">
            <Pressable
              className="rounded-lg bg-neutral-200 px-2 py-1"
              onPress={() => onPercentage(25)}
            >
              <Text className="text-[11px] font-semibold text-neutral-700">
                25%
              </Text>
            </Pressable>
            <Pressable
              className="rounded-lg bg-neutral-200 px-2 py-1"
              onPress={() => onPercentage(50)}
            >
              <Text className="text-[11px] font-semibold text-neutral-700">
                50%
              </Text>
            </Pressable>
            <Pressable
              className="rounded-lg bg-neutral-200 px-2 py-1"
              onPress={() => onPercentage(100)}
            >
              <Text className="text-[11px] font-semibold text-neutral-700">
                MAX
              </Text>
            </Pressable>
          </View>
        </View>
        <Text className="mt-1 text-[12px] text-neutral-400">
          Balance: {sourceBalance.toFixed(4)} SOL
        </Text>
      </View>
      {!isValidAmount && amountStr.length > 0 && (
        <Text className="mb-1 text-[12px] text-red-500">
          {parseFloat(amountStr) > sourceBalance
            ? "Insufficient balance"
            : "Enter a valid amount"}
        </Text>
      )}

      {/* Direction indicator */}
      <View className="my-2 items-center">
        <View className="rounded-full bg-neutral-100 p-2">
          <ArrowDownUp size={20} color="#000" />
        </View>
      </View>

      {/* Destination */}
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">
        {direction === "shield" ? "To (Shielded)" : "To (Public)"}
      </Text>
      <View className="mb-1 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <View className="flex-row items-center">
          <View className="flex-row items-center rounded-xl bg-neutral-100 px-3 py-2">
            <Text className="text-[14px] font-semibold text-black">SOL</Text>
          </View>
          <View className="ml-3 flex-1 items-end">
            <Text className="text-[18px] text-neutral-300">
              {amountStr && parseFloat(amountStr) > 0
                ? parseFloat(amountStr).toFixed(4)
                : "0.00"}
            </Text>
          </View>
        </View>
      </View>

      <View className="mb-4" />

      {/* Review button */}
      <Pressable
        className={`items-center rounded-2xl py-4 ${!isFormValid ? "opacity-40" : ""}`}
        style={{ backgroundColor: "#f9363c" }}
        onPress={onNext}
        disabled={!isFormValid}
      >
        <Text className="text-[16px] font-semibold text-white">Review</Text>
      </Pressable>
    </>
  );
}

// --- Confirm Step ---
function ConfirmStep({
  direction,
  amountNum,
  isProcessing,
  onConfirm,
}: {
  direction: ShieldDirection;
  amountNum: number;
  isProcessing: boolean;
  onConfirm: () => void;
}) {
  return (
    <>
      <View className="mb-6 rounded-2xl bg-neutral-50 p-4">
        <Row
          label="Direction"
          value={direction === "shield" ? "Shield" : "Unshield"}
        />
        <Row label="Token" value="SOL" />
        <Row label="Amount" value={`${amountNum.toFixed(4)} SOL`} />
        <Row
          label="From"
          value={direction === "shield" ? "Public" : "Shielded"}
        />
        <Row
          label="To"
          value={direction === "shield" ? "Shielded" : "Public"}
        />
      </View>

      <Pressable
        className={`items-center rounded-2xl py-4 ${isProcessing ? "opacity-40" : ""}`}
        style={{ backgroundColor: "#f9363c" }}
        onPress={onConfirm}
        disabled={isProcessing}
      >
        {isProcessing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-[16px] font-semibold text-white">
            {direction === "shield" ? "Confirm and Shield" : "Confirm and Unshield"}
          </Text>
        )}
      </Pressable>
    </>
  );
}

function Row({
  label,
  value,
  isSubtle = false,
}: {
  label: string;
  value: string;
  isSubtle?: boolean;
}) {
  return (
    <View className="flex-row justify-between py-1.5">
      <Text className="text-[14px] text-neutral-500">{label}</Text>
      <Text
        className={`text-[14px] ${isSubtle ? "text-neutral-400" : "font-medium text-black"}`}
      >
        {value}
      </Text>
    </View>
  );
}

// --- Result Step ---
function ResultStep({
  isProcessing,
  resultError,
  resultSuccess,
  direction,
  amountNum,
  onDone,
}: {
  isProcessing: boolean;
  resultError: string | null;
  resultSuccess: boolean;
  direction: ShieldDirection;
  amountNum: number;
  onDone: () => void;
}) {
  if (isProcessing) {
    return (
      <View className="items-center py-12">
        <ActivityIndicator size="large" color="#000" />
        <Text className="mt-4 text-[16px] text-neutral-600">
          {direction === "shield"
            ? "Shielding tokens..."
            : "Unshielding tokens..."}
        </Text>
      </View>
    );
  }

  if (resultError) {
    return (
      <View className="items-center py-8">
        <AlertCircle size={48} color="#ef4444" />
        <Text className="mt-4 text-center text-[16px] font-medium text-red-600">
          {direction === "shield" ? "Shield Failed" : "Unshield Failed"}
        </Text>
        <Text className="mt-2 text-center text-[14px] text-neutral-500">
          {resultError}
        </Text>
        <Pressable
          className="mt-6 w-full items-center rounded-2xl py-4"
          style={{ backgroundColor: "#f9363c" }}
          onPress={onDone}
        >
          <Text className="text-[16px] font-semibold text-white">Done</Text>
        </Pressable>
      </View>
    );
  }

  if (resultSuccess) {
    return (
      <View className="items-center py-8">
        <CheckCircle2 size={48} color="#22c55e" />
        <Text className="mt-4 text-[16px] font-medium text-black">
          {amountNum.toFixed(4)} SOL{" "}
          {direction === "shield" ? "shielded" : "unshielded"}
        </Text>
        <Text className="mt-1 text-[14px] text-neutral-500">
          {direction === "shield"
            ? "Tokens are now in your shielded balance"
            : "Tokens are now in your public balance"}
        </Text>
        <Pressable
          className="mt-6 w-full items-center rounded-2xl py-4"
          style={{ backgroundColor: "#f9363c" }}
          onPress={onDone}
        >
          <Text className="text-[16px] font-semibold text-white">Done</Text>
        </Pressable>
      </View>
    );
  }

  return null;
}
