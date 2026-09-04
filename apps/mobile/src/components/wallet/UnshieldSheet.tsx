import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { ShieldedBalance, UnshieldResult } from "@loyal-labs/wallet-core/hooks";
import * as Haptics from "expo-haptics";
import { ArrowLeft, ChevronDown, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  formatShieldedUsd,
  resolveShieldedRow,
  type ShieldedRow,
} from "@/components/wallet/shielded-balance";
import { useFixedSheetLayout } from "@/hooks/useFixedSheetLayout";
import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { Pressable, Text, View } from "@/tw";

import SendErrorDog from "../../../assets/images/wallet/send_error_dog.svg";
import SendSuccessDog from "../../../assets/images/wallet/send_success_dog.svg";

// Exit-only unshield for the sunset private-transfer program (ASK-2269):
// review the full shielded balance of one token, then move it back to the
// wallet. Mirrors SendSheet's confirm / result steps.

const MUTED = "rgba(60,60,67,0.6)";

type UnshieldSheetProps = {
  open: boolean;
  onClose: () => void;
  balances: ShieldedBalance[];
  executeUnshield: (tokenMint: string) => Promise<UnshieldResult>;
  tokenHoldings: TokenHolding[];
  tokenDetailsByMint: TokenDetailsByMint;
  initialMint?: string | null;
  onUnshieldComplete?: () => void;
};

type Phase = "confirm" | "pick" | "result";

