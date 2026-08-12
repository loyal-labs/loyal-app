// Insecure contexts (private-network dev hosts) have no clipboard API, so
// fall back to the hidden-textarea execCommand path.
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const didCopy = document.execCommand("copy");
  textarea.remove();
  return didCopy;
}
