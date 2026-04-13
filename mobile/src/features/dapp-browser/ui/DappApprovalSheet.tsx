import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { AlertCircle } from "lucide-react-native";
import { useEffect, useMemo, useRef, type ComponentProps } from "react";

import type { PendingApproval } from "../model/types";

import { Pressable, Text, View } from "@/tw";

type DappApprovalSheetProps = {
  approval: PendingApproval | null;
  onReject: () => void;
  onApprove: () => void;
};

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
  const snapPoints = useMemo(() => ["42%"], []);
  const backdrop = useMemo(
    () =>
      (props: ComponentProps<typeof BottomSheetBackdrop>) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          pressBehavior="none"
          opacity={0.32}
        />
      ),
    [],
  );

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
    >
      <BottomSheetView className="flex-1 px-4 pb-6 pt-1">
        <View className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-black/10" />
        <Text className="text-[17px] font-[Geist_700Bold] text-black">
          {getRequestLabel(approval.type)}
        </Text>
        <Text
          className="mt-2 text-[13px] font-[Geist_400Regular]"
          style={{ color: "rgba(60, 60, 67, 0.6)" }}
        >
          {approval.origin}
        </Text>

        <View
          className="mt-4 flex-row items-center self-start rounded-full px-3 py-1.5"
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

        {isUntrusted ? (
          <View
            className="mt-4 flex-row rounded-[20px] px-4 py-3"
            style={{ backgroundColor: "rgba(234, 88, 12, 0.12)" }}
          >
            <AlertCircle size={18} color="#ea580c" strokeWidth={2} />
            <Text
              className="ml-2 flex-1 text-[13px] font-[Geist_400Regular]"
              style={{ color: "#9a3412" }}
            >
              This site is not remembered yet. Only approve if you trust it.
            </Text>
          </View>
        ) : null}

        <View className="mt-auto gap-3 pt-5">
          <Pressable
            className="items-center rounded-[22px] px-4 py-4"
            style={{ backgroundColor: "rgba(60, 60, 67, 0.08)" }}
            onPress={onReject}
          >
            <Text className="text-[16px] font-[Geist_600SemiBold] text-black">
              Reject
            </Text>
          </Pressable>
          <Pressable
            className="items-center rounded-[22px] px-4 py-4"
            style={{ backgroundColor: "#f97362" }}
            onPress={onApprove}
          >
            <Text className="text-[16px] font-[Geist_700Bold] text-white">
              Approve
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}
