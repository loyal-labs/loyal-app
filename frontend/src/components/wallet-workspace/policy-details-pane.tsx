"use client";

import { Clock, GitBranch, Plus, Repeat } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { getTokenIconUrl } from "@/lib/token-icon";

import { type MockPolicy, PolicyGlyph } from "./policies-pane";
import { PolicyMoreMenu } from "./policy-more-menu";

export type Signer = {
  addressMasked: string;
  agentAvatar?: string;
  bg: string;
  id: string;
  name: string;
};

type ActivityRun = {
  at: string;
  avatarBg: string;
  id: string;
  state: "success" | "failed";
  subtitle: string;
  title: string;
};

const FALLBACK_ASSIGNED: Signer[] = [
  {
    addressMasked: "9xQe…3Kf8",
    agentAvatar: "/agents/Agent-01.svg",
    bg: "#ffd41b",
    id: "spottie",
    name: "Spottie",
  },
  {
    addressMasked: "H3C2…aL9m",
    agentAvatar: "/agents/Agent-05.svg",
    bg: "#32b67c",
    id: "buddy",
    name: "Buddy",
  },
];

const MOCK_HISTORY: ActivityRun[] = [
  {
    at: "Nov 26, 3:06 AM",
    avatarBg: "#d9d9d9",
    id: "run-1",
    state: "success",
    subtitle: "??",
    title: "??",
  },
  {
    at: "Nov 26, 3:06 AM",
    avatarBg: "#d9d9d9",
    id: "run-2",
    state: "failed",
    subtitle: "??",
    title: "??",
  },
];

