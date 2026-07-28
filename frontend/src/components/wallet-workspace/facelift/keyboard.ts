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
