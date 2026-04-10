import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard } from "react-native";

import { useShield } from "@/hooks/wallet/useShield";
import { NATIVE_SOL_MINT } from "@/lib/solana/constants";
import {
  buildShieldAssets,
  getShieldDirection,
  type ShieldAsset,
  type ShieldDirection,
} from "@/lib/solana/shielding";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { Image } from "@/tw/image";
import { Pressable, Text, View } from "@/tw";

type ShieldStep = "form" | "confirm" | "result";

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

function formatBalance(balance: number, decimals: number): string {
  if (balance <= 0) return "0";
  if (balance < 0.0001) return "<0.0001";
  const precision = decimals > 4 ? 4 : decimals;
  return balance.toFixed(precision);
}

function getBalanceSourceLabel(asset: Pick<ShieldAsset, "isSecured">): string {
  return asset.isSecured ? "Shielded balance" : "Public balance";
}

function getOperationLabel(direction: ShieldDirection): string {
  return direction === "shield" ? "Shield" : "Unshield";
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
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [selectedAssetKey, setSelectedAssetKey] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultSuccess, setResultSuccess] = useState(false);

  const { executeShield, executeUnshield } = useShield();

  const shieldAssets = useMemo(
    () => buildShieldAssets(tokenHoldings),
    [tokenHoldings],
  );

  const selectedAsset = useMemo(
    () =>
      shieldAssets.find((asset) => asset.key === selectedAssetKey) ??
      shieldAssets[0] ??
      null,
    [selectedAssetKey, shieldAssets],
  );

  const direction = getShieldDirection(selectedAsset);
  const selectedAssetIcon = resolveTokenIcon({
    mint: selectedAsset?.mint ?? NATIVE_SOL_MINT,
    imageUrl: selectedAsset?.imageUrl ?? null,
  });
  const sourceBalance = selectedAsset?.balance ?? 0;
  const amountNum = parseFloat(amountStr) || 0;
  const isValidAmount =
    Boolean(selectedAsset) && amountNum > 0 && amountNum <= sourceBalance;
  const isFormValid = isValidAmount;

  useEffect(() => {
    if (open) {
      bottomSheetRef.current?.present();
      setStep("form");
      setShowTokenPicker(false);
      setSelectedAssetKey(null);
      setAmountStr("");
      setResultError(null);
      setResultSuccess(false);
      setIsProcessing(false);
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!selectedAssetKey || !shieldAssets.some((asset) => asset.key === selectedAssetKey)) {
      setSelectedAssetKey(shieldAssets[0]?.key ?? null);
    }
  }, [open, selectedAssetKey, shieldAssets]);

  const handleConfirm = useCallback(async () => {
    if (!isFormValid || isProcessing || !walletAddress || !selectedAsset) return;

    Keyboard.dismiss();
    setIsProcessing(true);
    setResultError(null);
    setResultSuccess(false);
    setStep("result");

    try {
      const params = {
        tokenSymbol: selectedAsset.symbol,
        amount: amountNum,
        tokenMint: selectedAsset.mint,
        tokenDecimals: selectedAsset.decimals,
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
    amountNum,
    direction,
    executeShield,
    executeUnshield,
    isFormValid,
    isProcessing,
    onShieldComplete,
    selectedAsset,
    walletAddress,
  ]);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.dismiss();
  }, []);

  const handlePercentage = useCallback(
    (pct: number) => {
      if (!selectedAsset) return;

      let val = pct === 100 ? sourceBalance : sourceBalance * (pct / 100);
      if (selectedAsset.mint === NATIVE_SOL_MINT && sourceBalance - val < 0.00005) {
        val = Math.max(0, sourceBalance - 0.00005);
      }

      setAmountStr(val > 0 ? String(Number(val.toFixed(6))) : "");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [selectedAsset, sourceBalance],
  );

  const handleSelectAsset = useCallback((assetKey: string) => {
    setSelectedAssetKey(assetKey);
    setAmountStr("");
    setShowTokenPicker(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

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

  const title = showTokenPicker
    ? "Select Token"
    : step === "confirm"
      ? "Confirm"
      : getOperationLabel(direction);

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={["92%"]}
      enablePanDownToClose={step !== "result" || !isProcessing}
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleIndicatorStyle={{ backgroundColor: "rgba(0,0,0,0.15)", width: 36 }}
      backgroundStyle={{ borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetScrollView keyboardShouldPersistTaps="handled">
        <View className="px-6 pb-12 pt-2">
          <View className="mb-4 flex-row items-center justify-center">
            {(showTokenPicker || step === "confirm") && (
              <Pressable
                className="absolute left-0"
                onPress={() => {
                  if (showTokenPicker) {
                    setShowTokenPicker(false);
                    return;
                  }
                  setStep("form");
                }}
              >
                <ArrowLeft size={24} color="#000" />
              </Pressable>
            )}
            <Text
              className="text-[17px] font-semibold text-black"
              style={{ lineHeight: 22 }}
            >
              {step === "result" ? "" : title}
            </Text>
          </View>

          {showTokenPicker ? (
            <TokenPicker
              assets={shieldAssets}
              onSelect={handleSelectAsset}
            />
          ) : null}

          {!showTokenPicker && step === "form" ? (
            <FormStep
              direction={direction}
              selectedAsset={selectedAsset}
              selectedAssetIcon={selectedAssetIcon}
              amountStr={amountStr}
              onAmountChange={setAmountStr}
              onOpenTokenPicker={() => {
                Keyboard.dismiss();
                setShowTokenPicker(true);
              }}
              onPercentage={handlePercentage}
              sourceBalance={sourceBalance}
              isValidAmount={amountStr.length > 0 ? isValidAmount : true}
              isFormValid={isFormValid}
              onNext={() => {
                Keyboard.dismiss();
                setStep("confirm");
              }}
            />
          ) : null}

          {!showTokenPicker && step === "confirm" ? (
            <ConfirmStep
              direction={direction}
              amountNum={amountNum}
              selectedAsset={selectedAsset}
              isProcessing={isProcessing}
              onConfirm={handleConfirm}
            />
          ) : null}

          {!showTokenPicker && step === "result" ? (
            <ResultStep
              isProcessing={isProcessing}
              resultError={resultError}
              resultSuccess={resultSuccess}
              direction={direction}
              amountNum={amountNum}
              selectedAsset={selectedAsset}
              onDone={handleClose}
            />
          ) : null}
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

function FormStep({
  direction,
  selectedAsset,
  selectedAssetIcon,
  amountStr,
  onAmountChange,
  onOpenTokenPicker,
  onPercentage,
  sourceBalance,
  isValidAmount,
  isFormValid,
  onNext,
}: {
  direction: ShieldDirection;
  selectedAsset: ShieldAsset | null;
  selectedAssetIcon: string;
  amountStr: string;
  onAmountChange: (value: string) => void;
  onOpenTokenPicker: () => void;
  onPercentage: (pct: number) => void;
  sourceBalance: number;
  isValidAmount: boolean;
  isFormValid: boolean;
  onNext: () => void;
}) {
  const balanceLabel = selectedAsset
    ? getBalanceSourceLabel(selectedAsset)
    : "Available balances";

  return (
    <>
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">
        Token
      </Text>
      <TokenSelectorButton
        asset={selectedAsset}
        icon={selectedAssetIcon}
        onPress={onOpenTokenPicker}
      />

      {selectedAsset ? (
        <View className="mb-4 mt-3 rounded-2xl bg-neutral-50 p-4">
          <Row label="Operation" value={getOperationLabel(direction)} />
          <Row label="Using" value={balanceLabel} />
        </View>
      ) : (
        <Text className="mb-4 mt-3 text-[13px] text-neutral-500">
          No token balances are available to shield right now.
        </Text>
      )}

      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">
        Amount
      </Text>
      <View className="mb-1 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <View className="flex-row items-center">
          <View className="flex-row items-center rounded-xl bg-neutral-100 px-3 py-2">
            <Image
              source={selectedAsset ? selectedAssetIcon : resolveTokenIcon({ mint: NATIVE_SOL_MINT })}
              style={{ width: 20, height: 20, borderRadius: 10 }}
            />
            <Text className="ml-2 text-[14px] font-semibold text-black">
              {selectedAsset?.symbol ?? "Token"}
            </Text>
          </View>
          <BottomSheetTextInput
            style={{
              flex: 1,
              marginLeft: 12,
              textAlign: "right",
              fontSize: 18,
              color: "#000",
            }}
            editable={Boolean(selectedAsset)}
            placeholder="0.00"
            placeholderTextColor="#999"
            value={amountStr}
            onChangeText={onAmountChange}
            keyboardType="decimal-pad"
          />
          <View className="ml-2">
            <Pressable
              className={`rounded-lg bg-neutral-200 px-2 py-1 ${!selectedAsset ? "opacity-40" : ""}`}
              onPress={() => onPercentage(100)}
              disabled={!selectedAsset}
            >
              <Text className="text-[11px] font-semibold text-neutral-700">
                MAX
              </Text>
            </Pressable>
          </View>
        </View>
        <Text className="mt-1 text-[12px] text-neutral-400">
          Balance: {formatBalance(sourceBalance, selectedAsset?.decimals ?? 4)}
          {selectedAsset ? ` ${selectedAsset.symbol}` : ""}
        </Text>
      </View>
      {!isValidAmount && amountStr.length > 0 ? (
        <Text className="mb-1 text-[12px] text-red-500">
          {parseFloat(amountStr) > sourceBalance
            ? "Insufficient balance"
            : "Enter a valid amount"}
        </Text>
      ) : null}

      <View className="mb-4" />

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

function TokenSelectorButton({
  asset,
  icon,
  onPress,
}: {
  asset: ShieldAsset | null;
  icon: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="flex-row items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3"
      onPress={onPress}
    >
      <View className="flex-row items-center">
        <Image
          source={icon}
          style={{ width: 28, height: 28, borderRadius: 14 }}
        />
        <View className="ml-2.5">
          <Text className="text-[14px] font-semibold text-black">
            {asset?.symbol ?? "Select token"}
          </Text>
          <Text className="text-[12px] text-neutral-500">
            {asset
              ? `${asset.name} • ${getBalanceSourceLabel(asset)}`
              : "Available balances"}
          </Text>
        </View>
      </View>
      <ChevronDown size={16} color="#666" />
    </Pressable>
  );
}

function TokenPicker({
  assets,
  onSelect,
}: {
  assets: ShieldAsset[];
  onSelect: (assetKey: string) => void;
}) {
  if (assets.length === 0) {
    return (
      <Text className="py-8 text-center text-[14px] text-neutral-400">
        No token balances available
      </Text>
    );
  }

  return (
    <>
      {assets.map((asset) => {
        const icon = resolveTokenIcon({
          mint: asset.mint,
          imageUrl: asset.imageUrl,
        });

        return (
          <Pressable
            key={asset.key}
            className="flex-row items-center rounded-xl px-2 py-3 active:bg-neutral-100"
            onPress={() => onSelect(asset.key)}
          >
            <Image
              source={icon}
              style={{ width: 32, height: 32, borderRadius: 16 }}
            />
            <View className="ml-3 flex-1">
              <Text className="text-[14px] font-medium text-black">
                {asset.symbol}
              </Text>
              <Text className="text-[12px] text-neutral-500" numberOfLines={1}>
                {asset.name} • {getBalanceSourceLabel(asset)}
              </Text>
            </View>
            <Text className="text-[14px] text-neutral-600">
              {formatBalance(asset.balance, asset.decimals)}
            </Text>
          </Pressable>
        );
      })}
    </>
  );
}

function ConfirmStep({
  direction,
  amountNum,
  selectedAsset,
  isProcessing,
  onConfirm,
}: {
  direction: ShieldDirection;
  amountNum: number;
  selectedAsset: ShieldAsset | null;
  isProcessing: boolean;
  onConfirm: () => void;
}) {
  return (
    <>
      <View className="mb-6 rounded-2xl bg-neutral-50 p-4">
        <Row label="Operation" value={getOperationLabel(direction)} />
        <Row label="Token" value={selectedAsset?.symbol ?? "Token"} />
        <Row
          label="Amount"
          value={`${amountNum.toFixed(4)} ${selectedAsset?.symbol ?? ""}`.trim()}
        />
        <Row
          label="Using"
          value={selectedAsset ? getBalanceSourceLabel(selectedAsset) : "Balance"}
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
            {`Confirm and ${getOperationLabel(direction)}`}
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

function ResultStep({
  isProcessing,
  resultError,
  resultSuccess,
  direction,
  amountNum,
  selectedAsset,
  onDone,
}: {
  isProcessing: boolean;
  resultError: string | null;
  resultSuccess: boolean;
  direction: ShieldDirection;
  amountNum: number;
  selectedAsset: ShieldAsset | null;
  onDone: () => void;
}) {
  const tokenSymbol = selectedAsset?.symbol ?? "tokens";

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
          {amountNum.toFixed(4)} {tokenSymbol}{" "}
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
