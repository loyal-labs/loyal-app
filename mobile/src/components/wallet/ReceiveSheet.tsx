import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Copy, Share2 } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Share } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { formatAddress } from "@/lib/solana/wallet/formatters";
import { Pressable, Text, View } from "@/tw";

const COPIED_RESET_MS = 2000;

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
  const bottomSheetRef = useRef<BottomSheetModal>(null);
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
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleIndicatorStyle={{ backgroundColor: "rgba(0,0,0,0.15)", width: 36 }}
      backgroundStyle={{ borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
    >
      <BottomSheetView>
        <View className="items-center px-6 pb-12 pt-2">
          {/* Title */}
          <Text
            className="mb-6 text-[17px] font-semibold text-black"
            style={{ lineHeight: 22 }}
          >
            Receive
          </Text>

          {/* Warning */}
          <Text className="mb-6 text-center text-[14px] text-neutral-500">
            Use to receive tokens on the Solana network only. Other assets will
            be lost forever.
          </Text>

          {/* QR Code */}
          <View className="mb-6 items-center rounded-2xl bg-neutral-100 px-8 pb-5 pt-8">
            {walletAddress ? (
              <>
                <QRCode value={walletAddress} size={192} />
                <Text className="mt-4 text-center font-mono text-[14px] text-neutral-600">
                  {walletAddress}
                </Text>
              </>
            ) : (
              <View className="h-48 w-48 items-center justify-center">
                <Text className="text-[14px] text-neutral-400">No address</Text>
              </View>
            )}
          </View>

          {/* Action buttons */}
          <View className="w-full flex-row justify-center gap-12">
            <Pressable
              className="items-center gap-2"
              onPress={handleCopy}
              disabled={!walletAddress}
            >
              <View className="h-14 w-14 items-center justify-center rounded-full bg-neutral-100">
                <Copy size={24} color="#3C3C43" />
              </View>
              <Text className="text-[12px] text-neutral-500">
                {copied ? "Copied!" : "Copy"}
              </Text>
            </Pressable>

            <Pressable
              className="items-center gap-2"
              onPress={handleShare}
              disabled={!walletAddress}
            >
              <View className="h-14 w-14 items-center justify-center rounded-full bg-neutral-100">
                <Share2 size={24} color="#3C3C43" />
              </View>
              <Text className="text-[12px] text-neutral-500">Share</Text>
            </Pressable>
          </View>

          {/* Short address for quick reference */}
          {walletAddress && (
            <Text className="mt-4 text-[12px] text-neutral-400">
              {formatAddress(walletAddress)}
            </Text>
          )}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}
