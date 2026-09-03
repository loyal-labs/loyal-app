"use client";

import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import {
  getCachedTrendingTokens,
  prefetchTrendingTokens,
  rankSearchResults,
  searchTokens,
  type TokenSearchResult,
} from "@/lib/market/token-search.client";

import { SearchInput } from "./shared";
import type { SwapToken } from "./types";

// Typeahead is user-perceived latency; debounce only long enough to collapse a
// burst of keystrokes into a single request.
const SEARCH_DEBOUNCE_MS = 120;
// Remote search and trending only kick in from 2 chars, as before.
const MIN_SEARCH_LENGTH = 2;

function SectionLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-geist-sans), sans-serif",
        fontSize: "11px",
        fontWeight: 600,
        lineHeight: "16px",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "rgba(60, 60, 67, 0.6)",
        padding: "12px 12px 4px",
      }}
    >
      {children}
    </div>
  );
}

function SelectableTokenRow({
  token,
  isActive,
  isSelected,
  onClick,
}: {
  token: SwapToken;
  isActive: boolean;
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
        overflow: "visible",
        // The keyboard-active suggestion reads slightly stronger than hover or
        // the already-selected token so Enter's target is never ambiguous.
        background: isActive
          ? "rgba(0, 0, 0, 0.06)"
          : isSelected || hovered
          ? "rgba(0, 0, 0, 0.04)"
          : "transparent",
        transition: "background-color 0.15s ease",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          paddingRight: "12px",
          paddingTop: "6px",
          paddingBottom: "6px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "9999px",
            position: "relative",
          }}
        >
          <div
            style={{
              borderRadius: "9999px",
              height: "48px",
              overflow: "hidden",
              width: "48px",
            }}
          >
            {token.icon ? (
              <Image
                alt={token.symbol}
                height={48}
                src={token.icon}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                width={48}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background: "rgba(0,0,0,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "rgba(0,0,0,0.3)",
                }}
              >
                {token.symbol.slice(0, 2)}
              </div>
            )}
          </div>
        </div>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          padding: "10px 0",
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "16px",
            fontWeight: 500,
            lineHeight: "20px",
            color: "#000",
            letterSpacing: "-0.176px",
          }}
        >
          {token.symbol}
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "13px",
            fontWeight: 400,
            lineHeight: "16px",
            color: "rgba(60, 60, 67, 0.6)",
          }}
        >
          {token.price > 0
            ? `$${token.price.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 6,
              })}`
            : ""}
        </span>
      </div>
      {token.balance > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: "10px 0",
            paddingLeft: "12px",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "#000",
              textAlign: "right",
            }}
          >
            {token.balance.toLocaleString()}
          </span>
          <span
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "16px",
              color: "rgba(60, 60, 67, 0.6)",
            }}
          >
            $
            {(token.balance * token.price).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
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
  tokens,
  onSearch,
  isTokenSelected,
}: {
  title: string;
  currentToken: SwapToken;
  onSelect: (token: SwapToken) => void;
  onBack: () => void;
  onClose: () => void;
  tokens: SwapToken[];
  /**
   * Opts this picker into remote token search (and therefore trending).
   * Search is run in here via `searchTokens`, so the callback itself is unused
   * beyond acting as the flag — kept so existing callers keep compiling.
   */
  onSearch?: (query: string) => Promise<SwapToken[]>;
  isTokenSelected?: (token: SwapToken) => boolean;
}) {
  const remoteSearchEnabled = Boolean(onSearch);
  const [search, setSearch] = useState("");
  const [remoteResults, setRemoteResults] = useState<TokenSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Hydrated from cache so a warm picker paints trending on the first render.
  const [trending, setTrending] = useState<TokenSearchResult[]>(() =>
    remoteSearchEnabled ? getCachedTrendingTokens() ?? [] : []
  );
  const [isTrendingLoading, setIsTrendingLoading] = useState(
    remoteSearchEnabled && !getCachedTrendingTokens()
  );
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Warm trending on mount; focus re-runs it, which is free while fresh and
  // revalidates in the background once the cached list goes stale.
  useEffect(() => {
    if (!remoteSearchEnabled) return;

    let cancelled = false;
    setIsTrendingLoading(!getCachedTrendingTokens());
    void prefetchTrendingTokens()
      .then((result) => {
        if (cancelled) return;
        setTrending(result);
        setIsTrendingLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsTrendingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [remoteSearchEnabled]);

  const query = search.trim().toLowerCase();
  const hasQuery = query.length >= MIN_SEARCH_LENGTH;

  const localFiltered = tokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(query) ||
      (t.mint && t.mint.toLowerCase().includes(query))
  );

  // Debounced remote typeahead. Each keystroke aborts the in-flight request,
  // previous results stay painted while a newer one runs, and a response only
  // commits if its query is still the one in the input.
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!remoteSearchEnabled || !hasQuery) {
      setRemoteResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimerRef.current = setTimeout(() => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      void searchTokens(search, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          // Keep the picker's verified-only contract and drop owned tokens.
          const localMints = new Set(tokens.map((t) => t.mint).filter(Boolean));
          setRemoteResults(
            results.filter(
              (t) => t.mint && t.isVerified && !localMints.has(t.mint)
            )
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) setRemoteResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchAbortRef.current?.abort();
    };
  }, [search, hasQuery, remoteSearchEnabled, tokens]);

  // Trending only complements an empty query, and hides tokens already listed.
  // Mock positions carry no mint, so symbol is the fallback identity.
  const showTrending = remoteSearchEnabled && query.length === 0;
  const ownedKeys = new Set(
    tokens.flatMap((t) => [
      ...(t.mint ? [t.mint.toLowerCase()] : []),
      t.symbol.toLowerCase(),
    ])
  );
  const trendingRows = showTrending
    ? trending.filter(
        (t) =>
          !ownedKeys.has(t.mint.toLowerCase()) &&
          !ownedKeys.has(t.symbol.toLowerCase())
      )
    : [];

  // Owned matches stay first in their incoming order; remote hits are ranked
  // behind them so a token the user holds always wins the top suggestion.
  const sections: { label: string | null; tokens: SwapToken[] }[] = showTrending
    ? [
        ...(localFiltered.length > 0
          ? [{ label: "Your tokens", tokens: localFiltered }]
          : []),
        ...(trendingRows.length > 0
          ? [{ label: "Trending", tokens: trendingRows }]
          : []),
      ]
    : [
        {
          label: null,
          tokens: [
            ...localFiltered,
            ...rankSearchResults(query, remoteResults),
          ],
        },
      ];

  const rows = sections.flatMap((section) =>
    section.tokens.map((token) => ({ label: section.label, token }))
  );
  const activeToken = hasQuery ? rows[0]?.token : undefined;

  // Typeahead: Enter and Tab both commit the active (top-ranked) suggestion
  // without rewriting the query the user typed.
  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (!hasQuery || !activeToken) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    // Don't swallow keys an IME is still composing with, and keep Tab from
    // also moving focus after the commit.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();

    onSelect(activeToken);
    onBack();
  };

  const handleSearchFocus = () => {
    if (!remoteSearchEnabled) return;
    void prefetchTrendingTokens()
      .then((result) => setTrending(result))
      .catch(() => {});
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          padding: "8px",
        }}
      >
        <span style={{ height: "36px", width: "36px" }} />
        <span
          style={{
            color: "#000",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "18px",
            fontWeight: 600,
            lineHeight: "28px",
          }}
        >
          {title}
        </span>
        <button
          className="token-select-back"
          onClick={onBack}
          style={{
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.04)",
            border: "none",
            borderRadius: "9999px",
            color: "#3C3C43",
            cursor: "pointer",
            display: "flex",
            height: "36px",
            justifyContent: "center",
            transition: "all 0.2s ease",
            width: "36px",
          }}
          type="button"
        >
          <ArrowLeft size={24} />
        </button>
      </div>
      <SearchInput
        onChange={setSearch}
        onFocus={handleSearchFocus}
        onKeyDown={handleSearchKeyDown}
        value={search}
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "0 8px",
        }}
      >
        {rows.map((row, i) => (
          <Fragment key={row.token.mint ?? `${row.token.symbol}-${i}`}>
            {row.label && rows[i - 1]?.label !== row.label && (
              <SectionLabel>{row.label}</SectionLabel>
            )}
            <SelectableTokenRow
              isActive={row.token === activeToken}
              isSelected={
                isTokenSelected?.(row.token) ??
                (row.token.mint
                  ? row.token.mint === currentToken.mint
                  : row.token.symbol === currentToken.symbol)
              }
              onClick={() => {
                onSelect(row.token);
                onBack();
              }}
              token={row.token}
            />
          </Fragment>
        ))}
        {rows.length === 0 && (
          <div
            style={{
              padding: "32px 20px",
              textAlign: "center",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "14px",
              color: "rgba(60, 60, 67, 0.6)",
            }}
          >
            {isSearching
              ? "Searching..."
              : showTrending && isTrendingLoading
              ? "Loading..."
              : "No tokens found"}
          </div>
        )}
      </div>
    </div>
  );
}
