import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Copy, Share as ShareIcon, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Share, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFixedSheetLayout } from "@/hooks/useFixedSheetLayout";
import QRCode from "react-native-qrcode-svg";

import { Pressable, Text, View } from "@/tw";

const COPIED_RESET_MS = 2000;


const COLOR_CARD_BG = "#F2F2F7";
const COLOR_ICON = "#3C3C43";
const ICON_OPACITY = 0.6;

const QR_SIZE = 192;
const CARD_WIDTH = 256;

// Red Loyal mascot rendered in the center of the QR. Passed to the QR as a raw
// SVG string so react-native-qrcode-svg renders it via SvgXml (preserving the
// mark's own fills) instead of going through the asset/transformer path.
const QR_MARK_SVG = `<svg width="35" height="28" viewBox="0 0 35 28" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M5.24998 24.4999L0 12.25H15.75V0L22.7499 12.25L24.4999 0L34.9999 27.9999L5.24998 24.4999Z" fill="#F9363C"/>
<path d="M19.369 15.141C22.2645 15.2927 24.5052 17.45 24.3737 19.9595L13.8881 19.41C14.0196 16.9005 16.4735 14.9892 19.369 15.141Z" fill="white"/>
<mask id="qrmask" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="13" y="15" width="12" height="5">
<path d="M19.3693 15.141C22.2648 15.2927 24.5054 17.45 24.3739 19.9595L13.8883 19.41C14.0199 16.9005 16.4737 14.9892 19.3693 15.141Z" fill="white"/>
</mask>
<g mask="url(#qrmask)">
<circle cx="19.2498" cy="17.4126" r="2.36249" transform="rotate(3 19.2498 17.4126)" fill="black"/>
</g>
</svg>`;

type ReceiveSheetProps = {
  open: boolean;
  onClose: () => void;
  walletAddress: string | null;
};

export function ReceiveSheet({
  open,
  onClose,
  walletAddress,
}: ReceiveSheetProps) {
  const { sheetHeight, snapPoints } = useFixedSheetLayout();
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    if (!walletAddress) return;
    await Clipboard.setStringAsync(walletAddress);
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [walletAddress]);

  const handleShare = useCallback(async () => {
    if (!walletAddress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Share.share({
      message: `My Solana wallet address:\n${walletAddress}`,
    });
  }, [walletAddress]);

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
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleComponent={null}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={[styles.container, { height: sheetHeight }]}>
        {/* Header: close (left) + centered title */}
        <View className="flex-row items-center justify-between px-4 py-4">
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={({ pressed }) => [
              styles.iconButton,
              { transform: [{ scale: pressed ? 0.96 : 1 }] },
            ]}
          >
            <X
              size={28}
              color={COLOR_ICON}
              strokeWidth={2}
              opacity={ICON_OPACITY}
            />
          </Pressable>
          <Text
            className="text-[17px] font-semibold text-black"
            style={{ lineHeight: 22 }}
          >
            Receive
          </Text>
          <View style={styles.iconButtonSpacer} />
        </View>

        {/* QR card, centered in the available space */}
        <View className="flex-1 items-center justify-center">
          <View style={styles.card}>
            {walletAddress ? (
              <>
                <QRCode
                  value={walletAddress}
                  size={QR_SIZE}
                  ecl="H"
                  backgroundColor="transparent"
                  logoSVG={QR_MARK_SVG}
                  logoSize={40}
                  logoMargin={6}
                  logoBackgroundColor={COLOR_CARD_BG}
                  logoBorderRadius={8}
                />
                <AddressLabel address={walletAddress} />
              </>
            ) : (
              <View className="items-center justify-center" style={styles.qrEmpty}>
                <Text className="text-[14px] text-neutral-400">No address</Text>
              </View>
            )}
          </View>
        </View>

        {/* Warning + actions, pinned to the bottom */}
        <View className="px-4" style={{ paddingBottom: insets.bottom + 12 }}>
          <Text
            className="mb-3 px-6 text-center text-[14px]"
            style={{ lineHeight: 20, color: "rgba(60, 60, 67, 0.4)" }}
          >
            Use to receive assets on the Solana network only. Other assets will
            be lost forever.
          </Text>

          <View className="flex-row gap-2">
            <ActionPill
              label={copied ? "Copied!" : "Copy"}
              icon={
                <Copy
                  size={24}
                  color={COLOR_ICON}
                  strokeWidth={2}
                  opacity={ICON_OPACITY}
                />
              }
              onPress={handleCopy}
              disabled={!walletAddress}
            />
            <ActionPill
              label="Share"
              icon={
                <ShareIcon
                  size={24}
                  color={COLOR_ICON}
                  strokeWidth={2}
                  opacity={ICON_OPACITY}
                />
              }
              onPress={handleShare}
              disabled={!walletAddress}
            />
          </View>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

function AddressLabel({ address }: { address: string }) {
  const showSplit = address.length > 8;
  const first = address.slice(0, 4);
  const middle = address.slice(4, -4);
  const last = address.slice(-4);
  return (
    <Text
      className="mt-4 text-center font-mono text-[14px]"
      style={{ lineHeight: 20, maxWidth: 224 }}
    >
      {showSplit ? (
        <>
          <Text className="text-[#1C1C1E]">{first}</Text>
          <Text style={{ color: "rgba(60, 60, 67, 0.5)" }}>{middle}</Text>
          <Text className="text-[#1C1C1E]">{last}</Text>
        </>
      ) : (
        <Text className="text-[#1C1C1E]">{address}</Text>
      )}
    </Text>
  );
}

function ActionPill({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pill,
        {
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed && !disabled ? 0.96 : 1 }],
        },
      ]}
    >
      {icon}
      <Text className="text-[17px] font-medium text-black" style={{ lineHeight: 22 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
  },
  container: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
    overflow: "hidden",
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLOR_CARD_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonSpacer: {
    width: 44,
    height: 44,
  },
  card: {
    width: CARD_WIDTH,
    alignItems: "center",
    backgroundColor: COLOR_CARD_BG,
    borderRadius: 28,
    paddingTop: 32,
    paddingBottom: 20,
  },
  qrEmpty: {
    width: QR_SIZE,
    height: QR_SIZE,
  },
  pill: {
    flex: 1,
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 16,
    backgroundColor: COLOR_CARD_BG,
  },
});
