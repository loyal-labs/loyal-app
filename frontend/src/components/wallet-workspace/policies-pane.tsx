"use client";

import { ArrowRight, CalendarDays, Plus, Search } from "lucide-react";

import { getTokenIconUrl } from "@/lib/token-icon";

type MockPolicy = {
  agents: string[];
  id: string;
  fromAsset: string;
  schedule: string;
  summary: string;
  title: string;
  toAsset: string;
};

const mockPolicies: MockPolicy[] = [
  {
    agents: [
      "/agents/Agent-01.svg",
      "/agents/Agent-05.svg",
      "/agents/Agent-10.svg",
    ],
    fromAsset: "USDC",
    id: "autoswap-primary",
    schedule: "Everyday at 18:00",
    summary: "If SOL price < $120.22\nSwap 300 USDC → SOL",
    title: "Autoswap",
    toAsset: "SOL",
  },
  {
    agents: ["/agents/Agent-05.svg", "/agents/Agent-10.svg"],
    fromAsset: "USDC",
    id: "autoswap-secondary",
    schedule: "Everyday at 18:00",
    summary: "If SOL price < $120.22\nSwap 300 USDC → SOL",
    title: "Autoswap",
    toAsset: "SOL",
  },
  {
    agents: [
      "/agents/Agent-15.svg",
      "/agents/Agent-01.svg",
      "/agents/Agent-06.svg",
    ],
    fromAsset: "USDC",
    id: "autoswap-tertiary",
    schedule: "Everyday at 18:00",
    summary: "If SOL price < $120.22\nSwap 300 USDC → SOL",
    title: "Autoswap",
    toAsset: "SOL",
  },
  {
    agents: ["/agents/Agent-15.svg", "/agents/Agent-10.svg"],
    fromAsset: "USDC",
    id: "autoswap-quaternary",
    schedule: "Everyday at 18:00",
    summary: "If SOL price < $120.22\nSwap 300 USDC → SOL",
    title: "Autoswap",
    toAsset: "SOL",
  },
];

