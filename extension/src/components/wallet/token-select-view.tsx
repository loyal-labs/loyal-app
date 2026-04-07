import { useEffect, useRef, useState } from "react";

import { SearchInput, SubViewHeader } from "~/src/components/wallet/shared";
import type { SwapToken } from "@loyal-labs/wallet-core/types";

function SelectableTokenRow({
  token,
  isSelected,
  onClick,
}: {
  token: SwapToken;
  isSelected: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        borderRadius: "16px",
        width: "100%",
        overflow: "hidden",
        background: isSelected ? "rgba(0, 0, 0, 0.04)" : hovered ? "rgba(0, 0, 0, 0.04)" : "transparent",
        transition: "background-color 0.15s ease",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", paddingRight: "12px", paddingTop: "6px", paddingBottom: "6px", flexShrink: 0 }}>
        <div style={{ width: "48px", height: "48px", borderRadius: "9999px", overflow: "hidden" }}>
          {token.icon ? (
            <img alt={token.symbol} height={48} src={token.icon} style={{ width: "100%", height: "100%", objectFit: "cover" }} width={48} />
          ) : (
            <div style={{ width: "100%", height: "100%", background: "rgba(0,0,0,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 600, color: "rgba(0,0,0,0.3)" }}>
              {token.symbol.slice(0, 2)}
            </div>
          )}
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", padding: "10px 0", minWidth: 0 }}>
        <span style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: "16px", fontWeight: 500, lineHeight: "20px", color: "#000", letterSpacing: "-0.176px" }}>
          {token.symbol}
        </span>
        <span style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: "rgba(60, 60, 67, 0.6)" }}>
          {token.price > 0
            ? `$${token.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
            : ""}
        </span>
      </div>
      {token.balance > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-end", justifyContent: "center", padding: "10px 0", paddingLeft: "12px", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: "16px", fontWeight: 400, lineHeight: "20px", color: "#000", textAlign: "right" }}>
            {token.balance.toLocaleString()}
          </span>
          <span style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: "13px", fontWeight: 400, lineHeight: "16px", color: "rgba(60, 60, 67, 0.6)" }}>
            ${(token.balance * token.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}
    </div>
  );
}

export function TokenSelectView({
  title,
  currentToken,
  onSelect,
  onBack,
  onClose,
  tokens,
  onSearch,
}: {
  title: string;
  currentToken: SwapToken;
  onSelect: (token: SwapToken) => void;
  onBack: () => void;
  onClose: () => void;
  tokens: SwapToken[];
  onSearch?: (query: string) => Promise<SwapToken[]>;
}) {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SwapToken[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = search.toLowerCase();
  const localFiltered = tokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(query) ||
      (t.mint && t.mint.toLowerCase().includes(query)),
  );

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!onSearch || search.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchTimerRef.current = setTimeout(() => {
      void onSearch(search)
        .then((results) => {
          const localMints = new Set(tokens.map((t) => t.mint).filter(Boolean));
          setSearchResults(results.filter((t) => t.mint && !localMints.has(t.mint)));
        })
        .catch(() => setSearchResults([]))
        .finally(() => setIsSearching(false));
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search, onSearch, tokens]);

  const allResults = search.length >= 2
    ? [...localFiltered, ...searchResults]
    : localFiltered;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SubViewHeader onBack={onBack} onClose={onClose} title={title} />
      <SearchInput onChange={setSearch} value={search} />
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 8px" }}>
        {allResults.map((token, i) => (
          <SelectableTokenRow
            isSelected={token.mint ? token.mint === currentToken.mint : token.symbol === currentToken.symbol}
            key={token.mint ?? `${token.symbol}-${i}`}
            onClick={() => {
              onSelect(token);
              onBack();
            }}
            token={token}
          />
        ))}
        {isSearching && allResults.length === 0 && (
          <div style={{ padding: "32px 20px", textAlign: "center", fontFamily: "var(--font-geist-sans), sans-serif", fontSize: "14px", color: "rgba(60, 60, 67, 0.6)" }}>
            Searching...
          </div>
        )}
        {!isSearching && allResults.length === 0 && (
          <div style={{ padding: "32px 20px", textAlign: "center", fontFamily: "var(--font-geist-sans), sans-serif", fontSize: "14px", color: "rgba(60, 60, 67, 0.6)" }}>
            No tokens found
          </div>
        )}
      </div>
    </div>
  );
}
