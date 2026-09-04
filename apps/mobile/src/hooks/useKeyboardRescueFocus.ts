import { useCallback, useEffect, useRef } from "react";
import { Keyboard } from "react-native";

type FocusableInput = { focus: () => void; blur?: () => void };

/**
 * Deterministic keyboard summon for the transparent amount inputs inside
 * bottom sheets.
 *
 * On iPad the keyboard's dismiss key hides the keyboard WITHOUT blurring the
 * input: the input stays first responder, so both native taps and focus()
 * become no-ops and the user is stuck with no keyboard. The same stuck state
 * can follow Keyboard.dismiss() with @gorhom/bottom-sheet v5 on iOS. The only
 * reliable escape is blur-then-focus.
 *
 * The tap must reach JS deterministically, so the amount row is a Pressable
 * whose onPress calls the returned openKeyboard, and the overlay input gets
 * pointerEvents="none" (typing still works — keyboard events go to the
 * focused input regardless of pointer events). An earlier attempt used
 * onPressIn on the gesture-handler input; those touches never fired in the
 * stuck state.
 */
export function useKeyboardRescueFocus(
  inputRef: React.RefObject<FocusableInput | null>,
): { openKeyboard: () => void } {
  const keyboardVisible = useRef(false);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => {
      keyboardVisible.current = true;
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardVisible.current = false;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const openKeyboard = useCallback(() => {
    // Keyboard already up: the input is focused and typing works — a tap on
    // the row must not bounce the keyboard.
    if (keyboardVisible.current) return;
    const input = inputRef.current;
    if (!input) return;
    // Unconditional: if the input silently stayed first responder, focus()
    // alone is a no-op; blurring first always breaks the stuck state.
    input.blur?.();
    setTimeout(() => input.focus(), 60);
  }, [inputRef]);

  return { openKeyboard };
}
