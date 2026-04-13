import { Globe, History } from "lucide-react-native";
import { useEffect, useState } from "react";

import { buildOriginFaviconUrl } from "../model/origin";

import { Image } from "@/tw/image";
import { View } from "@/tw";

type SiteAvatarProps = {
  origin: string;
  size?: number;
  fallback: "globe" | "history";
  rounded?: number;
};

const SURFACE = "rgba(60, 60, 67, 0.08)";
const CORAL = "#f97362";

export function SiteAvatar({
  origin,
  size = 44,
  fallback,
  rounded = 14,
}: SiteAvatarProps) {
  const [didError, setDidError] = useState(false);

  useEffect(() => {
    setDidError(false);
  }, [origin]);

  const faviconUrl = buildOriginFaviconUrl(origin);
  const Icon = fallback === "history" ? History : Globe;

  return (
    <View
      className="items-center justify-center overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        backgroundColor: didError ? SURFACE : "#fff",
      }}
    >
      {didError ? (
        <Icon
          size={Math.max(18, Math.round(size * 0.42))}
          color={fallback === "history" ? "#000" : CORAL}
          strokeWidth={2}
        />
      ) : (
        <Image
          source={faviconUrl}
          className="h-full w-full"
          contentFit="cover"
          transition={150}
          onError={() => setDidError(true)}
        />
      )}
    </View>
  );
}