export function PoliciesPane({
  onNewPolicy,
  onOpenAgent,
  onSelectPolicy,
  selectedPolicyId,
}: {
  onNewPolicy?: () => void;
  onOpenAgent: () => void;
  onSelectPolicy: (policyId: string) => void;
  selectedPolicyId: string;
}) {
  return (
    <div className="policies-pane">
      <header className="policies-pane-header">
        <h1>Policies</h1>
        <div className="policies-pane-header-actions">
          <button
            aria-label="Search policies"
            className="policies-pane-icon-button"
            type="button"
          >
            <Search size={18} strokeWidth={1.8} />
          </button>
          <button
            className="policies-pane-new-button"
            onClick={onNewPolicy}
            type="button"
          >
            <Plus size={20} strokeWidth={1.9} />
            <span>New Policy</span>
          </button>
        </div>
      </header>

      <div className="policies-pane-filters" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="policies-pane-list" aria-label="Policies">
        {mockPolicies.map((policy) => (
          <PolicyCard
            isSelected={policy.id === selectedPolicyId}
            key={policy.id}
            onOpenAgent={onOpenAgent}
            onSelect={() => onSelectPolicy(policy.id)}
            policy={policy}
          />
        ))}
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
          padding: 8px 12px 8px 20px;
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

        .policies-pane-header-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          flex: 0 0 auto;
        }

        .policies-pane-icon-button,
        .policies-pane-new-button {
          border: 0;
          cursor: pointer;
          font-family: inherit;
        }

        .policies-pane-icon-button {
          display: inline-flex;
          width: 36px;
          height: 36px;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: #f5f5f5;
          color: rgba(60, 60, 67, 0.45);
        }

        .policies-pane-new-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-height: 36px;
          border-radius: 999px;
          background: #000;
          color: #fff;
          padding: 6px 16px 6px 6px;
          font-size: 14px;
          font-weight: 400;
          line-height: 20px;
          white-space: nowrap;
        }

        .policies-pane-icon-button:hover {
          background: #eeeeee;
        }

        .policies-pane-new-button:hover {
          background: #1d1d1f;
        }

        .policies-pane-filters {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          padding: 20px 12px 14px 8px;
        }

        .policies-pane-filters span {
          width: 102px;
          height: 36px;
          flex: 0 0 auto;
          border-radius: 74px;
          background: #f5f5f5;
        }

        .policies-pane-list {
          display: flex;
          min-height: 0;
          width: 100%;
          flex: 1;
          flex-direction: column;
          gap: 8px;
          overflow: auto;
          padding: 0 8px 112px;
        }

        .policies-pane-list::-webkit-scrollbar {
          width: 0;
          height: 0;
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
  const summaryLines = policy.summary.split("\n");

  return (
    <>
      <div
        className="policy-card"
        data-selected={isSelected}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        onClick={onSelect}
        role="button"
        tabIndex={0}
      >
        <div className="policy-card-assets" aria-hidden="true">
          <TokenIcon symbol={policy.fromAsset} />
          <ArrowRight
            className="policy-card-arrow"
            size={20}
            strokeWidth={1.8}
          />
          <TokenIcon symbol={policy.toAsset} />
        </div>

        <div className="policy-card-copy">
          <strong>{policy.title}</strong>
          <span>{summaryLines[0]}</span>
          <span>{summaryLines[1]}</span>
          <span className="policy-card-schedule">
            <CalendarDays size={12} strokeWidth={1.7} />
            {policy.schedule}
          </span>
        </div>

        <div className="policy-card-agents" aria-label="Assigned agents">
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
        </div>
      </div>
      <style jsx>{`
        .policy-card {
          position: relative;
          display: flex;
          width: 100%;
          min-height: 150px;
          flex: 0 0 auto;
          flex-direction: column;
          align-items: flex-start;
          overflow: hidden;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 16px;
          background: #fff;
          color: #000;
          cursor: pointer;
          padding: 12px;
          text-align: left;
          transition: background 0.16s ease, border-color 0.16s ease,
            transform 0.16s ease;
        }

        .policy-card[data-selected="true"] {
          border-color: transparent;
          background: #f5f5f5;
        }

        .policy-card:hover {
          background: #f7f7f7;
        }

        .policy-card-assets {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 32px;
        }

        .policy-card-arrow {
          color: rgba(60, 60, 67, 0.45);
        }

        .policy-card-copy {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding-top: 27px;
          padding-right: 104px;
        }

        .policy-card-copy strong {
          color: #000;
          font-size: 16px;
          font-weight: 600;
          line-height: 20px;
          white-space: nowrap;
        }

        .policy-card-copy span {
          color: rgba(60, 60, 67, 0.6);
          font-size: 14px;
          font-weight: 400;
          line-height: 20px;
          white-space: nowrap;
        }

        .policy-card-schedule {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }

        .policy-card-agents {
          position: absolute;
          right: 11px;
          bottom: 11px;
          display: flex;
          align-items: flex-start;
          isolation: isolate;
          padding-right: 8px;
        }

        .policy-card-agent {
          display: inline-flex;
          width: 32px;
          height: 32px;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          margin-right: -8px;
          border: 1px solid #fff;
          border-radius: 8px;
          background: #f5f5f5;
        }

        .policy-card[data-selected="true"] .policy-card-agent {
          border-color: #f5f5f5;
        }

        .policy-card-agent img {
          width: 32px;
          height: 32px;
          object-fit: cover;
          display: block;
        }
      `}</style>
    </>
  );
}

function TokenIcon({ symbol }: { symbol: string }) {
  return (
    <>
      <span className="policy-token-icon">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" src={getTokenIconUrl(symbol)} />
      </span>
      <style jsx>{`
        .policy-token-icon {
          display: inline-flex;
          width: 32px;
          height: 32px;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 999px;
          background: #f5f5f5;
        }

        .policy-token-icon img {
          width: 32px;
          height: 32px;
          object-fit: cover;
          display: block;
        }
      `}</style>
    </>
  );
}
