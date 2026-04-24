import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import {
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { ChevronDown, ChevronUp, ShieldCheck } from "lucide-react-native";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { SignApprovalRequest } from "./types";

import {
  decodeMessageBytes,
  decodeTransactionInstructions,
  type DecodedInstruction,
} from "@/lib/solana/instructions";
import { Pressable, Text, View } from "@/tw";

type AnyTransaction = Transaction | VersionedTransaction;

type SignApprovalSheetProps = {
  pending: SignApprovalRequest | null;
  onApprove: () => void;
  onReject: () => void;
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

function SectionHeader({ label }: { label: string }) {
  return (
    <Text
      className="px-4 pt-4 pb-2 text-[12px] font-[Geist_500Medium]"
      style={{ color: "rgba(60, 60, 67, 0.6)" }}
    >
      {label}
    </Text>
  );
}

function InstructionRow({ instruction }: { instruction: DecodedInstruction }) {
  return (
    <View
      className="rounded-[12px] px-3 py-2.5"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.04)" }}
    >
      <Text
        className="text-[11px] font-[Geist_500Medium] uppercase"
        style={{ color: "rgba(60, 60, 67, 0.6)", letterSpacing: 0.4 }}
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
  );
}

function TransactionInstructionsGroup({
  transactions,
}: {
  transactions: AnyTransaction[];
}) {
  const groups = useMemo(
    () =>
      transactions.map((tx, txIndex) => ({
        txIndex,
        instructions: decodeTransactionInstructions(tx),
      })),
    [transactions],
  );

  const total = groups.reduce((sum, group) => sum + group.instructions.length, 0);
  const showTxLabels = groups.length > 1;

  return (
    <>
      <SectionHeader
        label={`Instructions (${total}${
          showTxLabels ? ` across ${groups.length} txs` : ""
        })`}
      />
      <View className="gap-3 px-4 pb-3">
        {groups.map((group) => (
          <View key={group.txIndex} className="gap-1.5">
            {showTxLabels ? (
              <Text
                className="text-[11px] font-[Geist_600SemiBold] uppercase"
                style={{ color: "rgba(60, 60, 67, 0.5)", letterSpacing: 0.4 }}
              >
                Transaction {group.txIndex + 1}
              </Text>
            ) : null}
            <View className="gap-1.5">
              {group.instructions.map((instruction, i) => (
                <InstructionRow
                  key={`${instruction.program}-${i}`}
                  instruction={instruction}
                />
              ))}
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

function MessageBlock({ bytes }: { bytes: Uint8Array }) {
  const decoded = useMemo(() => decodeMessageBytes(bytes), [bytes]);

  return (
    <>
      <SectionHeader label="Message content" />
      <View className="px-4 pb-3">
        <View
          className="rounded-[12px] px-3 py-2.5"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.04)" }}
        >
          <Text
            className="text-[14px] leading-[19px]"
            style={{ color: "#1c1c1e", fontFamily: "Menlo" }}
          >
            {decoded}
          </Text>
        </View>
      </View>
    </>
  );
}

function RawDataDisclosure({ payload }: { payload: string }) {
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
            style={{ color: "rgba(60, 60, 67, 0.7)", fontFamily: "Menlo" }}
          >
            {payload}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function serializeTransactionToBase64(tx: AnyTransaction): string {
  try {
    const bytes =
      tx instanceof VersionedTransaction
        ? tx.serialize()
        : tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    return Buffer.from(bytes).toString("base64");
  } catch {
    return "";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function SignApprovalSheet({
  pending,
  onApprove,
  onReject,
}: SignApprovalSheetProps) {
  const insets = useSafeAreaInsets();
  const modalRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["88%"], []);
  const backdrop = useMemo(() => ApprovalBackdrop, []);

  useEffect(() => {
    if (pending) {
      modalRef.current?.present();
      return;
    }
    modalRef.current?.dismiss();
  }, [pending]);

  const rawPayload = useMemo(() => {
    if (!pending) return "";
    if (pending.kind === "message") return bytesToBase64(pending.messageBytes);
    return pending.transactions
      .map(serializeTransactionToBase64)
      .filter(Boolean)
      .join("\n\n");
  }, [pending]);

  if (!pending) return null;

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
            paddingTop: 8,
            paddingHorizontal: 24,
            paddingBottom: 20,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View className="items-center pt-3">
            <View
              className="h-14 w-14 items-center justify-center rounded-[18px]"
              style={{ backgroundColor: "rgba(50, 229, 94, 0.12)" }}
            >
              <ShieldCheck size={28} color="#16a34a" strokeWidth={2} />
            </View>
            <Text className="mt-4 text-center text-[24px] font-[Geist_700Bold] text-black">
              {pending.title}
            </Text>
            {pending.subtitle ? (
              <Text
                className="mt-1.5 text-center text-[14px] font-[Geist_400Regular]"
                style={{ color: "rgba(60, 60, 67, 0.6)" }}
              >
                {pending.subtitle}
              </Text>
            ) : null}
            <Text
              className="mt-1.5 text-center text-[13px] font-[Geist_400Regular]"
              style={{ color: "rgba(60, 60, 67, 0.6)" }}
            >
              Review the instructions below before approving.
            </Text>
          </View>

          <DetailsCard>
            {pending.kind === "transaction" ? (
              <TransactionInstructionsGroup
                transactions={pending.transactions}
              />
            ) : (
              <MessageBlock bytes={pending.messageBytes} />
            )}
            {rawPayload ? <RawDataDisclosure payload={rawPayload} /> : null}
          </DetailsCard>
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
              Approve
            </Text>
          </Pressable>
        </View>
      </View>
    </BottomSheetModal>
  );
}
