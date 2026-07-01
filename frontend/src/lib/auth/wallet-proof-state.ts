"use client";

export type WalletProofStatus =
  | "idle"
  | "connecting"
  | "awaiting_signature"
  | "verifying"
  | "success"
  | "rejected"
  | "unsupported"
  | "error";

export type WalletProofState = {
  status: WalletProofStatus;
  errorMessage: string;
  errorDetails: string[];
};

export type WalletProofAction =
  | { type: "reset" }
  | { type: "connecting" }
  | { type: "awaiting_signature" }
  | { type: "verifying" }
  | { type: "success" }
  | {
      type: "failed";
      status: Extract<WalletProofStatus, "rejected" | "unsupported" | "error">;
      message: string;
      details?: string[];
    };

export const initialWalletProofState: WalletProofState = {
  status: "idle",
  errorMessage: "",
  errorDetails: [],
};

export function walletProofReducer(
  state: WalletProofState,
  action: WalletProofAction
): WalletProofState {
  switch (action.type) {
    case "reset":
      return initialWalletProofState;
    case "connecting":
      return { status: "connecting", errorMessage: "", errorDetails: [] };
    case "awaiting_signature":
      return {
        status: "awaiting_signature",
        errorMessage: "",
        errorDetails: [],
      };
    case "verifying":
      return { status: "verifying", errorMessage: "", errorDetails: [] };
    case "success":
      return { status: "success", errorMessage: "", errorDetails: [] };
    case "failed":
      return {
        status: action.status,
        errorMessage: action.message,
        errorDetails: action.details ?? [],
      };
    default:
      return state;
  }
}
