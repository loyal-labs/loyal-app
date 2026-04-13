import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { AlertCircle } from "lucide-react-native";
import { useEffect, useMemo, useRef, type ComponentProps } from "react";

import type { PendingApproval } from "../model/types";
import { SiteAvatar } from "./SiteAvatar";

import { Pressable, Text, View } from "@/tw";

type DappApprovalSheetProps = {
  approval: PendingApproval | null;
  onReject: () => void;
  onApprove: () => void;
};

function ApprovalBackdrop(props: ComponentProps<typeof BottomSheetBackdrop>) {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="none"
      opacity={0.32}
    />
  );
}

function getRequestLabel(type: PendingApproval["type"]): string {
  switch (type) {
    case "connect":
      return "Connect wallet";
    case "signMessage":
      return "Sign message";
    case "signTransaction":
      return "Sign transaction";
    case "signAndSendTransaction":
      return "Sign and send transaction";
    default:
      return type;
  }
}

function getRequestDescription(type: PendingApproval["type"]): string {
  switch (type) {
    case "connect":
      return "Allow this site to view your public wallet address and request signatures.";
    case "signMessage":
      return "Review this message request carefully before you sign it with Loyal.";
    case "signTransaction":
      return "Review this transaction carefully. It will be signed but not sent yet.";
    case "signAndSendTransaction":
      return "Review this transaction carefully. It will be signed and sent from Loyal.";
    default:
      return "Review this request carefully before approving it.";
  }
}

function getPrimaryActionLabel(type: PendingApproval["type"]): string {
  switch (type) {
    case "connect":
      return "Connect";
    case "signAndSendTransaction":
      return "Sign & send";
    default:
      return "Sign";
  }
}

function getTrustLabel(trustState: PendingApproval["trustState"]): string {
  switch (trustState) {
    case "trusted":
      return "Trusted";
    case "connected":
      return "Connected";
    case "untrusted":
      return "Untrusted";
    default:
      return trustState;
  }
}

export function DappApprovalSheet({
  approval,
  onReject,
  onApprove,
}: DappApprovalSheetProps) {
  const modalRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["52%"], []);
  const backdrop = useMemo(() => ApprovalBackdrop, []);

  useEffect(() => {
    if (approval) {
      modalRef.current?.present();
      return;
    }

    modalRef.current?.dismiss();
  }, [approval]);

  if (!approval) {
    return null;
  }

  const isUntrusted = approval.trustState === "untrusted";

  return (
    <BottomSheetModal
      ref={modalRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose={false}
      backdropComponent={backdrop}
      handleIndicatorStyle={{ backgroundColor: "rgba(0,0,0,0.12)", width: 40 }}
      backgroundStyle={{ borderTopLeftRadius: 28, borderTopRightRadius: 28 }}
    >
      <BottomSheetView className="flex-1 px-5 pb-6 pt-1">
        <View className="items-center pt-4">
          <SiteAvatar
            origin={approval.origin}
            fallback="globe"
            size={56}
            rounded={18}
          />
          <Text className="mt-4 text-center text-[24px] font-[Geist_700Bold] text-black">
            {getRequestLabel(approval.type)}
          </Text>
          <Text
            className="mt-2 text-center text-[14px] font-[Geist_400Regular]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            {approval.origin}
          </Text>
        </View>

        <View
          className="mt-5 rounded-[24px] border px-4 py-4"
          style={{
            backgroundColor: "#faf8f4",
            borderColor: "rgba(60, 60, 67, 0.08)",
          }}
        >
          <View
            className="self-start rounded-full px-3 py-1.5"
            style={{
              backgroundColor: isUntrusted
                ? "rgba(234, 88, 12, 0.12)"
                : "rgba(50, 229, 94, 0.12)",
            }}
          >
            <Text
              className="text-[12px] font-[Geist_600SemiBold]"
              style={{ color: isUntrusted ? "#ea580c" : "#16a34a" }}
            >
              {getTrustLabel(approval.trustState)}
            </Text>
          </View>
          <Text
            className="mt-3 text-[14px] leading-6 font-[Geist_400Regular]"
            style={{ color: "#1c1c1e" }}
          >
            {getRequestDescription(approval.type)}
          </Text>
        </View>

        {isUntrusted ? (
          <View
            className="mt-4 flex-row rounded-[22px] border px-4 py-4"
            style={{
              backgroundColor: "#fff6f0",
              borderColor: "rgba(234, 88, 12, 0.16)",
            }}
          >
            <AlertCircle size={18} color="#ea580c" strokeWidth={2} />
            <Text
              className="ml-3 flex-1 text-[13px] leading-5 font-[Geist_500Medium]"
              style={{ color: "#9a3412" }}
            >
              This site is not in your trusted list yet. Only approve if you trust the origin and the request.
            </Text>
          </View>
        ) : null}

        <View className="mt-auto flex-row gap-3 pt-6">
          <Pressable
            className="flex-1 items-center rounded-[22px] px-4 py-4"
            style={{ backgroundColor: "rgba(60, 60, 67, 0.08)" }}
            onPress={onReject}
          >
            <Text className="text-[16px] font-[Geist_600SemiBold] text-black">
              Reject
            </Text>
          </Pressable>
          <Pressable
            className="flex-1 items-center rounded-[22px] px-4 py-4"
            style={{ backgroundColor: "#f97362" }}
            onPress={onApprove}
          >
            <Text className="text-[16px] font-[Geist_700Bold] text-white">
              {getPrimaryActionLabel(approval.type)}
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}
