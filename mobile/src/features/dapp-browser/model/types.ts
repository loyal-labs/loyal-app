export type DappTrustState = "trusted" | "connected" | "untrusted";

export type TrustedDapp = {
  origin: string;
  name: string;
  startUrl: string;
  category: string | null;
};

type PendingApprovalBase = {
  requestId: string;
  origin: string;
  trustState: DappTrustState;
};

export type PendingApproval =
  | (PendingApprovalBase & { type: "connect" })
  | (PendingApprovalBase & { type: "signMessage"; messageBase64: string })
  | (PendingApprovalBase & {
      type: "signTransaction";
      transactionBase64: string;
    })
  | (PendingApprovalBase & {
      type: "signAndSendTransaction";
      transactionBase64: string;
    });

export type PendingApprovalType = PendingApproval["type"];
