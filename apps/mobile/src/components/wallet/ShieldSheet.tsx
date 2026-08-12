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

import { useShield, type ShieldFeeEstimate } from "@/hooks/wallet/useShield";
import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import { track } from "@/lib/analytics/analytics";
import { SHIELD_EVENTS } from "@/lib/analytics/shield-events";
import { NATIVE_SOL_MINT } from "@/lib/solana/constants";
import {
  buildShieldAssets,
  getShieldDirection,
  resolveInitialShieldAssetKey,
  type ShieldAsset,
  type ShieldDirection,
} from "@/lib/solana/shielding";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { Image } from "@/tw/image";
import { Pressable, Text, View } from "@/tw";

const shieldBadge = require("../../../assets/images/shield-badge.png");

type ShieldStep = "form" | "confirm" | "result";

type ShieldSheetProps = {
  open: boolean;
  onClose: () => void;
  walletAddress: string | null;
  tokenHoldings: TokenHolding[];
  tokenDetailsByMint?: TokenDetailsByMint;
  onShieldComplete?: () => void;
  initialMint?: string;
  initialDirection?: ShieldDirection;
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

const LAMPORTS_PER_SOL_NUM = 1_000_000_000;

function formatFeeLamports(lamports: number): string {
  if (lamports <= 0) return "0 SOL";
  const sol = lamports / LAMPORTS_PER_SOL_NUM;
  if (sol < 0.00001) return "<0.00001 SOL";
  // Six significant-ish digits keep both rent-inflated and plain network
  // fees readable (rent can be 0.00204 SOL per account).
  return `${sol.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} SOL`;
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
  tokenDetailsByMint,
  onShieldComplete,
  initialMint,
  initialDirection,
}: ShieldSheetProps) {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [step, setStep] = useState<ShieldStep>("form");
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [selectedAssetKey, setSelectedAssetKey] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [isMaxSelected, setIsMaxSelected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultSuccess, setResultSuccess] = useState(false);
  const [feeEstimate, setFeeEstimate] = useState<ShieldFeeEstimate | null>(
    null,
  );
  const [isEstimatingFee, setIsEstimatingFee] = useState(false);
  const feeRequestId = useRef(0);

  const { executeShield, executeUnshield, estimateFee } = useShield();

  const shieldAssets = useMemo(
    () => buildShieldAssets(tokenHoldings),
    [tokenHoldings],
  );

  const selectableShieldAssets = useMemo(
    () =>
      initialDirection
        ? shieldAssets.filter(
            (asset) => getShieldDirection(asset) === initialDirection,
          )
        : shieldAssets,
    [initialDirection, shieldAssets],
  );

  const selectedAsset = useMemo(
    () =>
      selectableShieldAssets.find((asset) => asset.key === selectedAssetKey) ??
      selectableShieldAssets[0] ??
      null,
    [selectedAssetKey, selectableShieldAssets],
  );

  const direction = selectedAsset
    ? getShieldDirection(selectedAsset)
    : initialDirection ?? "shield";
  const selectedAssetMint = selectedAsset?.mint ?? NATIVE_SOL_MINT;
  const selectedAssetIcon = resolveTokenIcon({
    mint: selectedAssetMint,
    imageUrl: selectedAsset?.imageUrl ?? null,
    detailLogoUrl: tokenDetailsByMint?.[selectedAssetMint]?.token.logoUrl,
  });
  const sourceBalance = selectedAsset?.balance ?? 0;
  const amountNum = parseFloat(amountStr) || 0;
  const isValidAmount =
    Boolean(selectedAsset) && amountNum > 0 && amountNum <= sourceBalance;
  const isFormValid = isValidAmount;

  // Reset state on open/close transitions only. Re-running on shieldAssets
  // change would clobber the result step after onShieldComplete refreshes
  // holdings.
  useEffect(() => {
    if (open) {
      bottomSheetRef.current?.present();
      setStep("form");
      setShowTokenPicker(false);
      setSelectedAssetKey(
        resolveInitialShieldAssetKey(shieldAssets, {
          initialMint,
          initialDirection,
        }),
      );
      setAmountStr("");
      setIsMaxSelected(false);
      setResultError(null);
      setResultSuccess(false);
      setIsProcessing(false);
      setFeeEstimate(null);
      setIsEstimatingFee(false);
    } else {
      bottomSheetRef.current?.dismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Kick off the fee estimate as soon as the user has a valid amount, not
  // after they transition to the confirm step. This way the fee is
  // usually already resolved by the time they reach confirm, and the
  // estimate survives across form ↔ confirm ↔ result transitions (so a
  // denied approval doesn't leave confirm showing "—" on return). The
  // estimate is only invalidated when the sheet closes or when the
  // asset/amount/direction changes.
  useEffect(() => {
    if (!open || !selectedAsset || !isValidAmount) {
      setFeeEstimate(null);
      setIsEstimatingFee(false);
      return;
    }
    const requestId = ++feeRequestId.current;
    setIsEstimatingFee(true);
    setFeeEstimate(null);
    // Debounce rapid amount typing so we don't thrash the RPC while the
    // user is still entering digits.
    const timer = setTimeout(() => {
      estimateFee({
        direction,
        tokenSymbol: selectedAsset.symbol,
        amount: amountNum,
        tokenMint: selectedAsset.mint,
        tokenDecimals: selectedAsset.decimals,
        isMax: isMaxSelected,
      })
        .then((estimate) => {
          if (feeRequestId.current !== requestId) return;
          setFeeEstimate(estimate);
          setIsEstimatingFee(false);
        })
        .catch(() => {
          if (feeRequestId.current !== requestId) return;
          setFeeEstimate(null);
          setIsEstimatingFee(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [
    open,
    isValidAmount,
    selectedAsset,
    amountNum,
    direction,
    estimateFee,
    isMaxSelected,
  ]);

  useEffect(() => {
    if (!open) return;
    if (
      !selectedAssetKey ||
      !selectableShieldAssets.some((asset) => asset.key === selectedAssetKey)
    ) {
      setSelectedAssetKey(
        resolveInitialShieldAssetKey(shieldAssets, {
          initialMint,
          initialDirection,
        }),
      );
    }
  }, [
    initialDirection,
    initialMint,
    open,
    selectableShieldAssets,
    selectedAssetKey,
    shieldAssets,
  ]);

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
        isMax: isMaxSelected,
      };

      const result =
        direction === "shield"
          ? await executeShield(params)
          : await executeUnshield(params);

      if (result.success) {
        setResultSuccess(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        track(
          direction === "shield"
            ? SHIELD_EVENTS.shieldTokens
            : SHIELD_EVENTS.unshieldTokens,
        );
        onShieldComplete?.();
      } else {
        setResultError(getFriendlyError(result.error ?? "Transaction failed"));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        track(
          direction === "shield"
            ? SHIELD_EVENTS.shieldTokensFailed
            : SHIELD_EVENTS.unshieldTokensFailed,
        );
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Transaction failed";
      setResultError(getFriendlyError(msg));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      track(
        direction === "shield"
          ? SHIELD_EVENTS.shieldTokensFailed
          : SHIELD_EVENTS.unshieldTokensFailed,
      );
    } finally {
      setIsProcessing(false);
    }
  }, [
    amountNum,
    direction,
    executeShield,
    executeUnshield,
    isFormValid,
    isMaxSelected,
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

      const isMax = pct === 100;
      let val = isMax ? sourceBalance : sourceBalance * (pct / 100);
      // For SOL we still nudge the MAX display down by the fee reserve so
      // the user never signs a shield that leaves no lamports for fees.
      // The raw on-chain deposit amount is only used when unshielding, so
      // the reserve subtraction here doesn't affect the MAX unshield path.
      if (selectedAsset.mint === NATIVE_SOL_MINT && sourceBalance - val < 0.00005) {
        val = Math.max(0, sourceBalance - 0.00005);
      }

      // Truncate (never round) so floating-point rounding can't push the
      // amount past the balance minus the fee reserve.
      const displayScale = 1e6;
      const truncated = Math.floor(val * displayScale) / displayScale;
      setAmountStr(truncated > 0 ? String(truncated) : "");
      setIsMaxSelected(isMax && truncated > 0);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [selectedAsset, sourceBalance],
  );

  const handleAmountInputChange = useCallback((newValue: string) => {
    setAmountStr(newValue);
    setIsMaxSelected(false);
  }, []);

  const handleSelectAsset = useCallback((assetKey: string) => {
    setSelectedAssetKey(assetKey);
    setAmountStr("");
    setIsMaxSelected(false);
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
              assets={selectableShieldAssets}
              tokenDetailsByMint={tokenDetailsByMint}
              onSelect={handleSelectAsset}
            />
          ) : null}

          {!showTokenPicker && step === "form" ? (
            <FormStep
              direction={direction}
              selectedAsset={selectedAsset}
              selectedAssetIcon={selectedAssetIcon}
              amountStr={amountStr}
              onAmountChange={handleAmountInputChange}
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
              feeEstimate={feeEstimate}
              isEstimatingFee={isEstimatingFee}
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
  const chipIcon = selectedAsset
    ? selectedAssetIcon
    : resolveTokenIcon({ mint: NATIVE_SOL_MINT });

  if (!selectedAsset) {
    return (
      <Text className="mt-2 text-[13px] text-neutral-500">
        {direction === "shield"
          ? "No public token balances are available to shield right now."
          : "No shielded token balances are available to unshield right now."}
      </Text>
    );
  }

  return (
    <>
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">
        Amount
      </Text>
      <View
        className="mb-1 flex-row items-center rounded-xl border border-neutral-200 bg-neutral-50"
        style={{ paddingRight: 6 }}
      >
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
          onPress={onOpenTokenPicker}
          accessibilityRole="button"
          accessibilityLabel="Change token"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: 9999,
            backgroundColor: "#fff",
            borderWidth: 1,
            borderColor: "rgba(0,0,0,0.08)",
          }}
        >
          <View style={{ position: "relative" }}>
            <Image
              source={chipIcon}
              style={{ width: 20, height: 20, borderRadius: 10 }}
            />
            {selectedAsset.isSecured ? (
              <Image
                source={shieldBadge}
                style={{
                  position: "absolute",
                  bottom: -3,
                  right: -3,
                  width: 12,
                  height: 12,
                }}
              />
            ) : null}
          </View>
          <Text className="text-[14px] font-semibold text-black">
            {selectedAsset.symbol}
          </Text>
          <ChevronDown size={14} color="#666" />
        </Pressable>
      </View>
      {!isValidAmount && amountStr.length > 0 ? (
        <Text className="mt-1 text-[12px] text-red-500">
          {parseFloat(amountStr) > sourceBalance
            ? "Insufficient balance"
            : "Enter a valid amount"}
        </Text>
      ) : null}

      <View className="mb-6 mt-2 flex-row items-center justify-between">
        <Text className="text-[12px] text-neutral-500">
          {getBalanceSourceLabel(selectedAsset)}:{" "}
          {formatBalance(sourceBalance, selectedAsset.decimals)}{" "}
          {selectedAsset.symbol}
        </Text>
        <Pressable
          className="rounded-lg bg-neutral-200 px-2.5 py-1"
          onPress={() => onPercentage(100)}
        >
          <Text className="text-[12px] font-semibold text-neutral-700">
            MAX
          </Text>
        </Pressable>
      </View>

      <Pressable
        className={`items-center rounded-2xl py-4 ${!isFormValid ? "opacity-40" : ""}`}
        style={{ backgroundColor: "#f9363c" }}
        onPress={onNext}
        disabled={!isFormValid}
      >
        <Text className="text-[16px] font-semibold text-white">
          Review {getOperationLabel(direction)}
        </Text>
      </Pressable>
    </>
  );
}

function TokenPicker({
  assets,
  tokenDetailsByMint,
  onSelect,
}: {
  assets: ShieldAsset[];
  tokenDetailsByMint?: TokenDetailsByMint;
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
          detailLogoUrl: tokenDetailsByMint?.[asset.mint]?.token.logoUrl,
        });

        return (
          <Pressable
            key={asset.key}
            className="flex-row items-center rounded-xl px-2 py-3 active:bg-neutral-100"
            onPress={() => onSelect(asset.key)}
          >
            <View style={{ position: "relative" }}>
              <Image
                source={icon}
                style={{ width: 32, height: 32, borderRadius: 16 }}
              />
              {asset.isSecured ? (
                <Image
                  source={shieldBadge}
                  style={{
                    position: "absolute",
                    bottom: -2,
                    right: -2,
                    width: 16,
                    height: 16,
                  }}
                />
              ) : null}
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-[14px] font-medium text-black">
                {asset.symbol}
                {asset.isSecured ? " · Shielded" : ""}
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
  feeEstimate,
  isEstimatingFee,
  onConfirm,
}: {
  direction: ShieldDirection;
  amountNum: number;
  selectedAsset: ShieldAsset | null;
  isProcessing: boolean;
  feeEstimate: ShieldFeeEstimate | null;
  isEstimatingFee: boolean;
  onConfirm: () => void;
}) {
  // Only surface the fee row when we have a value (or are actively
  // estimating). If estimation was skipped because the PER auth token
  // isn't cached yet, feeEstimate stays null and we omit the row
  // entirely — the user would otherwise see a permanent "—" which
  // reads as a broken field.
  const showFeeRow = isEstimatingFee || feeEstimate !== null;
  const feeValue = isEstimatingFee
    ? "Estimating…"
    : feeEstimate
      ? formatFeeLamports(feeEstimate.totalLamports)
      : "";

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
        {showFeeRow ? (
          <Row
            label="Network fee"
            value={feeValue}
            isSubtle={isEstimatingFee}
          />
        ) : null}
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
