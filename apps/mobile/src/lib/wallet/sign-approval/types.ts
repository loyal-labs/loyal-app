import type { Transaction, VersionedTransaction } from "@solana/web3.js";

export type SignApprovalRequest =
  | {
      kind: "transaction";
      title: string;
      subtitle?: string;
      transactions: (Transaction | VersionedTransaction)[];
    }
  | {
      kind: "message";
      title: string;
      subtitle?: string;
      messageBytes: Uint8Array;
    };

export type SignApprovalContextValue = {
  requestApproval: (request: SignApprovalRequest) => Promise<boolean>;
};
