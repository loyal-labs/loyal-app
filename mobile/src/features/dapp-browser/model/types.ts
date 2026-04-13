export type DappTrustState = "trusted" | "connected" | "untrusted";

export type TrustedDapp = {
  origin: string;
  name: string;
  startUrl: string;
  iconSlug: "jupiter";
};

export type DappHistoryEntry = {
  origin: string;
  url: string;
  title: string | null;
  lastVisitedAt: number;
};

export type PendingApproval = {
  requestId: string;
  origin: string;
  trustState: DappTrustState;
  type:
    | "connect"
    | "signMessage"
    | "signTransaction"
    | "signAndSendTransaction";
  payload: Record<string, unknown>;
};
