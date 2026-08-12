// Guard for the workspace keyboard shortcuts: section keys and Esc must not
// fire while the user is typing (an address, an amount, a search query).
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}

// Esc-only variant: numbers-only fields (the amount inputs, all
// inputMode="decimal") can't conflict with Esc, so backing out of a flow
// stays available while one is focused — only free-text fields swallow it.
export function isEscapeGuardedTarget(target: EventTarget | null): boolean {
  if (!isTypingTarget(target)) {
    return false;
  }
  return !(
    target instanceof HTMLInputElement &&
    (target.inputMode === "decimal" ||
      target.inputMode === "numeric" ||
      target.type === "number")
  );
}
