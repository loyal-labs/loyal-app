import { View } from "@/tw";

function ChatItemSkeleton() {
  return (
    <View className="flex-row items-center px-4 py-1.5">
      <View className="w-12 h-12 rounded-full bg-black/5" />
      <View className="flex-1 ml-3 gap-1.5">
        <View className="w-32 h-5 rounded bg-black/5" />
        <View className="w-48 h-4 rounded bg-black/5" />
      </View>
    </View>
  );
}

export function ChatListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <ChatItemSkeleton key={i} />
      ))}
    </>
  );
}
