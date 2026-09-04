import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { AlertCircle, ChevronDown, ChevronUp } from "lucide-react-native";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PendingApproval } from "../model/types";
import { SiteAvatar } from "./SiteAvatar";

import {
  decodeMessageBase64,
  decodeTransactionBase64,
  type DecodedInstruction,
} from "@/lib/solana/instructions";
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
  }
}

function getRequestDescription(type: PendingApproval["type"]): string {
  switch (type) {
    case "connect":
      return "Allow this site to view your public wallet address and request signatures.";
    case "signMessage":
      return "Review this message carefully before you sign it with Loyal.";
    case "signTransaction":
      return "Review this transaction carefully. It will be signed but not sent.";
    case "signAndSendTransaction":
      return "Review this transaction carefully. It will be signed and sent from Loyal.";
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

function DetailsCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      className="mt-4 overflow-hidden rounded-[20px] border"
      style={{
        backgroundColor: "#faf8f4",
        borderColor: "rgba(60, 60, 67, 0.08)",
      }}
    >
      {children}
    </View>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View
      className="px-4 py-3"
      style={{ borderTopWidth: 1, borderTopColor: "rgba(60, 60, 67, 0.08)" }}
    >
      <Text
        className="text-[12px] font-[Geist_500Medium]"
        style={{ color: "rgba(60, 60, 67, 0.6)" }}
      >
        {label}
      </Text>
      <View className="mt-1.5">{children}</View>
    </View>
  );
}

function InstructionsCard({ transactionBase64 }: { transactionBase64: string }) {
  const instructions = useMemo<DecodedInstruction[]>(
    () => decodeTransactionBase64(transactionBase64),
    [transactionBase64],
  );

  return (
    <DetailRow label={`Instructions (${instructions.length})`}>
      <View className="gap-1.5">
        {instructions.map((instruction, i) => (
          <View
            key={`${instruction.program}-${i}`}
            className="rounded-[12px] px-3 py-2.5"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.04)" }}
          >
            <Text
              className="text-[11px] font-[Geist_500Medium] uppercase"
              style={{
                color: "rgba(60, 60, 67, 0.6)",
                letterSpacing: 0.4,
              }}
            >
              {instruction.program}
            </Text>
            <Text
              className="mt-1 text-[14px] leading-[19px] font-[Geist_400Regular]"
              style={{ color: "#1c1c1e" }}
            >
              {instruction.description}
            </Text>
          </View>
        ))}
      </View>
    </DetailRow>
  );
}

function MessageCard({ messageBase64 }: { messageBase64: string }) {
  const decoded = useMemo(
    () => decodeMessageBase64(messageBase64),
    [messageBase64],
  );

  return (
    <DetailRow label="Message content">
      <View
        className="rounded-[12px] px-3 py-2.5"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.04)" }}
      >
        <Text
          className="text-[14px] leading-[19px]"
          style={{
            color: "#1c1c1e",
            fontFamily: "Menlo",
          }}
        >
          {decoded}
        </Text>
      </View>
    </DetailRow>
  );
}

function RawDataDisclosure({ base64 }: { base64: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View
      className="px-4 py-3"
      style={{ borderTopWidth: 1, borderTopColor: "rgba(60, 60, 67, 0.08)" }}
    >
      <Pressable
        className="flex-row items-center gap-1"
        onPress={() => setExpanded((prev) => !prev)}
        hitSlop={8}
      >
        <Text
          className="text-[12px] font-[Geist_500Medium]"
          style={{ color: "rgba(60, 60, 67, 0.6)" }}
        >
          Raw data
        </Text>
        {expanded ? (
          <ChevronUp size={14} color="rgba(60, 60, 67, 0.6)" strokeWidth={2} />
        ) : (
          <ChevronDown size={14} color="rgba(60, 60, 67, 0.6)" strokeWidth={2} />
        )}
      </Pressable>
      {expanded ? (
        <View
          className="mt-2 rounded-[12px] px-3 py-2.5"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.04)" }}
        >
          <Text
            className="text-[11px] leading-[16px]"
            style={{
              color: "rgba(60, 60, 67, 0.7)",
              fontFamily: "Menlo",
            }}
          >
            {base64}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function DappApprovalSheet({
  approval,
  onReject,
  onApprove,
}: DappApprovalSheetProps) {
  const insets = useSafeAreaInsets();
  const modalRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["92%"], []);
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
  const showTransactionDetails =
    approval.type === "signTransaction" ||
    approval.type === "signAndSendTransaction";
  const showMessageDetails = approval.type === "signMessage";

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
      <View className="flex-1">
        <BottomSheetScrollView
          contentContainerStyle={{
            paddingTop: 4,
            paddingHorizontal: 24,
            paddingBottom: 20,
          }}
          showsVerticalScrollIndicator={false}
        >
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
              className="mt-1.5 text-center text-[14px] font-[Geist_400Regular]"
              style={{ color: "rgba(60, 60, 67, 0.6)" }}
            >
              {approval.origin}
            </Text>
          </View>

          <DetailsCard>
            <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
              <View
                className="self-start rounded-full px-3 py-1"
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
            </View>
            <View className="px-4 pb-3">
              <Text
                className="text-[14px] leading-[20px] font-[Geist_400Regular]"
                style={{ color: "#1c1c1e" }}
              >
                {getRequestDescription(approval.type)}
              </Text>
            </View>

            {showTransactionDetails ? (
              <>
                <InstructionsCard
                  transactionBase64={approval.transactionBase64}
                />
                <RawDataDisclosure base64={approval.transactionBase64} />
              </>
            ) : null}

            {showMessageDetails ? (
              <>
                <MessageCard messageBase64={approval.messageBase64} />
                <RawDataDisclosure base64={approval.messageBase64} />
              </>
            ) : null}
          </DetailsCard>

          {isUntrusted ? (
            <View
              className="mt-4 flex-row rounded-[16px] border px-4 py-3"
              style={{
                backgroundColor: "#fff6f0",
                borderColor: "rgba(234, 88, 12, 0.16)",
              }}
            >
              <AlertCircle size={18} color="#ea580c" strokeWidth={2} />
              <Text
                className="ml-3 flex-1 text-[13px] leading-[18px] font-[Geist_500Medium]"
                style={{ color: "#9a3412" }}
              >
                This site is not in your trusted list. Only approve if you
                trust the origin and understand what you&apos;re signing.
              </Text>
            </View>
          ) : null}
        </BottomSheetScrollView>

        <View
          className="flex-row gap-3 px-6 pt-3"
          style={{
            paddingBottom: Math.max(insets.bottom + 12, 24),
            borderTopWidth: 1,
            borderTopColor: "rgba(60, 60, 67, 0.08)",
            backgroundColor: "#ffffff",
          }}
        >
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
      </View>
    </BottomSheetModal>
  );
}
