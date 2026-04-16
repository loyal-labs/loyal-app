import type { TokenRow } from "@loyal-labs/wallet-core/types";
import { SubViewHeader } from "./shared";

export function TokenDetailView({
  token,
  onBack,
  onClose,
}: {
  token: TokenRow;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SubViewHeader title={token.symbol} onBack={onBack} onClose={onClose} />
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: "14px",
          color: "rgba(60, 60, 67, 0.6)",
        }}
      >
        Loading {token.symbol} details...
      </div>
    </div>
  );
}
