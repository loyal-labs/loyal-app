"use client";

import {
  ArrowUpDown,
  ChevronDown,
  DollarSign,
  File,
  Layers,
  LayoutTemplate,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { PolicyMoreMenu } from "./policy-more-menu";

export type PolicyIconKind = "layers" | "swap" | "dollar";
export type PolicyStatus = "active" | "inactive" | "draft";
export type PolicyRunState = "success" | "failed";
type SortKey = "created" | "lastRun" | "name";
type FilterKey = "all" | "active" | "inactive" | "drafts" | "label";

export type MockPolicy = {
  agents: string[];
  createdAt: number;
  gradient: [string, string];
  icon: PolicyIconKind;
  id: string;
  lastRun: { at: number; state: PolicyRunState } | null;
  schedule: string;
  status: PolicyStatus;
  title: string;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.now();

export const mockPolicies: MockPolicy[] = [
  {
    agents: ["/agents/Agent-01.svg"],
    createdAt: NOW - 2 * DAY,
    gradient: ["#C1CAD6", "#878F99"],
    icon: "layers",
    id: "policy-1",
    lastRun: { at: NOW - 48 * MIN, state: "success" },
    schedule: "Every hour",
    status: "active",
    title: "New Policy #1",
  },
  {
    agents: ["/agents/Agent-05.svg", "/agents/Agent-10.svg"],
    createdAt: NOW - 14 * DAY,
    gradient: ["#D3A6FF", "#8F3FE0"],
    icon: "swap",
    id: "autoswap-primary",
    lastRun: { at: NOW - 7 * DAY, state: "failed" },
    schedule: "Every day at 18:00",
    status: "active",
    title: "Autoswap SOL → USDC",
  },
  {
    agents: ["/agents/Agent-06.svg"],
    createdAt: NOW - 5 * DAY,
    gradient: ["#FFBF80", "#E66B2E"],
    icon: "layers",
    id: "policy-2",
    lastRun: { at: NOW - 48 * MIN, state: "success" },
    schedule: "Every 2 days at 15:00",
    status: "active",
    title: "New Policy #2",
  },
  {
    agents: ["/agents/Agent-15.svg", "/agents/Agent-01.svg"],
    createdAt: NOW - 9 * DAY,
    gradient: ["#7DF1FA", "#2BB4D6"],
    icon: "layers",
    id: "idle-usdc",
    lastRun: { at: NOW - 48 * MIN, state: "success" },
    schedule: "Every day at 18:00",
    status: "active",
    title: "Put idle USDC to work",
  },
  {
    agents: ["/agents/Agent-10.svg"],
    createdAt: NOW - 30 * DAY,
    gradient: ["#66CCFF", "#3F8AE0"],
    icon: "dollar",
    id: "sol-dca",
    lastRun: { at: NOW - 48 * MIN, state: "success" },
    schedule: "Every hour",
    status: "active",
    title: "SOL DCA",
  },
  {
    agents: ["/agents/Agent-08.svg", "/agents/Agent-12.svg"],
    createdAt: NOW - 1 * DAY,
    gradient: ["#FF7583", "#E52E40"],
    icon: "swap",
    id: "policy-3",
    lastRun: { at: NOW - 7 * DAY, state: "failed" },
    schedule: "Every day at 18:00",
    status: "inactive",
    title: "New Policy #3",
  },
  {
    agents: ["/agents/Agent-15.svg"],
    createdAt: NOW - 4 * DAY,
    gradient: ["#D3A6FF", "#8F3FE0"],
    icon: "layers",
    id: "policy-4",
    lastRun: { at: NOW - 48 * MIN, state: "success" },
    schedule: "Every hour",
    status: "draft",
    title: "New Policy #4",
  },
  {
    agents: ["/agents/Agent-03.svg", "/agents/Agent-07.svg"],
    createdAt: NOW - 21 * DAY,
    gradient: ["#C1CAD6", "#878F99"],
    icon: "layers",
    id: "policy-5",
    lastRun: { at: NOW - 48 * MIN, state: "success" },
    schedule: "Everyday at 18:00",
    status: "active",
    title: "New Policy #5",
  },
];

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "drafts", label: "Drafts" },
  { key: "label", label: "Label" },
];

