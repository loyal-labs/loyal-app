export class WalletAuthError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    message: string,
    options: {
      code: string;
      status: number;
      details?: unknown;
    }
  ) {
    super(message);
    this.name = "WalletAuthError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
  }
}