export function PolicyDetailsPane({
  availableSigners,
  onEditRules,
  onOpenSigner,
  policy,
}: {
  availableSigners: Signer[];
  onEditRules: () => void;
  onOpenSigner?: (signer: Signer) => void;
  policy: MockPolicy;
}) {
  const [isActive, setIsActive] = useState(policy.status === "active");
  const [assignedSigners, setAssignedSigners] =
    useState<Signer[]>(FALLBACK_ASSIGNED);
  const [addOpen, setAddOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const totalRuns = 128;
  const successfulRuns = 32;

  useEffect(() => {
    if (!addOpen) return;
    const handlePointer = (event: PointerEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) {
        setAddOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddOpen(false);
    };
    window.addEventListener("pointerdown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [addOpen]);

  const addable = useMemo(
    () =>
      availableSigners.filter(
        (s) => !assignedSigners.some((a) => a.id === s.id)
      ),
    [availableSigners, assignedSigners]
  );

  const handleUnassign = (id: string) =>
    setAssignedSigners((prev) => prev.filter((s) => s.id !== id));
  const handleAdd = (signer: Signer) => {
    setAssignedSigners((prev) =>
      prev.some((s) => s.id === signer.id) ? prev : [...prev, signer]
    );
    setAddOpen(false);
  };

  return (
    <div className="policy-details-pane">
      <header className="policy-details-header">
        <span
          aria-hidden="true"
          className="policy-details-header-icon"
          style={{
            backgroundImage: `linear-gradient(135deg, ${policy.gradient[0]} 0%, ${policy.gradient[1]} 100%)`,
          }}
        >
          <span className="policy-details-header-glyph">
            <PolicyGlyph kind={policy.icon} />
          </span>
        </span>
        <p className="policy-details-header-title">{policy.title}</p>
        <button
          aria-label={`${isActive ? "Disable" : "Enable"} policy`}
          aria-pressed={isActive}
          className="policy-details-toggle"
          data-on={isActive}
          onClick={() => setIsActive((v) => !v)}
          type="button"
        >
          <span className="policy-details-toggle-knob" />
        </button>
        <PolicyMoreMenu variant="details" />
      </header>

      <section className="policy-details-rules">
        <RuleRow
          glyph={<Clock size={15} strokeWidth={2} />}
          isFirst
          label={policy.schedule}
        />
        <RuleRow
          glyph={<GitBranch size={15} strokeWidth={2} />}
          label={
            <>
              {"If "}
              <TokenInline symbol="SOL" />
              {" SOL price is greater than "}
              <span className="policy-details-rule-emph">$120.22</span>
            </>
          }
        />
        <RuleRow
          glyph={<Repeat size={15} strokeWidth={2} />}
          isLast
          label={
            <>
              {"Swap 300 "}
              <TokenInline symbol="USDC" />
              {" USDC to "}
              <TokenInline symbol="SOL" />
              {" SOL"}
            </>
          }
        />
      </section>

      <div className="policy-details-edit-row">
        <button
          className="policy-details-edit-button"
          onClick={onEditRules}
          type="button"
        >
          Edit rules
        </button>
      </div>

      {/* <section className="policy-details-section">
        <h3 className="policy-details-section-heading">Assigned signers</h3>
        {assignedSigners.map((signer) => (
          <SignerRow
            key={signer.id}
            onOpen={onOpenSigner ? () => onOpenSigner(signer) : undefined}
            onUnassign={() => handleUnassign(signer.id)}
            signer={signer}
          />
        ))}
        <div className="policy-details-add-wrap" ref={addMenuRef}>
          <AddSignerRow
            disabled={addable.length === 0}
            isOpen={addOpen}
            onToggle={() => setAddOpen((v) => !v)}
          />
          {addOpen && addable.length > 0 ? (
            <div className="policy-details-add-menu" role="menu">
              {addable.map((signer) => (
                <button
                  className="policy-details-add-option"
                  key={signer.id}
                  onClick={() => handleAdd(signer)}
                  role="menuitem"
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="policy-details-add-option-avatar"
                    style={{ background: signer.bg }}
                  >
                    {signer.agentAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" src={signer.agentAvatar} />
                    ) : (
                      <span className="policy-details-add-option-initial">
                        {signer.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="policy-details-add-option-text">
                    <span className="policy-details-add-option-name">
                      {signer.name}
                    </span>
                    <span className="policy-details-add-option-address">
                      {signer.addressMasked}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section> */}

      <section className="policy-details-section">
        <h3 className="policy-details-section-heading">Activity</h3>
        <div className="policy-details-stats">
          <StatCard label="Total runs" value={totalRuns} />
          <StatCard label="Successful" value={successfulRuns} />
        </div>
        {MOCK_HISTORY.map((run) => (
          <ActivityRow key={run.id} run={run} />
        ))}
      </section>

      <style jsx>{`
        .policy-details-pane {
          display: flex;
          width: 100%;
          height: 100%;
          min-height: 0;
          flex-direction: column;
          overflow: auto;
          background: #fff;
          padding: 8px 0;
          color: #000;
          scrollbar-width: none;
        }

        .policy-details-pane::-webkit-scrollbar {
          width: 0;
          height: 0;
        }

        .policy-details-header {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 8px 20px;
        }

        .policy-details-header-icon {
          position: relative;
          display: inline-flex;
          width: 36px;
          height: 36px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          color: #fff;
        }

        .policy-details-header-glyph {
          display: inline-flex;
          width: 18px;
          height: 18px;
          align-items: center;
          justify-content: center;
        }

        .policy-details-header-glyph :global(svg) {
          width: 18px;
          height: 18px;
        }

        .policy-details-header-title {
          flex: 1 1 auto;
          min-width: 0;
          margin: 0;
          overflow: hidden;
          color: #000;
          font-size: 20px;
          font-weight: 600;
          line-height: 24px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .policy-details-toggle {
          position: relative;
          display: inline-flex;
          width: 52px;
          height: 32px;
          flex: 0 0 auto;
          align-items: center;
          padding: 2px;
          border: 0;
          border-radius: 100px;
          background: rgba(120, 120, 128, 0.16);
          cursor: pointer;
          transition: background 0.18s ease;
        }

        .policy-details-toggle[data-on="true"] {
          background: #f9363c;
        }

        .policy-details-toggle-knob {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          background: #fff;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12);
          transform: translateX(0);
          transition: transform 0.18s ease;
        }

        .policy-details-toggle[data-on="true"] .policy-details-toggle-knob {
          transform: translateX(20px);
        }


        .policy-details-rules {
          display: flex;
          flex-direction: column;
          width: 100%;
          padding: 8px;
        }

        .policy-details-edit-row {
          display: flex;
          width: 100%;
          padding: 8px 20px 16px;
        }

        .policy-details-edit-button {
          flex: 1 1 auto;
          min-height: 44px;
          border: 0;
          border-radius: 9999px;
          background: rgba(249, 54, 60, 0.14);
          color: #000;
          cursor: pointer;
          font-family: inherit;
          font-size: 16px;
          font-weight: 400;
          line-height: 20px;
          padding: 10px 16px;
          transition: background 0.15s ease;
        }

        .policy-details-edit-button:hover {
          background: rgba(249, 54, 60, 0.2);
        }

        .policy-details-section {
          display: flex;
          flex-direction: column;
          gap: 0;
          width: 100%;
          padding: 8px;
        }

        .policy-details-section-heading {
          margin: 0;
          padding: 12px 12px 8px;
          color: #000;
          font-size: 16px;
          font-weight: 600;
          line-height: 20px;
          letter-spacing: -0.176px;
        }

        .policy-details-stats {
          display: flex;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
        }

        .policy-details-add-wrap {
          position: relative;
        }

        .policy-details-add-menu {
          position: absolute;
          left: 12px;
          right: 12px;
          top: calc(100% + 4px);
          z-index: 20;
          display: flex;
          max-height: 280px;
          flex-direction: column;
          gap: 0;
          padding: 4px;
          overflow-y: auto;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          box-shadow:
            0 0 2px rgba(0, 0, 0, 0.08),
            0 4px 16px rgba(0, 0, 0, 0.12);
        }

        .policy-details-add-option {
          display: flex;
          align-items: center;
          gap: 0;
          width: 100%;
          padding: 6px 8px;
          border: 0;
          border-radius: 12px;
          background: transparent;
          color: #000;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          transition: background 0.12s ease;
        }

        .policy-details-add-option:hover {
          background: rgba(0, 0, 0, 0.04);
        }

        .policy-details-add-option-avatar {
          display: inline-flex;
          width: 36px;
          height: 36px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          margin-right: 12px;
          border-radius: 9px;
          color: #000;
          font-size: 14px;
          font-weight: 600;
        }

        .policy-details-add-option-avatar img {
          width: 36px;
          height: 36px;
          object-fit: cover;
          display: block;
        }

        .policy-details-add-option-initial {
          display: inline-flex;
          width: 100%;
          height: 100%;
          align-items: center;
          justify-content: center;
          color: #fff;
        }

        .policy-details-add-option-text {
          display: flex;
          flex: 1 1 auto;
          min-width: 0;
          flex-direction: column;
          gap: 1px;
          padding: 4px 0;
        }

        .policy-details-add-option-name {
          color: #000;
          font-size: 14px;
          font-weight: 500;
          line-height: 18px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .policy-details-add-option-address {
          color: rgba(60, 60, 67, 0.6);
          font-size: 12px;
          font-weight: 400;
          line-height: 14px;
        }
      `}</style>
    </div>
  );
}

function RuleRow({
  glyph,
  isFirst,
  isLast,
  label,
}: {
  glyph: React.ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
  label: React.ReactNode;
}) {
  return (
    <>
      <div className="policy-details-rule-row">
        <span className="policy-details-rule-icon-col">
          {!isFirst ? (
            <span aria-hidden="true" className="policy-details-rule-line-top" />
          ) : null}
          {!isLast ? (
            <span
              aria-hidden="true"
              className="policy-details-rule-line-bottom"
            />
          ) : null}
          <span className="policy-details-rule-icon">{glyph}</span>
        </span>
        <span className="policy-details-rule-label">{label}</span>
      </div>
      <style jsx>{`
        .policy-details-rule-row {
          display: flex;
          align-items: center;
          gap: 0;
          width: 100%;
          padding-left: 18px;
          border-radius: 26px;
        }

        .policy-details-rule-icon-col {
          position: relative;
          display: inline-flex;
          width: 24px;
          height: 40px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          margin-right: 18px;
        }

        .policy-details-rule-line-top,
        .policy-details-rule-line-bottom {
          position: absolute;
          left: 50%;
          width: 1px;
          background: rgba(0, 0, 0, 0.12);
          transform: translateX(-50%);
        }

        .policy-details-rule-line-top {
          top: 0;
          height: 8px;
        }

        .policy-details-rule-line-bottom {
          bottom: 0;
          height: 8px;
        }

        .policy-details-rule-icon {
          position: relative;
          display: inline-flex;
          width: 24px;
          height: 24px;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          background: #b2b2b2;
          color: #fff;
        }

        .policy-details-rule-label {
          flex: 1 1 auto;
          min-width: 0;
          padding: 8px 0;
          color: #000;
          font-size: 16px;
          font-weight: 400;
          line-height: 20px;
        }

        :global(.policy-details-rule-emph) {
          color: #000;
        }
      `}</style>
    </>
  );
}

function TokenInline({ symbol }: { symbol: string }) {
  return (
    <>
      <span className="policy-details-token-inline">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" src={getTokenIconUrl(symbol)} />
      </span>
      <style jsx>{`
        .policy-details-token-inline {
          display: inline-flex;
          width: 16px;
          height: 16px;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 999px;
          background: #f5f5f5;
          vertical-align: middle;
          transform: translateY(-2px);
        }

        .policy-details-token-inline img {
          width: 16px;
          height: 16px;
          object-fit: cover;
          display: block;
        }
      `}</style>
    </>
  );
}

function SignerRow({
  onOpen,
  onUnassign,
  signer,
}: {
  onOpen?: () => void;
  onUnassign: () => void;
  signer: Signer;
}) {
  return (
    <>
      <div className="policy-details-signer-row">
        {onOpen ? (
          <a
            aria-label={`Open ${signer.name} in wallet`}
            className="policy-details-signer-link"
            href="/app"
            onClick={(event) => {
              event.preventDefault();
              onOpen();
            }}
          >
            <span
              aria-hidden="true"
              className="policy-details-signer-avatar"
              style={{ background: signer.bg }}
            >
              {signer.agentAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" src={signer.agentAvatar} />
              ) : (
                <span className="policy-details-signer-initial">
                  {signer.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
            <span className="policy-details-signer-text">
              <span className="policy-details-signer-name">{signer.name}</span>
              <span className="policy-details-signer-address">
                {signer.addressMasked}
              </span>
            </span>
          </a>
        ) : (
          <span className="policy-details-signer-link" data-static="true">
            <span
              aria-hidden="true"
              className="policy-details-signer-avatar"
              style={{ background: signer.bg }}
            >
              {signer.agentAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" src={signer.agentAvatar} />
              ) : (
                <span className="policy-details-signer-initial">
                  {signer.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
            <span className="policy-details-signer-text">
              <span className="policy-details-signer-name">{signer.name}</span>
              <span className="policy-details-signer-address">
                {signer.addressMasked}
              </span>
            </span>
          </span>
        )}
        <button
          className="policy-details-signer-action"
          onClick={onUnassign}
          type="button"
        >
          Unassign
        </button>
      </div>
      <style jsx>{`
        .policy-details-signer-row {
          display: flex;
          align-items: center;
          width: 100%;
          padding: 0 12px;
          border-radius: 16px;
        }

        .policy-details-signer-link {
          display: flex;
          flex: 1 1 auto;
          min-width: 0;
          align-items: center;
          gap: 0;
          color: inherit;
          text-decoration: none;
          border-radius: 12px;
          transition: background 0.12s ease;
          cursor: pointer;
        }

        .policy-details-signer-link[data-static="true"] {
          cursor: default;
        }

        .policy-details-signer-link:hover:not([data-static="true"])
          .policy-details-signer-name {
          text-decoration: underline;
        }

        .policy-details-signer-avatar {
          display: inline-flex;
          width: 48px;
          height: 48px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 12px;
          margin: 6px 12px 6px 0;
        }

        .policy-details-signer-avatar img {
          width: 48px;
          height: 48px;
          object-fit: cover;
          display: block;
        }

        .policy-details-signer-initial {
          display: inline-flex;
          width: 48px;
          height: 48px;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 18px;
          font-weight: 600;
        }

        .policy-details-signer-text {
          display: flex;
          flex: 1 1 auto;
          min-width: 0;
          flex-direction: column;
          gap: 2px;
          padding: 10px 0;
        }

        .policy-details-signer-name {
          color: #000;
          font-size: 16px;
          font-weight: 500;
          line-height: 20px;
          letter-spacing: -0.176px;
        }

        .policy-details-signer-address {
          color: rgba(60, 60, 67, 0.6);
          font-size: 13px;
          font-weight: 400;
          line-height: 16px;
        }

        .policy-details-signer-action {
          flex: 0 0 auto;
          border: 0;
          border-radius: 9999px;
          background: rgba(0, 0, 0, 0.04);
          color: #000;
          cursor: pointer;
          font-family: inherit;
          font-size: 14px;
          font-weight: 400;
          line-height: 20px;
          padding: 6px 16px;
          transition: background 0.15s ease;
        }

        .policy-details-signer-action:hover {
          background: rgba(0, 0, 0, 0.08);
        }
      `}</style>
    </>
  );
}

function AddSignerRow({
  disabled,
  isOpen,
  onToggle,
}: {
  disabled: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="policy-details-add-signer"
        data-disabled={disabled}
        onClick={disabled ? undefined : onToggle}
        type="button"
      >
        <span aria-hidden="true" className="policy-details-add-signer-avatar">
          <Plus size={28} strokeWidth={2} />
        </span>
        <span className="policy-details-add-signer-label">
          {disabled ? "No signers available" : "Add signer"}
        </span>
      </button>
      <style jsx>{`
        .policy-details-add-signer {
          display: flex;
          align-items: center;
          width: 100%;
          padding: 0 12px;
          border: 0;
          border-radius: 16px;
          background: transparent;
          color: #000;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
        }

        .policy-details-add-signer:hover:not([data-disabled="true"]) {
          background: rgba(0, 0, 0, 0.02);
        }

        .policy-details-add-signer[data-disabled="true"] {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .policy-details-add-signer-avatar {
          display: inline-flex;
          width: 48px;
          height: 48px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          margin: 6px 12px 6px 0;
          border-radius: 12px;
          background: rgba(249, 54, 60, 0.14);
          color: #000;
        }

        .policy-details-add-signer-label {
          flex: 1 1 auto;
          min-width: 0;
          padding: 10px 0;
          color: #000;
          font-size: 16px;
          font-weight: 500;
          line-height: 20px;
          letter-spacing: -0.176px;
        }
      `}</style>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <>
      <div className="policy-details-stat-card">
        <p className="policy-details-stat-label">{label}</p>
        <p className="policy-details-stat-value">{value}</p>
      </div>
      <style jsx>{`
        .policy-details-stat-card {
          display: flex;
          flex: 1 1 0;
          min-width: 0;
          flex-direction: column;
          align-items: flex-start;
          gap: 12px;
          padding: 12px 16px 16px;
          border-radius: 16px;
          background: #f5f5f5;
        }

        .policy-details-stat-label {
          margin: 0;
          overflow: hidden;
          color: rgba(0, 0, 0, 0.6);
          font-size: 16px;
          font-weight: 400;
          line-height: 24px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .policy-details-stat-value {
          margin: 0;
          color: #000;
          font-size: 34px;
          font-weight: 600;
          line-height: 1;
          letter-spacing: -0.43px;
        }
      `}</style>
    </>
  );
}

function ActivityRow({ run }: { run: ActivityRun }) {
  return (
    <>
      <div className="policy-details-activity-row">
        <span
          aria-hidden="true"
          className="policy-details-activity-avatar"
          style={{ background: run.avatarBg }}
        />
        <span className="policy-details-activity-text">
          <span className="policy-details-activity-title">{run.title}</span>
          <span className="policy-details-activity-subtitle">
            {run.subtitle}
          </span>
        </span>
        <span className="policy-details-activity-meta">
          <span className="policy-details-activity-state">
            {run.state === "success" ? "Success" : "Failed"}
          </span>
          <span className="policy-details-activity-time">{run.at}</span>
        </span>
      </div>
      <style jsx>{`
        .policy-details-activity-row {
          display: flex;
          align-items: center;
          width: 100%;
          padding: 0 12px;
          border-radius: 16px;
        }

        .policy-details-activity-avatar {
          display: inline-flex;
          width: 48px;
          height: 48px;
          flex: 0 0 auto;
          margin: 6px 12px 6px 0;
          border-radius: 9999px;
        }

        .policy-details-activity-text {
          display: flex;
          flex: 1 1 auto;
          min-width: 0;
          flex-direction: column;
          gap: 2px;
          padding: 10px 0;
        }

        .policy-details-activity-title {
          color: #000;
          font-size: 16px;
          font-weight: 500;
          line-height: 20px;
          letter-spacing: -0.176px;
        }

        .policy-details-activity-subtitle {
          color: rgba(60, 60, 67, 0.6);
          font-size: 13px;
          font-weight: 400;
          line-height: 16px;
        }

        .policy-details-activity-meta {
          display: inline-flex;
          flex: 0 0 auto;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
          padding: 10px 0 10px 12px;
        }

        .policy-details-activity-state {
          color: #000;
          font-size: 16px;
          font-weight: 400;
          line-height: 20px;
        }

        .policy-details-activity-time {
          color: rgba(60, 60, 67, 0.6);
          font-size: 13px;
          font-weight: 400;
          line-height: 16px;
        }
      `}</style>
    </>
  );
}

