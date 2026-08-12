import { Text, View } from "@/tw";

import { getAvatarColor, getFirstLetter } from "./avatar-utils";

export function SourceAvatars({ sources }: { sources: string[] }) {
  return (
    <View className="flex-row items-center pt-3">
      {sources.slice(0, 3).map((source, index) => (
        <View
          key={source}
          className="w-7 h-7 rounded-full items-center justify-center"
          style={{
            backgroundColor: getAvatarColor(source),
            marginRight: -2,
            zIndex: sources.length - index,
          }}
        >
          <Text className="text-[10px] font-medium text-white">
            {getFirstLetter(source)}
          </Text>
        </View>
      ))}
    </View>
  );
}
