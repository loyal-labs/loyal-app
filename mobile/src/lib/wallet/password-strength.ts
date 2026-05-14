export const MIN_PASSWORD_LENGTH = 6;

export type PasswordStrengthLevel = "weak" | "fair" | "strong";

export function getPasswordStrength(password: string): {
  level: PasswordStrengthLevel;
  label: string;
  color: string;
} {
  if (password.length === 0) {
    return { level: "weak", label: "", color: "transparent" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { level: "weak", label: "Too short", color: "#FF3B30" };
  }

  const types = [/[a-zA-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((r) =>
    r.test(password),
  ).length;

  if (password.length >= 10 && types >= 2) {
    return { level: "strong", label: "Strong", color: "#34C759" };
  }
  if (password.length >= 8 || types >= 2) {
    return { level: "fair", label: "Fair", color: "#FF9500" };
  }
  return { level: "weak", label: "Weak", color: "#FF3B30" };
}
