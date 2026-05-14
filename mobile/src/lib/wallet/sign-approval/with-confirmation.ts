import type { Signer } from "../signer";
import type { SignApprovalContextValue } from "./types";

export class UserRejectedSigningError extends Error {
  constructor(message = "User rejected signing request.") {
    super(message);
    this.name = "UserRejectedSigningError";
  }
}

export type ConfirmLabels = {
  title?: string;
  subtitle?: string;
};

export type ConfirmLabelsSource = ConfirmLabels | (() => ConfirmLabels | undefined);

function resolveLabels(source?: ConfirmLabelsSource): ConfirmLabels | undefined {
  if (!source) return undefined;
  return typeof source === "function" ? source() : source;
}

/**
 * Wraps a Signer so every sign call surfaces a decoded-instruction
 * preview to the user before the underlying signer runs. Works for
 * both keypair wallets (where signing is otherwise silent) and Seeker
 * / Seed Vault (where the native biometric prompt alone hides what is
 * being signed).
 *
 * `labels` may be a static object or a getter. A getter lets callers
 * cache the wrapped signer (e.g. inside a long-lived SDK client) while
 * varying per-operation titles via a ref.
 */
export function withConfirmation(
  signer: Signer,
  ctx: SignApprovalContextValue,
  labels?: ConfirmLabelsSource,
): Signer {
  const { requestApproval } = ctx;

  const wrapped: Signer = {
    publicKey: signer.publicKey,
    kind: signer.kind,

    async signMessage(bytes) {
      const current = resolveLabels(labels);
      const approved = await requestApproval({
        kind: "message",
        title: current?.title ?? "Approve signature",
        subtitle: current?.subtitle,
        messageBytes: bytes,
      });
      if (!approved) throw new UserRejectedSigningError();
      return signer.signMessage(bytes);
    },

    async signTransaction(tx) {
      const current = resolveLabels(labels);
      const approved = await requestApproval({
        kind: "transaction",
        title: current?.title ?? "Approve transaction",
        subtitle: current?.subtitle,
        transactions: [tx],
      });
      if (!approved) throw new UserRejectedSigningError();
      return signer.signTransaction(tx);
    },

    async signAllTransactions(txs) {
      const current = resolveLabels(labels);
      const approved = await requestApproval({
        kind: "transaction",
        title:
          current?.title ??
          (txs.length > 1 ? "Approve transactions" : "Approve transaction"),
        subtitle: current?.subtitle,
        transactions: txs,
      });
      if (!approved) throw new UserRejectedSigningError();
      return signer.signAllTransactions(txs);
    },
  };

  return wrapped;
}
