import { ArrowLeft, ArrowRight, House, RotateCw } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Pressable, View } from "@/tw";

type BrowserToolbarProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onHome: () => void;
  onRefresh: () => void;
};

const SURFACE = "#f6f6f2";

export function BrowserToolbar({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onHome,
  onRefresh,
}: BrowserToolbarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-row items-center justify-between border-t border-black/5 px-5 pt-3"
      style={{
        backgroundColor: "#ffffff",
        paddingBottom: Math.max(insets.bottom, 12),
      }}
    >
      <ToolbarButton icon={<ArrowLeft size={20} color="#000" />} onPress={onBack} disabled={!canGoBack} />
      <ToolbarButton
        icon={<ArrowRight size={20} color="#000" />}
        onPress={onForward}
        disabled={!canGoForward}
      />
      <ToolbarButton icon={<House size={20} color="#000" />} onPress={onHome} />
      <ToolbarButton icon={<RotateCw size={20} color="#000" />} onPress={onRefresh} />
    </View>
  );
}

function ToolbarButton({
  disabled = false,
  icon,
  onPress,
}: {
  disabled?: boolean;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="h-11 w-11 items-center justify-center rounded-full"
      style={{
        backgroundColor: SURFACE,
        opacity: disabled ? 0.35 : 1,
      }}
      disabled={disabled}
      onPress={onPress}
    >
      {icon}
    </Pressable>
  );
}
