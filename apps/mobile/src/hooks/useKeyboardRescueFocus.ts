import { useCallback, useEffect, useRef } from "react";
import { Keyboard } from "react-native";

type FocusableInput = { focus: () => void; blur?: () => void };

/**
 * iOS rescue for the transparent amount inputs inside bottom sheets.
 *
 * The money sheets dismiss the keyboard imperatively (MAX buttons, token
 * pickers call Keyboard.dismiss()). After that, tapping the overlay
 * BottomSheetTextInput on iOS sometimes never re-summons the keyboard —
 * @gorhom/bottom-sheet v5's keyboard state gets stuck and the native focus
 * path produces nothing (no fix in 5.2.9–5.2.14). Android is unaffected.
 *
 * Attach the returned handler to the input's onPressIn. It waits long enough
 * for the native path to work; if no keyboard appeared, it blurs and
 * refocuses the input, which reliably brings the keyboard back. When the
 * native path works (first focus, Android, healthy iOS), it is a no-op.
 */
export function useKeyboardRescueFocus(
  inputRef: React.RefObject<FocusableInput | null>,
): { onPressIn: () => void } {
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

  const onPressIn = useCallback(() => {
    setTimeout(() => {
      if (keyboardVisible.current) return;
      const input = inputRef.current;
      if (!input) return;
      input.blur?.();
      setTimeout(() => input.focus(), 60);
    }, 160);
  }, [inputRef]);

  return { onPressIn };
}
