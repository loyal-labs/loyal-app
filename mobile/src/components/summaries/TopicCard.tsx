import type { Topic } from "@loyal-labs/shared";

import { Text, View } from "@/tw";

import { SourceAvatars } from "./SourceAvatars";

export function TopicCard({ topic }: { topic: Topic }) {
  return (
    <View
      style={{
        backgroundColor: "#F2F2F7",
        borderRadius: 26,
        borderCurve: "continuous",
        padding: 16,
      }}
    >
      <Text
        style={{
          fontFamily: "Geist_600SemiBold",
          fontSize: 20,
          lineHeight: 28,
          color: "#000",
          paddingBottom: 12,
        }}
      >
        {topic.title}
      </Text>
      <Text
        style={{
          fontFamily: "Geist_400Regular",
          fontSize: 15,
          lineHeight: 20,
          color: "rgba(60,60,67,0.8)",
        }}
      >
        {topic.content}
      </Text>
      <SourceAvatars sources={topic.sources} />
    </View>
  );
}