const SORT_ORDER: SortKey[] = ["created", "lastRun", "name"];
const SORT_LABEL: Record<SortKey, string> = {
  created: "Sorted by date created",
  lastRun: "Sorted by last run",
  name: "Sorted by name",
};

const SORT_STORAGE_KEY = "policies-pane:sort";

function readStoredSort(): SortKey {
  if (typeof window === "undefined") return "created";
  const raw = window.localStorage.getItem(SORT_STORAGE_KEY);
  return SORT_ORDER.includes(raw as SortKey) ? (raw as SortKey) : "created";
}

function formatRelative(ms: number): string {
  const diff = Math.max(0, NOW - ms);
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MIN))}m ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`;
  return `${Math.round(diff / DAY)}d ago`;
}

function matchesFilter(policy: MockPolicy, filter: FilterKey): boolean {
  switch (filter) {
    case "active":
      return policy.status === "active";
    case "inactive":
      return policy.status === "inactive";
    case "drafts":
      return policy.status === "draft";
    default:
      return true;
  }
}

function comparePolicies(a: MockPolicy, b: MockPolicy, sort: SortKey): number {
  if (sort === "name") return a.title.localeCompare(b.title);
  if (sort === "lastRun") {
    const aAt = a.lastRun?.at ?? 0;
    const bAt = b.lastRun?.at ?? 0;
    return bAt - aAt;
  }
  return b.createdAt - a.createdAt;
}

export type NewPolicyMode = "blank" | "template";

export function PoliciesPane({
  onNewPolicy,
  onOpenAgent,
  onSelectPolicy,
  selectedPolicyId,
}: {
  onNewPolicy?: (mode: NewPolicyMode) => void;
  onOpenAgent: () => void;
  onSelectPolicy: (policyId: string) => void;
  selectedPolicyId: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("created");
  const [sortHintOpen, setSortHintOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const sortHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMounted = useRef(false);

  useEffect(() => {
    setSort(readStoredSort());
    hasMounted.current = true;
  }, []);

  useEffect(() => {
    if (!hasMounted.current) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SORT_STORAGE_KEY, sort);
  }, [sort]);

  useEffect(
    () => () => {
      if (sortHintTimer.current) clearTimeout(sortHintTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!createMenuOpen) return;
    const handlePointer = (event: PointerEvent) => {
      if (!createMenuRef.current?.contains(event.target as Node)) {
        setCreateMenuOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCreateMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [createMenuOpen]);

  const visiblePolicies = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return mockPolicies
      .filter((policy) => matchesFilter(policy, filter))
      .filter((policy) =>
        trimmed.length === 0
          ? true
          : policy.title.toLowerCase().includes(trimmed)
      )
      .sort((a, b) => comparePolicies(a, b, sort));
  }, [filter, query, sort]);

  const handleCycleSort = () => {
    const idx = SORT_ORDER.indexOf(sort);
    const next = SORT_ORDER[(idx + 1) % SORT_ORDER.length];
    setSort(next);
    setSortHintOpen(true);
    if (sortHintTimer.current) clearTimeout(sortHintTimer.current);
    sortHintTimer.current = setTimeout(() => setSortHintOpen(false), 1600);
  };

  const handleSelectCreateMode = (mode: NewPolicyMode) => {
    setCreateMenuOpen(false);
    onNewPolicy?.(mode);
  };

  return (
    <div className="policies-pane">
      <header className="policies-pane-header">
        <h1>Policies</h1>
        <div className="policies-pane-create-wrap" ref={createMenuRef}>
          <button
            aria-expanded={createMenuOpen}
            aria-haspopup="menu"
            className="policies-pane-create-button"
            data-active={createMenuOpen}
            onClick={() => setCreateMenuOpen((v) => !v)}
            type="button"
          >
            <Plus size={20} strokeWidth={1.9} />
            <span>Create</span>
            <ChevronDown size={16} strokeWidth={2} />
          </button>
          {createMenuOpen ? (
            <div className="policies-pane-create-menu" role="menu">
              <button
                className="policies-pane-create-item"
                onClick={() => handleSelectCreateMode("blank")}
                role="menuitem"
                type="button"
              >
                <span aria-hidden="true" className="policies-pane-create-item-icon">
                  <File size={16} strokeWidth={1.8} />
                </span>
                <span>Blank</span>
              </button>
              <button
                className="policies-pane-create-item"
                onClick={() => handleSelectCreateMode("template")}
                role="menuitem"
                type="button"
              >
                <span aria-hidden="true" className="policies-pane-create-item-icon">
                  <LayoutTemplate size={16} strokeWidth={1.8} />
                </span>
                <span>From a template</span>
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="policies-pane-search-row">
        <label className="policies-pane-search-input">
          <Search size={20} strokeWidth={1.8} />
          <input
            aria-label="Search policies"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            type="search"
            value={query}
          />
        </label>
        <TooltipProvider delayDuration={0}>
          <Tooltip onOpenChange={setSortHintOpen} open={sortHintOpen}>
            <TooltipTrigger asChild>
              <button
                aria-label={`Change sort order (${SORT_LABEL[sort]})`}
                className="policies-pane-sort-button"
                onClick={handleCycleSort}
                type="button"
              >
                <ArrowUpDown size={24} strokeWidth={2} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {SORT_LABEL[sort]}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="policies-pane-tabs" role="tablist">
        {FILTER_TABS.map((tab) => {
          const isActive = tab.key === filter;
          return (
            <button
              aria-selected={isActive}
              className="policies-pane-tab"
              data-active={isActive}
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              role="tab"
              type="button"
            >
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="policies-pane-list" aria-label="Policies">
        {visiblePolicies.map((policy) => (
          <PolicyCard
            isSelected={policy.id === selectedPolicyId}
            key={policy.id}
            onOpenAgent={onOpenAgent}
            onSelect={() => onSelectPolicy(policy.id)}
            policy={policy}
          />
        ))}
        {visiblePolicies.length === 0 ? (
          <div className="policies-pane-empty">No policies match.</div>
        ) : null}
      </div>

      <style jsx>{`
        .policies-pane {
          display: flex;
          width: 100%;
          height: 100%;
          min-height: 0;
          flex-direction: column;
          background: #fff;
          padding: 8px 0;
          color: #000;
        }

        .policies-pane-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
          padding: 8px 20px;
        }

        .policies-pane-header h1 {
          min-width: 0;
          margin: 0;
          overflow: hidden;
          color: #000;
          font-size: 24px;
          font-weight: 600;
          line-height: 28px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .policies-pane-create-wrap {
          position: relative;
          display: inline-flex;
          flex: 0 0 auto;
        }

        .policies-pane-create-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-height: 36px;
          border: 0;
          border-radius: 999px;
          background: #000;
          color: #fff;
          padding: 6px 12px 6px 6px;
          font-family: inherit;
          font-size: 14px;
          font-weight: 400;
          line-height: 20px;
          white-space: nowrap;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .policies-pane-create-button :global(svg):last-child {
          margin-left: -2px;
          opacity: 0.8;
        }

        .policies-pane-create-button:hover,
        .policies-pane-create-button[data-active="true"] {
          background: #1d1d1f;
        }

        .policies-pane-create-menu {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          z-index: 30;
          display: flex;
          width: 180px;
          flex-direction: column;
          padding: 4px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          box-shadow:
            0 0 2px rgba(0, 0, 0, 0.08),
            0 4px 16px rgba(0, 0, 0, 0.08);
        }

        .policies-pane-create-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          border: 0;
          border-radius: 12px;
          background: transparent;
          color: #000;
          cursor: pointer;
          font-family: inherit;
          font-size: 14px;
          font-weight: 400;
          line-height: 20px;
          text-align: left;
          transition: background 0.12s ease;
        }

        .policies-pane-create-item:hover {
          background: rgba(0, 0, 0, 0.04);
        }

        .policies-pane-create-item-icon {
          display: inline-flex;
          width: 20px;
          height: 20px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          color: rgba(60, 60, 67, 0.7);
        }

        .policies-pane-search-row {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px;
        }

        .policies-pane-search-input {
          display: flex;
          flex: 1 1 auto;
          min-width: 0;
          align-items: center;
          gap: 4px;
          padding: 0 12px;
          border-radius: 47px;
          background: rgba(0, 0, 0, 0.04);
          color: rgba(60, 60, 67, 0.6);
          cursor: text;
        }

        .policies-pane-search-input :global(svg) {
          flex: 0 0 auto;
          opacity: 0.6;
        }

        .policies-pane-search-input input {
          flex: 1 1 auto;
          min-width: 0;
          padding: 10px 0;
          border: 0;
          background: transparent;
          color: #000;
          font-family: inherit;
          font-size: 16px;
          line-height: 20px;
          outline: none;
        }

        .policies-pane-search-input input::placeholder {
          color: rgba(60, 60, 67, 0.6);
        }

        .policies-pane-search-input input::-webkit-search-cancel-button {
          appearance: none;
        }

        .policies-pane-sort-button {
          display: inline-flex;
          width: 44px;
          height: 44px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: #898a8e;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .policies-pane-sort-button :global(svg) {
          color: #898a8e;
        }

        .policies-pane-sort-button:hover {
          background: rgba(0, 0, 0, 0.04);
        }

        .policies-pane-tabs {
          display: flex;
          align-items: center;
          width: 100%;
          padding: 0 8px;
          overflow-x: auto;
          scrollbar-width: none;
        }

        .policies-pane-tabs::-webkit-scrollbar {
          display: none;
        }

        .policies-pane-tab {
          position: relative;
          display: inline-flex;
          height: 44px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          padding: 12px 16px;
          border: 0;
          background: transparent;
          color: rgba(60, 60, 67, 0.6);
          font-family: inherit;
          font-size: 16px;
          font-weight: 500;
          line-height: 20px;
          letter-spacing: -0.176px;
          cursor: pointer;
          transition: color 0.15s ease;
        }

        .policies-pane-tab:hover {
          color: #000;
        }

        .policies-pane-tab[data-active="true"] {
          color: #000;
        }

        .policies-pane-tab[data-active="true"]::after {
          content: "";
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: 0;
          height: 3px;
          border-radius: 4px 4px 1px 1px;
          background: #f9363c;
        }

        .policies-pane-list {
          display: flex;
          min-height: 0;
          width: 100%;
          flex: 1;
          flex-direction: column;
          gap: 0;
          overflow: auto;
          padding: 8px 8px 112px;
          scrollbar-width: none;
        }

        .policies-pane-list::-webkit-scrollbar {
          width: 0;
          height: 0;
        }

        .policies-pane-empty {
          padding: 24px 12px;
          color: rgba(60, 60, 67, 0.6);
          font-size: 14px;
          line-height: 20px;
          text-align: center;
        }
      `}</style>
    </div>
  );
}

function PolicyCard({
  isSelected,
  onOpenAgent,
  onSelect,
  policy,
}: {
  isSelected: boolean;
  onOpenAgent: () => void;
  onSelect: () => void;
  policy: MockPolicy;
}) {
  const lastRun = policy.lastRun;
  const lastRunColor =
    lastRun?.state === "failed" ? "#f9363c" : "#34c759";
  const lastRunLabel = lastRun?.state === "failed" ? "Failed" : "Success";

  return (
    <>
      <div
        className="policy-card"
        data-selected={isSelected}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="policy-card-icon-wrap" aria-hidden="true">
          <span
            className="policy-card-icon"
            style={{
              backgroundImage: `linear-gradient(135deg, ${policy.gradient[0]} 0%, ${policy.gradient[1]} 100%)`,
            }}
          >
            <PolicyGlyph kind={policy.icon} />
          </span>
        </div>

        <div className="policy-card-body">
          <div className="policy-card-row policy-card-row-title">
            <p className="policy-card-title">{policy.title}</p>
            <span className="policy-card-more-slot">
              <PolicyMoreMenu variant="card" />
            </span>
          </div>
          <div className="policy-card-row">
            <p className="policy-card-subtitle">{policy.schedule}</p>
          </div>
          <div className="policy-card-row policy-card-row-extra">
            <p className="policy-card-extra-leading">Extra subtitle</p>
            <div className="policy-card-extra-trailing">
              <p className="policy-card-status">
                {lastRun ? (
                  <>
                    <span style={{ color: lastRunColor }}>{lastRunLabel}</span>
                    {" "}
                    <span>{formatRelative(lastRun.at)}</span>
                  </>
                ) : (
                  <span style={{ color: "rgba(60, 60, 67, 0.6)" }}>
                    Not yet run
                  </span>
                )}
              </p>
              <span className="policy-card-agents" aria-label="Assigned agents">
                {policy.agents.map((agent, index) => (
                  <a
                    aria-label={`Open agent ${index + 1} in wallet`}
                    className="policy-card-agent"
                    href="/app"
                    key={`${policy.id}-${agent}-${index}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenAgent();
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" src={agent} />
                  </a>
                ))}
              </span>
            </div>
          </div>
        </div>
      </div>
      <style jsx>{`
        .policy-card {
          position: relative;
          display: flex;
          width: 100%;
          align-items: stretch;
          gap: 0;
          padding: 0 12px;
          border: 0;
          border-radius: 16px;
          background: transparent;
          color: #000;
          cursor: pointer;
          text-align: left;
          transition: background 0.16s ease;
        }

        .policy-card[data-selected="true"] {
          background: rgba(0, 0, 0, 0.04);
        }

        .policy-card:hover:not([data-selected="true"]) {
          background: rgba(0, 0, 0, 0.02);
        }

        .policy-card-icon-wrap {
          display: flex;
          align-items: center;
          padding: 10px 12px 10px 0;
          flex: 0 0 auto;
        }

        .policy-card-icon {
          position: relative;
          display: inline-flex;
          width: 56px;
          height: 56px;
          align-items: center;
          justify-content: center;
          border-radius: 1000px;
          color: #fff;
        }

        .policy-card-body {
          display: flex;
          flex: 1 1 auto;
          min-width: 0;
          flex-direction: column;
          gap: 2px;
          padding: 10px 0;
        }

        .policy-card-row {
          display: flex;
          width: 100%;
          align-items: center;
          gap: 12px;
        }

        .policy-card-row-title {
          align-items: center;
        }

        .policy-card-title {
          flex: 1 1 auto;
          min-width: 0;
          margin: 0;
          overflow: hidden;
          color: #000;
          font-size: 16px;
          font-weight: 500;
          line-height: 20px;
          letter-spacing: -0.176px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .policy-card-more-slot {
          display: inline-flex;
          flex: 0 0 auto;
          align-items: center;
          opacity: 0;
          transition: opacity 0.15s ease;
        }

        .policy-card:hover .policy-card-more-slot,
        .policy-card[data-selected="true"] .policy-card-more-slot,
        .policy-card-more-slot:focus-within {
          opacity: 1;
        }

        .policy-card-subtitle {
          flex: 1 1 auto;
          min-width: 0;
          margin: 0;
          overflow: hidden;
          color: rgba(60, 60, 67, 0.6);
          font-size: 13px;
          font-weight: 400;
          line-height: 16px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .policy-card-row-extra {
          gap: 0;
        }

        .policy-card-extra-leading {
          flex: 1 1 0;
          min-width: 0;
          margin: 0;
          overflow: hidden;
          color: rgba(60, 60, 67, 0.6);
          font-size: 13px;
          font-weight: 400;
          line-height: 16px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .policy-card-extra-trailing {
          display: inline-flex;
          flex: 0 0 auto;
          align-items: center;
          gap: 4px;
          padding-left: 12px;
        }

        .policy-card-status {
          margin: 0;
          color: rgba(60, 60, 67, 0.6);
          font-size: 13px;
          font-weight: 400;
          line-height: 16px;
          white-space: nowrap;
        }

        .policy-card-agents {
          display: inline-flex;
          align-items: center;
        }

        .policy-card-agent {
          display: inline-flex;
          width: 16px;
          height: 16px;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          margin-left: -4px;
          border: 1px solid #fff;
          border-radius: 4px;
          background: #f5f5f5;
        }

        .policy-card-agent:first-child {
          margin-left: 0;
        }

        .policy-card[data-selected="true"] .policy-card-agent {
          border-color: rgba(245, 245, 246, 0);
        }

        .policy-card-agent img {
          width: 16px;
          height: 16px;
          object-fit: cover;
          display: block;
        }
      `}</style>
    </>
  );
}

export function PolicyGlyph({
  kind,
  size = 28,
}: {
  kind: PolicyIconKind;
  size?: number;
}) {
  const stroke = 1.9;
  if (kind === "swap") return <RefreshCw size={size} strokeWidth={stroke} />;
  if (kind === "dollar")
    return <DollarSign size={size} strokeWidth={stroke + 0.2} />;
  return <Layers size={size} strokeWidth={stroke} />;
}
