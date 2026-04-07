import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as Haptics from "expo-haptics";
import { AlertCircle, ArrowLeft, CheckCircle2 } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard } from "react-native";

import { SOLANA_FEE_SOL } from "@/lib/solana/constants";
import { sendSolTransaction } from "@/lib/solana/wallet/wallet-details";
import { Pressable, Text, View } from "@/tw";

// Basic Solana address validation (base58, 32-44 chars)
const isValidSolanaAddress = (address: string): boolean => {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (!base58Regex.test(address)) return false;
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
};

function getFriendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("insufficient lamports") || lower.includes("not enough sol"))
    return "You don't have enough SOL to complete this transaction.";
  if (lower.includes("insufficient funds"))
    return "Insufficient funds for this transaction.";
  if (lower.includes("blockhash not found") || lower.includes("block height exceeded"))
    return "The transaction expired. Please try again.";
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "The transaction timed out. Please try again.";
  if (raw.length > 120) return "Something went wrong. Please try again.";
  return raw;
}

type SendStep = "form" | "confirm" | "result";

type SendSheetProps = {
  open: boolean;
  onClose: () => void;
  walletAddress: string | null;
  solBalanceLamports: number | null;
  solPriceUsd: number | null;
  onSendComplete?: () => void;
};

export function SendSheet({
  open,
  onClose,
  walletAddress,
  solBalanceLamports,
  solPriceUsd,
  onSendComplete,
}: SendSheetProps) {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [step, setStep] = useState<SendStep>("form");
  const [recipient, setRecipient] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [currency, setCurrency] = useState<"SOL" | "USD">("SOL");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const balanceInSol = solBalanceLamports
    ? solBalanceLamports / LAMPORTS_PER_SOL
    : 0;

  const amountNum = parseFloat(amountStr) || 0;
  const amountInSol =
    currency === "SOL"
      ? amountNum
      : solPriceUsd
        ? amountNum / solPriceUsd
        : 0;
  const amountInUsd =
    currency === "USD"
      ? amountNum
      : solPriceUsd
        ? amountNum * solPriceUsd
        : 0;

  const isValidRecipient = isValidSolanaAddress(recipient.trim());
  const isValidAmount = amountInSol > 0 && amountInSol <= balanceInSol;
  const isFormValid = isValidRecipient && isValidAmount;

  // Reset state when opening
  useEffect(() => {
    if (open) {
      bottomSheetRef.current?.present();
      setStep("form");
      setRecipient("");
      setAmountStr("");
      setCurrency("SOL");
      setSendError(null);
      setTxSignature(null);
      setIsSending(false);
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [open]);

  const handleSend = useCallback(async () => {
    if (!isFormValid || isSending) return;

    Keyboard.dismiss();
    setIsSending(true);
    setSendError(null);
    setStep("result");

    try {
      const lamports = Math.floor(amountInSol * LAMPORTS_PER_SOL);
      const sig = await sendSolTransaction(recipient.trim(), lamports);
      setTxSignature(sig);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSendComplete?.();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Transaction failed";
      setSendError(getFriendlyError(msg));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSending(false);
    }
  }, [isFormValid, isSending, amountInSol, recipient, onSendComplete]);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.dismiss();
    onClose();
  }, [onClose]);

  const toggleCurrency = useCallback(() => {
    if (!solPriceUsd) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currency === "SOL") {
      const usd = amountNum * solPriceUsd;
      setCurrency("USD");
      setAmountStr(usd > 0 ? usd.toFixed(2) : "");
    } else {
      const sol = amountNum / solPriceUsd;
      setCurrency("SOL");
      setAmountStr(sol > 0 ? sol.toFixed(4) : "");
    }
  }, [currency, amountNum, solPriceUsd]);

  const handlePercentage = useCallback(
    (pct: number) => {
      let val = pct === 100 ? balanceInSol : balanceInSol * (pct / 100);
      // Always reserve fee for SOL
      if (balanceInSol - val < 0.00005) {
        val = Math.max(0, balanceInSol - 0.00005);
      }
      if (currency === "SOL") {
        setAmountStr(val > 0 ? String(Number(val.toFixed(6))) : "");
      } else if (solPriceUsd) {
        setAmountStr(val > 0 ? (val * solPriceUsd).toFixed(2) : "");
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [balanceInSol, currency, solPriceUsd],
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

  const feeDisplay = solPriceUsd
    ? `~$${(SOLANA_FEE_SOL * solPriceUsd).toFixed(4)}`
    : `${SOLANA_FEE_SOL} SOL`;

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={["55%", "90%"]}
      enablePanDownToClose={step !== "result" || !isSending}
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
                ? "Send"
                : step === "confirm"
                  ? "Confirm"
                  : ""}
            </Text>
          </View>

          {step === "form" && (
            <FormStep
              recipient={recipient}
              onRecipientChange={setRecipient}
              amountStr={amountStr}
              onAmountChange={setAmountStr}
              currency={currency}
              onToggleCurrency={toggleCurrency}
              onPercentage={handlePercentage}
              balanceInSol={balanceInSol}
              solPriceUsd={solPriceUsd}
              isValidRecipient={recipient.trim().length > 0 ? isValidRecipient : true}
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
              recipient={recipient}
              amountInSol={amountInSol}
              amountInUsd={amountInUsd}
              feeDisplay={feeDisplay}
              isSending={isSending}
              onConfirm={handleSend}
            />
          )}

          {step === "result" && (
            <ResultStep
              isSending={isSending}
              sendError={sendError}
              txSignature={txSignature}
              amountInSol={amountInSol}
              recipient={recipient}
              onDone={handleClose}
            />
          )}
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

// --- Form Step ---
function FormStep({
  recipient,
  onRecipientChange,
  amountStr,
  onAmountChange,
  currency,
  onToggleCurrency,
  onPercentage,
  balanceInSol,
  solPriceUsd,
  isValidRecipient,
  isValidAmount,
  isFormValid,
  onNext,
}: {
  recipient: string;
  onRecipientChange: (v: string) => void;
  amountStr: string;
  onAmountChange: (v: string) => void;
  currency: "SOL" | "USD";
  onToggleCurrency: () => void;
  onPercentage: (pct: number) => void;
  balanceInSol: number;
  solPriceUsd: number | null;
  isValidRecipient: boolean;
  isValidAmount: boolean;
  isFormValid: boolean;
  onNext: () => void;
}) {
  return (
    <>
      {/* Recipient */}
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">To</Text>
      <BottomSheetTextInput
        style={{
          marginBottom: 4,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "rgba(0,0,0,0.1)",
          backgroundColor: "rgb(250,250,250)",
          paddingHorizontal: 16,
          paddingVertical: 12,
          fontSize: 16,
          color: "#000",
        }}
        placeholder="Wallet address"
        placeholderTextColor="#999"
        value={recipient}
        onChangeText={onRecipientChange}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {!isValidRecipient && (
        <Text className="mb-2 text-[12px] text-red-500">Invalid Solana address</Text>
      )}
      {isValidRecipient && <View className="mb-3" />}

      {/* Amount */}
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">
        Amount
      </Text>
      <View className="mb-1 flex-row items-center rounded-xl border border-neutral-200 bg-neutral-50">
        <BottomSheetTextInput
          style={{
            flex: 1,
            paddingHorizontal: 16,
            paddingVertical: 12,
            fontSize: 16,
            color: "#000",
          }}
          placeholder="0.00"
          placeholderTextColor="#999"
          value={amountStr}
          onChangeText={onAmountChange}
          keyboardType="decimal-pad"
        />
        <Pressable
          className="px-2 py-1"
          onPress={onToggleCurrency}
        >
          <Text className="text-[14px] font-medium text-neutral-600">
            {currency}
          </Text>
        </Pressable>
        <View className="mr-3 flex-row gap-2">
          <Pressable className="rounded-lg bg-neutral-200 px-2.5 py-1" onPress={() => onPercentage(25)}>
            <Text className="text-[12px] font-semibold text-neutral-700">25%</Text>
          </Pressable>
          <Pressable className="rounded-lg bg-neutral-200 px-2.5 py-1" onPress={() => onPercentage(50)}>
            <Text className="text-[12px] font-semibold text-neutral-700">50%</Text>
          </Pressable>
          <Pressable className="rounded-lg bg-neutral-200 px-2.5 py-1" onPress={() => onPercentage(100)}>
            <Text className="text-[12px] font-semibold text-neutral-700">MAX</Text>
          </Pressable>
        </View>
      </View>
      {!isValidAmount && amountStr.length > 0 && (
        <Text className="mb-2 text-[12px] text-red-500">
          {parseFloat(amountStr) > balanceInSol
            ? "Insufficient balance"
            : "Enter a valid amount"}
        </Text>
      )}

      {/* Balance info */}
      <Text className="mb-6 text-[12px] text-neutral-400">
        Balance: {balanceInSol.toFixed(4)} SOL
        {solPriceUsd
          ? ` (~$${(balanceInSol * solPriceUsd).toFixed(2)})`
          : ""}
      </Text>

      {/* Next button */}
      <Pressable
        className={`items-center rounded-2xl py-4 ${!isFormValid ? "opacity-40" : ""}`}
        style={{ backgroundColor: "#f9363c" }}
        onPress={onNext}
        disabled={!isFormValid}
      >
        <Text className="text-[16px] font-semibold text-white">
          Review
        </Text>
      </Pressable>
    </>
  );
}

// --- Confirm Step ---
function ConfirmStep({
  recipient,
  amountInSol,
  amountInUsd,
  feeDisplay,
  isSending,
  onConfirm,
}: {
  recipient: string;
  amountInSol: number;
  amountInUsd: number;
  feeDisplay: string;
  isSending: boolean;
  onConfirm: () => void;
}) {
  const shortAddr = `${recipient.slice(0, 6)}...${recipient.slice(-4)}`;

  return (
    <>
      <View className="mb-6 rounded-2xl bg-neutral-50 p-4">
        <Row label="To" value={shortAddr} />
        <Row label="Amount" value={`${amountInSol.toFixed(4)} SOL`} />
        {amountInUsd > 0 && (
          <Row label="" value={`~$${amountInUsd.toFixed(2)}`} isSubtle />
        )}
        <Row label="Network fee" value={feeDisplay} />
      </View>

      <Pressable
        className={`items-center rounded-2xl py-4 ${isSending ? "opacity-40" : ""}`}
        style={{ backgroundColor: "#f9363c" }}
        onPress={onConfirm}
        disabled={isSending}
      >
        {isSending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-[16px] font-semibold text-white">
            Confirm and Send
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
  isSending,
  sendError,
  txSignature,
  amountInSol,
  recipient,
  onDone,
}: {
  isSending: boolean;
  sendError: string | null;
  txSignature: string | null;
  amountInSol: number;
  recipient: string;
  onDone: () => void;
}) {
  if (isSending) {
    return (
      <View className="items-center py-12">
        <ActivityIndicator size="large" color="#000" />
        <Text className="mt-4 text-[16px] text-neutral-600">
          Sending transaction...
        </Text>
      </View>
    );
  }

  if (sendError) {
    return (
      <View className="items-center py-8">
        <AlertCircle size={48} color="#ef4444" />
        <Text className="mt-4 text-center text-[16px] font-medium text-red-600">
          Transaction Failed
        </Text>
        <Text className="mt-2 text-center text-[14px] text-neutral-500">
          {sendError}
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

  return (
    <View className="items-center py-8">
      <CheckCircle2 size={48} color="#22c55e" />
      <Text className="mt-4 text-[16px] font-medium text-black">
        {amountInSol.toFixed(4)} SOL sent
      </Text>
      <Text className="mt-1 text-[14px] text-neutral-500">
        to {recipient.slice(0, 6)}...{recipient.slice(-4)}
      </Text>
      {txSignature && (
        <Text className="mt-2 text-[12px] text-neutral-400" numberOfLines={1}>
          Tx: {txSignature.slice(0, 12)}...
        </Text>
      )}
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
