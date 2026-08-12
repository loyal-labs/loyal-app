import { StyleSheet } from "react-native";

import { Image } from "@/tw/image";
import { Pressable, Text, View } from "@/tw";

import { getAvatarColor, getFirstLetter } from "./avatar-utils";

type ChatItemProps = {
  title: string;
  subtitle?: string;
  photoUrl?: string;
  // Deprecated compatibility fields; remove after migration window.
  photoBase64?: string;
  photoMimeType?: string;
  onPress: () => void;
};

export function ChatItem({
  title,
  subtitle,
  photoUrl,
  photoBase64,
  photoMimeType,
  onPress,
}: ChatItemProps) {
  const avatarColor = getAvatarColor(title);
  const firstLetter = getFirstLetter(title);

  const photoUri =
    photoUrl ??
    (photoBase64
      ? `data:${photoMimeType ?? "image/jpeg"};base64,${photoBase64}`
      : null);

  return (
    <Pressable
      className="flex-row items-center px-4 py-1.5 active:opacity-80"
      onPress={onPress}
    >
      {/* Avatar */}
      {photoUri ? (
        <Image
          source={{ uri: photoUri }}
          className="w-12 h-12 rounded-full object-cover"
        />
      ) : (
        <View
          className="w-12 h-12 rounded-full items-center justify-center"
          style={{ backgroundColor: avatarColor }}
        >
          <Text className="text-lg font-medium text-white">{firstLetter}</Text>
        </View>
      )}

      {/* Text content */}
      <View
        className="flex-1 ml-3 py-2.5 overflow-visible"
        style={styles.textContainer}
      >
        <Text
          numberOfLines={1}
          style={{
            fontFamily: "Geist_500Medium",
            fontSize: 16,
            lineHeight: 22,
            color: "#000",
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={{
              fontFamily: "Geist_400Regular",
              fontSize: 13,
              color: "rgba(0,0,0,0.5)",
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  textContainer: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.12)",
  },
});
