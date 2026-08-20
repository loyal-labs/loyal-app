import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Height + snap points for the app's fixed-height bottom sheets.
 *
 * The sheets used to pair a percentage snap point ("94%") with a content box
 * sized from Dimensions.get("screen"). Those resolve against different
 * things: the percentage against the container @gorhom/bottom-sheet actually
 * measures (the window, minus the top safe area on iOS), the box against the
 * physical screen. On iPhones with a notch the box overshot the sheet by the
 * top inset; on an iPad running the app in iPhone-compatibility or windowed
 * mode the window is far smaller than the screen and the sheet's bottom CTA
 * landed completely off-screen with no way to scroll to it.
 *
 * Returning the SAME pixel value as both the numeric snap point and the
 * content-box height makes divergence impossible, on every device shape.
 * The top-inset clamp keeps the sheet from reaching under the notch.
 */
export function useFixedSheetLayout(fraction = 0.94): {
  sheetHeight: number;
  snapPoints: [number];
} {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useMemo(() => {
    const sheetHeight = Math.min(
      Math.floor(height * fraction),
      Math.floor(height - insets.top - 12),
    );
    return { sheetHeight, snapPoints: [sheetHeight] };
  }, [height, insets.top, fraction]);
}
