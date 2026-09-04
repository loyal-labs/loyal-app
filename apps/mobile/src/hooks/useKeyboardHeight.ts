import { useState } from "react";
import {
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedReaction,
} from "react-native-reanimated";

export function useKeyboardHeight() {
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  const [height, setHeight] = useState(0);

  useAnimatedReaction(
    () => keyboard.height.value,
    (current, previous) => {
      if (current !== previous) {
        runOnJS(setHeight)(current);
      }
    },
  );

  return height;
}
