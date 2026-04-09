import { useState } from "react";

import { SearchInput, SubViewHeader } from "~/src/components/wallet/shared";
import { TokenRowItem, type TokenRowActions } from "~/src/components/wallet/token-row-item";
import type { TokenRow } from "@loyal-labs/wallet-core/types";

export function AllTokensView({
  tokens,
  isBalanceHidden,
  onBack,
  onClose,
  getTokenActions,
}: {
  tokens: TokenRow[];
  isBalanceHidden: boolean;
  onBack: () => void;
  onClose: () => void;
  getTokenActions?: (token: TokenRow) => TokenRowActions | undefined;
}) {
  const [search, setSearch] = useState("");
  const filtered = tokens.filter((t) =>
    t.symbol.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* SVG pixelation filter for balance-hidden mode */}
      <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        <defs>
          <filter id="rs-pixelate-sm" x="0" y="0" width="100%" height="100%">
            <feFlood x="3" y="3" height="2" width="2" />
            <feComposite width="8" height="8" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="4" />
          </filter>
        </defs>
      </svg>
      <SubViewHeader onBack={onBack} onClose={onClose} title="Tokens" />
      <SearchInput onChange={setSearch} value={search} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "0 8px",
        }}
      >
        {filtered.map((token, i) => (
          <TokenRowItem
            actions={getTokenActions?.(token)}
            isBalanceHidden={isBalanceHidden}
            key={token.id ?? `${token.symbol}-${i}`}
            token={token}
          />
        ))}
        {filtered.length === 0 && (
          <div
            style={{
              padding: "32px 20px",
              textAlign: "center",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "14px",
              color: "rgba(60, 60, 67, 0.6)",
            }}
          >
            No tokens found
          </div>
        )}
      </div>
    </div>
  );
}