export function UnshieldSheet({
  open,
  onClose,
  balances,
  executeUnshield,
  tokenHoldings,
  tokenDetailsByMint,
  initialMint,
  onUnshieldComplete,
}: UnshieldSheetProps) {
  const { sheetHeight, snapPoints } = useFixedSheetLayout(0.6);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  // Captured before executing: the balance list drops the token on success.
  const [outcome, setOutcome] = useState<{ row: ShieldedRow; result: UnshieldResult } | null>(null);

  const rows = useMemo(
    () => balances.map((b) => resolveShieldedRow(b, tokenHoldings, tokenDetailsByMint)),
    [balances, tokenHoldings, tokenDetailsByMint],
  );
  const selected =
    rows.find((r) => r.mint === (selectedMint ?? initialMint)) ?? rows[0] ?? null;

  useEffect(() => {
    if (open) {
      setPhase("confirm");
      setSelectedMint(initialMint ?? null);
      setOutcome(null);
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [open, initialMint]);

  const handleUnshield = useCallback(async () => {
    if (!selected || isPending) return;
    void Haptics.selectionAsync();
    setIsPending(true);
    const result = await executeUnshield(selected.mint);
    setIsPending(false);
    setOutcome({ row: selected, result });
    setPhase("result");
    void Haptics.notificationAsync(
      result.success
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    );
    if (result.success) onUnshieldComplete?.();
  }, [selected, isPending, executeUnshield, onUnshieldComplete]);

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
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose={!isPending}
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleComponent={null}
      backgroundStyle={{ borderTopLeftRadius: 38, borderTopRightRadius: 38 }}
    >
      <BottomSheetView
        style={{
          height: sheetHeight,
          backgroundColor: "#fff",
          borderTopLeftRadius: 38,
          borderTopRightRadius: 38,
          overflow: "hidden",
        }}
      >
        {phase === "pick" ? (
          <>
            <Toolbar title="Select asset" onBack={() => setPhase("confirm")} />
            <BottomSheetScrollView style={{ flex: 1 }}>
              {rows.map((row) => (
                <TokenCell
                  key={row.mint}
                  row={row}
                  onPress={() => {
                    setSelectedMint(row.mint);
                    setPhase("confirm");
                  }}
                />
              ))}
            </BottomSheetScrollView>
          </>
        ) : phase === "result" && outcome ? (
          <ResultStep
            row={outcome.row}
            result={outcome.result}
            onClose={onClose}
            onRetry={() => setPhase("confirm")}
          />
        ) : (
          <ConfirmStep
            row={selected}
            canPick={rows.length > 1}
            isPending={isPending}
            onPick={() => setPhase("pick")}
            onClose={onClose}
            onConfirm={() => void handleUnshield()}
          />
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

function Toolbar({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack?: () => void;
  onClose?: () => void;
}) {
  return (
    <View className="w-full" style={{ paddingVertical: 16 }}>
      <View className="flex-row items-center justify-between px-4">
        <Pressable
          className="h-11 w-11 items-center justify-center rounded-full bg-[#f2f2f7]"
          hitSlop={6}
          onPress={onBack ?? onClose}
          accessibilityRole="button"
          accessibilityLabel={onBack ? "Back" : "Close"}
        >
          {onBack ? (
            <ArrowLeft size={24} color={MUTED} strokeWidth={2} />
          ) : (
            <X size={24} color={MUTED} strokeWidth={2} />
          )}
        </Pressable>
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <Text className="text-[17px] font-semibold text-black" style={{ lineHeight: 22 }}>
            {title}
          </Text>
        </View>
        <View className="h-11 w-11" style={{ opacity: 0 }} />
      </View>
    </View>
  );
}

function TokenCell({
  row,
  onPress,
  showChevron,
}: {
  row: ShieldedRow;
  onPress?: () => void;
  showChevron?: boolean;
}) {
  return (
    <Pressable
      className="w-full flex-row items-center"
      style={{ paddingHorizontal: 16 }}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`Select ${row.name}`}
    >
      <View style={{ paddingRight: 12, paddingVertical: 6 }}>
        <Image
          source={{ uri: row.icon }}
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            borderWidth: 0.5,
            borderColor: "rgba(0,0,0,0.08)",
          }}
        />
      </View>
      <View className="flex-1" style={{ paddingVertical: 8, gap: 2 }}>
        <Text
          className="text-[17px] font-medium text-black"
          style={{ lineHeight: 22, letterSpacing: -0.187 }}
          numberOfLines={1}
        >
          {row.name}
        </Text>
        <Text className="text-[15px] font-normal" style={{ color: MUTED, lineHeight: 20 }} numberOfLines={1}>
          {row.amountText} {row.symbol} shielded
        </Text>
      </View>
      <View className="flex-row items-center" style={{ paddingLeft: 12, gap: 4 }}>
        {row.usd !== null ? (
          <Text className="text-[17px] font-medium text-black" style={{ lineHeight: 22 }}>
            {formatShieldedUsd(row.usd)}
          </Text>
        ) : null}
        {showChevron ? <ChevronDown size={18} color="rgba(60,60,67,0.4)" /> : null}
      </View>
    </Pressable>
  );
}

function Cta({
  label,
  onPress,
  variant = "primary",
  pending,
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  pending?: boolean;
  disabled?: boolean;
}) {
  const isPrimary = variant === "primary";
  return (
    <Pressable
      className="items-center justify-center"
      style={{
        height: 50,
        borderRadius: 78,
        backgroundColor: isPrimary ? "#000" : "#f5f5f5",
        opacity: disabled && !pending ? 0.4 : 1,
      }}
      onPress={onPress}
      disabled={disabled || pending}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {pending ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text
          className="text-[16px] font-medium"
          style={{ color: isPrimary ? "#fff" : "#000", lineHeight: 20 }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function ConfirmStep({
  row,
  canPick,
  isPending,
  onPick,
  onClose,
  onConfirm,
}: {
  row: ShieldedRow | null;
  canPick: boolean;
  isPending: boolean;
  onPick: () => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View className="w-full" style={{ flex: 1 }}>
      <Toolbar title="Unshield" onClose={onClose} />

      {row ? (
        <>
          <View className="w-full items-center" style={{ padding: 16 }}>
            <Image source={{ uri: row.icon }} style={{ width: 64, height: 64, borderRadius: 32 }} />
            <View className="flex-row items-baseline" style={{ gap: 8, marginTop: 16 }}>
              <Text style={{ fontFamily: "Geist_600SemiBold", fontSize: 40, lineHeight: 48, color: "#000" }}>
                {row.amountText}
              </Text>
              <Text
                style={{
                  fontFamily: "Geist_600SemiBold",
                  fontSize: 28,
                  lineHeight: 32,
                  letterSpacing: 0.4,
                  color: "rgba(60,60,67,0.4)",
                }}
              >
                {row.symbol}
              </Text>
            </View>
            {row.usd !== null ? (
              <Text className="text-[17px] font-normal" style={{ color: MUTED, lineHeight: 22, marginTop: 4 }}>
                ≈{formatShieldedUsd(row.usd)}
              </Text>
            ) : null}
          </View>

          <View style={{ paddingHorizontal: 16 }}>
            <View className="w-full" style={{ backgroundColor: "#f2f2f7", borderRadius: 20, paddingVertical: 4 }}>
              <TokenCell row={row} onPress={canPick ? onPick : undefined} showChevron={canPick} />
            </View>
          </View>
        </>
      ) : (
        <View className="flex-1 items-center justify-center" style={{ padding: 32 }}>
          <Text className="text-[17px] font-normal" style={{ color: MUTED, lineHeight: 22, textAlign: "center" }}>
            No shielded balances left
          </Text>
        </View>
      )}

      <View style={{ marginTop: "auto", paddingTop: 16, paddingBottom: insets.bottom + 12, paddingHorizontal: 20 }}>
        <Cta label="Unshield" onPress={onConfirm} pending={isPending} disabled={!row} />
      </View>
    </View>
  );
}

function ResultStep({
  row,
  result,
  onClose,
  onRetry,
}: {
  row: ShieldedRow;
  result: UnshieldResult;
  onClose: () => void;
  onRetry: () => void;
}) {
  const insets = useSafeAreaInsets();
  const env = getSolanaEnv();
  const explorerUrl = result.signature
    ? `https://solscan.io/tx/${result.signature}${env === "mainnet" ? "" : `?cluster=${env}`}`
    : null;
  return (
    <View className="w-full" style={{ flex: 1 }}>
      <Toolbar title="Unshield" onClose={onClose} />

      <View className="flex-1 items-center justify-center" style={{ paddingHorizontal: 32, paddingVertical: 24 }}>
        <View className="w-full items-center" style={{ gap: 20 }}>
          {result.success ? (
            <SendSuccessDog width={100} height={80} />
          ) : (
            <SendErrorDog width={100} height={80} />
          )}
          <View className="w-full items-center" style={{ gap: 4 }}>
            <Text className="text-[22px] font-semibold text-black" style={{ lineHeight: 28, textAlign: "center" }}>
              {result.success ? "Unshielded" : "Unshield failed"}
            </Text>
            <Text
              className="text-[17px] font-normal"
              style={{ color: MUTED, lineHeight: 22, textAlign: "center", maxWidth: 300 }}
            >
              {result.success ? (
                <>
                  <Text className="text-black">
                    {row.amountText} {row.symbol}
                  </Text>
                  <Text style={{ color: MUTED }}>{" moved back to your wallet"}</Text>
                </>
              ) : (
                (result.error ?? "Something went wrong. Please try again.")
              )}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ paddingTop: 16, paddingBottom: insets.bottom + 12, paddingHorizontal: 20, gap: 10 }}>
        {result.success ? (
          <>
            <Cta label="Done" onPress={onClose} />
            {explorerUrl ? (
              <Cta label="View on Solscan" variant="secondary" onPress={() => void Linking.openURL(explorerUrl)} />
            ) : null}
          </>
        ) : (
          <>
            <Cta label="Try again" onPress={onRetry} />
            <Cta label="Close" variant="secondary" onPress={onClose} />
          </>
        )}
      </View>
    </View>
  );
}
