"use client";

import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  DollarSign,
  Plus,
  RefreshCcw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { getTokenIconUrl } from "@/lib/token-icon";

type EditableChipKey =
  | "action-buy-amount"
  | "action-buy-from"
  | "action-buy-target"
  | "action-send-amount"
  | "action-send-from"
  | "action-send-target"
  | "action-swap-amount"
  | "action-swap-from"
  | "action-swap-target"
  | "condition-a-comparator"
  | "condition-a-metric"
  | "condition-a-value"
  | "condition-b-comparator"
  | "condition-b-metric"
  | "condition-b-value"
  | "group-mode"
  | "top-comparator"
  | "top-metric"
  | "top-value";

type WorkflowChip =
  | {
      avatarUrl?: string;
      kind: "person";
      label: string;
    }
  | {
      kind: "text";
      label: string;
    }
  | {
      kind: "token";
      label: string;
      symbol: string;
    };

type EditableChip = WorkflowChip & {
  field: EditableChipKey;
};

type BuilderValues = Record<EditableChipKey, WorkflowChip>;

const tokenOptions: WorkflowChip[] = [
  { kind: "token", label: "USDC", symbol: "USDC" },
  { kind: "token", label: "SOL", symbol: "SOL" },
];

const editableOptions: Record<EditableChipKey, WorkflowChip[]> = {
  "action-buy-amount": [
    { kind: "text", label: "500" },
    { kind: "text", label: "1,000" },
    { kind: "text", label: "2,500" },
  ],
  "action-buy-from": tokenOptions,
  "action-buy-target": [
    { kind: "token", label: "SOL", symbol: "SOL" },
    { kind: "token", label: "USDC", symbol: "USDC" },
  ],
  "action-send-amount": [
    { kind: "text", label: "500" },
    { kind: "text", label: "1,000" },
    { kind: "text", label: "2,500" },
  ],
  "action-send-from": tokenOptions,
  "action-send-target": [
    { avatarUrl: "/agents/Agent-05.svg", kind: "person", label: "Alex" },
    { avatarUrl: "/agents/Agent-01.svg", kind: "person", label: "Sarah" },
    { avatarUrl: "/agents/Agent-10.svg", kind: "person", label: "Nina" },
  ],
  "action-swap-amount": [
    { kind: "text", label: "500" },
    { kind: "text", label: "1,000" },
    { kind: "text", label: "2,500" },
  ],
  "action-swap-from": tokenOptions,
  "action-swap-target": [
    { kind: "token", label: "SOL", symbol: "SOL" },
    { kind: "token", label: "USDC", symbol: "USDC" },
  ],
  "condition-a-comparator": [
    { kind: "text", label: "is greater than" },
    { kind: "text", label: "is less than" },
    { kind: "text", label: "is not equal to" },
    { kind: "text", label: "is greater than or equal to" },
    { kind: "text", label: "is less than or equal to" },
    { kind: "text", label: "is between" },
    { kind: "text", label: "is outside" },
  ],
  "condition-a-metric": [
    { kind: "token", label: "SOL", symbol: "SOL" },
    { kind: "token", label: "USDC", symbol: "USDC" },
  ],
  "condition-a-value": [
    { kind: "text", label: "$120.22" },
    { kind: "text", label: "$140.00" },
    { kind: "text", label: "$95.00" },
  ],
  "condition-b-comparator": [
    { kind: "text", label: "is greater than" },
    { kind: "text", label: "is less than" },
    { kind: "text", label: "is not equal to" },
    { kind: "text", label: "is greater than or equal to" },
    { kind: "text", label: "is less than or equal to" },
    { kind: "text", label: "is between" },
    { kind: "text", label: "is outside" },
  ],
  "condition-b-metric": [
    { kind: "token", label: "USDC", symbol: "USDC" },
    { kind: "token", label: "SOL", symbol: "SOL" },
  ],
  "condition-b-value": [
    { kind: "text", label: "$1,000" },
    { kind: "text", label: "$500" },
    { kind: "text", label: "$2,500" },
  ],
  "group-mode": [{ kind: "text", label: "Any" }, { kind: "text", label: "All" }],
  "top-comparator": [
    { kind: "text", label: "is greater than" },
    { kind: "text", label: "is less than" },
    { kind: "text", label: "is not equal to" },
    { kind: "text", label: "is greater than or equal to" },
    { kind: "text", label: "is less than or equal to" },
    { kind: "text", label: "is between" },
    { kind: "text", label: "is outside" },
  ],
  "top-metric": [
    { kind: "token", label: "SOL price", symbol: "SOL" },
    { kind: "token", label: "USDC balance", symbol: "USDC" },
  ],
  "top-value": [
    { kind: "text", label: "$120.22" },
    { kind: "text", label: "$140.00" },
    { kind: "text", label: "$95.00" },
  ],
};

const initialBuilderValues = Object.fromEntries(
  Object.entries(editableOptions).map(([key, options]) => [key, options[0]])
) as BuilderValues;

export function WorkflowBuilderPane({
  onBack,
}: {
  onBack?: () => void;
} = {}) {
  const [activeChip, setActiveChip] = useState<EditableChipKey | null>(null);
  const [values, setValues] = useState<BuilderValues>(initialBuilderValues);
  const paneRef = useRef<HTMLDivElement>(null);

  const setChip = (key: EditableChipKey, chip: WorkflowChip) => {
    setValues((current) => ({ ...current, [key]: chip }));
    setActiveChip(null);
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!paneRef.current?.contains(event.target as Node)) {
        setActiveChip(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveChip(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="workflow-builder-pane" ref={paneRef}>
      <header className="workflow-builder-header">
        {onBack ? (
          <button
            aria-label="Back to policy details"
            className="workflow-builder-back"
            onClick={onBack}
            type="button"
          >
            <ArrowRight size={20} strokeWidth={2} />
          </button>
        ) : null}
        <h2>Autoswap</h2>
      </header>

      <div className="workflow-builder-body">
        <div className="workflow-builder-block">
          <WorkflowLine icon={<ArrowUpRight size={20} strokeWidth={2} />}>
            <strong>If</strong>
            <EditableChipControl
              activeChip={activeChip}
              chip={{ ...values["top-metric"], field: "top-metric" }}
              onOpen={setActiveChip}
              onSelect={setChip}
            />
            <EditableChipControl
              activeChip={activeChip}
              chip={{ ...values["top-comparator"], field: "top-comparator" }}
              onOpen={setActiveChip}
              onSelect={setChip}
            />
            <EditableChipControl
              activeChip={activeChip}
              chip={{ ...values["top-value"], field: "top-value" }}
              onOpen={setActiveChip}
              onSelect={setChip}
            />
            <button
              aria-label="Add condition"
              className="workflow-builder-add-chip"
              type="button"
            >
              <Plus size={20} strokeWidth={1.8} />
            </button>
          </WorkflowLine>
        </div>

        <div className="workflow-builder-block">
          <div className="workflow-builder-group">
            <div className="workflow-builder-line-icon workflow-builder-line-icon-if">
              <ArrowUpRight size={20} strokeWidth={2} />
            </div>
            <div className="workflow-builder-group-content">
              <div className="workflow-builder-group-header">
                <strong>If</strong>
                <EditableChipControl
                  activeChip={activeChip}
                  chip={{ ...values["group-mode"], field: "group-mode" }}
                  onOpen={setActiveChip}
                  onSelect={setChip}
                />
                <strong>are true</strong>
              </div>

              <div className="workflow-builder-condition-row">
                <EditableChipControl
                  activeChip={activeChip}
                  chip={{
                    ...values["condition-a-metric"],
                    field: "condition-a-metric",
                  }}
                  onOpen={setActiveChip}
                  onSelect={setChip}
                />
                <Chip chip={{ kind: "text", label: "price" }} />
                <EditableChipControl
                  activeChip={activeChip}
                  chip={{
                    ...values["condition-a-comparator"],
                    field: "condition-a-comparator",
                  }}
                  onOpen={setActiveChip}
                  onSelect={setChip}
                />
                <EditableChipControl
                  activeChip={activeChip}
                  chip={{
                    ...values["condition-a-value"],
                    field: "condition-a-value",
                  }}
                  onOpen={setActiveChip}
                  onSelect={setChip}
                />
              </div>

              <div className="workflow-builder-condition-row">
                <EditableChipControl
                  activeChip={activeChip}
                  chip={{
                    ...values["condition-b-metric"],
                    field: "condition-b-metric",
                  }}
                  onOpen={setActiveChip}
                  onSelect={setChip}
                />
                <Chip chip={{ kind: "text", label: "balance" }} />
                <EditableChipControl
                  activeChip={activeChip}
                  chip={{
                    ...values["condition-b-comparator"],
                    field: "condition-b-comparator",
                  }}
                  onOpen={setActiveChip}
                  onSelect={setChip}
                />
                <EditableChipControl
                  activeChip={activeChip}
                  chip={{
                    ...values["condition-b-value"],
                    field: "condition-b-value",
                  }}
                  onOpen={setActiveChip}
                  onSelect={setChip}
                />
              </div>

              <button className="workflow-builder-add-condition" type="button">
                <Plus size={18} strokeWidth={1.8} />
                <span>Add condition</span>
              </button>
            </div>
            <DismissButton />
          </div>
        </div>

        <ActionLine
          activeChip={activeChip}
          amountField="action-swap-amount"
          fromField="action-swap-from"
          icon={<RefreshCcw size={20} strokeWidth={2} />}
          label="Swap"
          linkLabel="to"
          onOpen={setActiveChip}
          onSelect={setChip}
          targetField="action-swap-target"
          values={values}
        />
        <ActionLine
          activeChip={activeChip}
          amountField="action-send-amount"
          fromField="action-send-from"
          icon={<ArrowUp size={20} strokeWidth={2} />}
          label="Send"
          linkLabel="to"
          onOpen={setActiveChip}
          onSelect={setChip}
          targetField="action-send-target"
          values={values}
        />
        <ActionLine
          activeChip={activeChip}
          amountField="action-buy-amount"
          fromField="action-buy-from"
          icon={<DollarSign size={20} strokeWidth={2} />}
          label="Buy"
          linkLabel="for"
          onOpen={setActiveChip}
          onSelect={setChip}
          targetField="action-buy-target"
          values={values}
        />
      </div>

      <style jsx global>{`
        .workflow-builder-pane {
          display: flex;
          width: 100%;
          height: 100%;
          min-height: 0;
          flex-direction: column;
          overflow: hidden;
          border-radius: 20px 0 0 20px;
          border-right: 1px solid rgba(0, 0, 0, 0.08);
          background: #f5f5f5;
          color: #000;
          padding-top: 8px;
        }

        .workflow-builder-header {
          display: flex;
          height: 52px;
          flex: 0 0 auto;
          align-items: center;
          gap: 12px;
          padding: 8px 20px;
        }

        .workflow-builder-header h2 {
          margin: 0;
          color: #000;
          font-size: 20px;
          font-weight: 600;
          line-height: 24px;
          letter-spacing: 0;
        }

        .workflow-builder-back {
          display: inline-flex;
          width: 36px;
          height: 36px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 9999px;
          background: rgba(0, 0, 0, 0.04);
          color: #3c3c43;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.15s ease;
        }

        .workflow-builder-back:hover {
          background: rgba(0, 0, 0, 0.08);
        }

        .workflow-builder-back:active {
          transform: scale(0.96);
        }

        .workflow-builder-body {
          display: flex;
          min-height: 0;
          flex: 1;
          flex-direction: column;
          align-items: flex-start;
          overflow: hidden;
          padding: 32px 20px 8px;
        }

        .workflow-builder-block {
          width: 100%;
          padding-bottom: 16px;
        }

        .workflow-builder-block-nested {
          padding-left: 24px;
        }

        .workflow-builder-line,
        .workflow-builder-group {
          display: flex;
          width: 100%;
          overflow: visible;
          border-radius: 26px;
          background: #fff;
        }

        .workflow-builder-line {
          min-height: 56px;
          align-items: center;
          gap: 8px;
        }

        .workflow-builder-group {
          align-items: flex-start;
          gap: 8px;
        }

        .workflow-builder-line-icon {
          display: inline-flex;
          width: 32px;
          height: 32px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          margin: 12px;
          border-radius: 8px;
          background: #000;
          color: #fff;
        }

        .workflow-builder-line-icon-if,
        .workflow-builder-line-icon[data-accent="if"] {
          background: #f9363c;
        }

        .workflow-builder-line-content {
          display: flex;
          min-width: 0;
          flex: 1;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          padding: 12px 0;
        }

        .workflow-builder-line-content strong,
        .workflow-builder-group-header strong {
          color: #000;
          font-size: 16px;
          font-weight: 600;
          line-height: 20px;
          white-space: nowrap;
        }

        .workflow-builder-dismiss {
          display: inline-flex;
          width: 56px;
          height: 56px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          border: 0;
          background: transparent;
          color: rgba(60, 60, 67, 0.58);
          cursor: pointer;
        }

        .workflow-builder-group .workflow-builder-dismiss {
          margin-left: auto;
        }

        .workflow-builder-dismiss:hover {
          color: rgba(28, 28, 30, 0.78);
        }

        .workflow-builder-group-content {
          display: flex;
          min-width: 0;
          flex: 1;
          flex-direction: column;
          align-items: flex-start;
          padding: 8px 0;
        }

        .workflow-builder-group-header,
        .workflow-builder-condition-row {
          display: flex;
          width: 100%;
          min-height: 36px;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }

        .workflow-builder-condition-row {
          flex-wrap: wrap;
          gap: 4px 8px;
          padding: 8px 0;
        }

        .workflow-builder-add-chip,
        .workflow-builder-add-condition {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 8px;
          background: #f5f5f5;
          color: rgba(60, 60, 67, 0.58);
          cursor: pointer;
          font-family: inherit;
        }

        .workflow-builder-add-chip {
          width: 24px;
          height: 24px;
          padding: 2px;
        }

        .workflow-builder-add-condition {
          gap: 4px;
          min-height: 24px;
          margin-top: 8px;
          padding: 2px 6px;
          font-size: 16px;
          font-weight: 400;
          line-height: 20px;
          white-space: nowrap;
        }

        .workflow-builder-add-chip:hover,
        .workflow-builder-add-condition:hover {
          background: #eeeeee;
        }
      `}</style>
    </div>
  );
}

function ActionLine({
  activeChip,
  amountField,
  fromField,
  icon,
  label,
  linkLabel,
  onOpen,
  onSelect,
  targetField,
  values,
}: {
  activeChip: EditableChipKey | null;
  amountField: EditableChipKey;
  fromField: EditableChipKey;
  icon: ReactNode;
  label: string;
  linkLabel: "for" | "to";
  onOpen: (key: EditableChipKey | null) => void;
  onSelect: (key: EditableChipKey, chip: WorkflowChip) => void;
  targetField: EditableChipKey;
  values: BuilderValues;
}) {
  return (
    <div className="workflow-builder-block workflow-builder-block-nested">
      <WorkflowLine accent={label.toLowerCase()} icon={icon}>
        <strong>{label}</strong>
        <EditableChipControl
          activeChip={activeChip}
          chip={{ ...values[amountField], field: amountField }}
          onOpen={onOpen}
          onSelect={onSelect}
        />
        <EditableChipControl
          activeChip={activeChip}
          chip={{ ...values[fromField], field: fromField }}
          onOpen={onOpen}
          onSelect={onSelect}
        />
        <strong>{linkLabel}</strong>
        <EditableChipControl
          activeChip={activeChip}
          chip={{ ...values[targetField], field: targetField }}
          onOpen={onOpen}
          onSelect={onSelect}
        />
      </WorkflowLine>
    </div>
  );
}

function WorkflowLine({
  accent = "if",
  children,
  icon,
}: {
  accent?: string;
  children: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="workflow-builder-line">
      <div
        aria-hidden="true"
        className="workflow-builder-line-icon"
        data-accent={accent}
      >
        {icon}
      </div>
      <div className="workflow-builder-line-content">{children}</div>
      <DismissButton />
    </div>
  );
}

function DismissButton() {
  return (
    <button
      aria-label="Remove workflow step"
      className="workflow-builder-dismiss"
      type="button"
    >
      <X size={24} strokeWidth={1.8} />
    </button>
  );
}

function EditableChipControl({
  activeChip,
  chip,
  onOpen,
  onSelect,
}: {
  activeChip: EditableChipKey | null;
  chip: EditableChip;
  onOpen: (key: EditableChipKey | null) => void;
  onSelect: (key: EditableChipKey, chip: WorkflowChip) => void;
}) {
  const isOpen = activeChip === chip.field;
  const isSelectedOption = (option: WorkflowChip) =>
    option.kind === chip.kind &&
    option.label === chip.label &&
    (option.kind !== "token" ||
      (chip.kind === "token" && option.symbol === chip.symbol));

  return (
    <span className="workflow-builder-chip-menu-wrap">
      <button
        aria-expanded={isOpen}
        className="workflow-builder-chip-button"
        onClick={(event) => {
          event.stopPropagation();
          onOpen(isOpen ? null : chip.field);
        }}
        type="button"
      >
        <Chip chip={chip} />
      </button>
      {isOpen ? (
        <span className="workflow-builder-chip-menu" role="listbox">
          {editableOptions[chip.field].map((option) => {
            const isSelected = isSelectedOption(option);

            return (
            <button
              aria-selected={isSelected}
              className="workflow-builder-chip-option"
              data-selected={isSelected}
              key={`${chip.field}-${option.kind}-${option.label}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(chip.field, option);
              }}
              role="option"
              type="button"
            >
              <span className="workflow-builder-chip-option-content">
                {option.kind === "token" ? (
                  <span className="workflow-builder-chip-option-image">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" src={getTokenIconUrl(option.symbol)} />
                  </span>
                ) : null}
                {option.kind === "person" ? (
                  <span className="workflow-builder-chip-option-image">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" src={option.avatarUrl} />
                  </span>
                ) : null}
                <span>{option.label}</span>
              </span>
              {isSelected ? (
                <Check
                  aria-hidden="true"
                  className="workflow-builder-chip-option-check"
                  size={20}
                  strokeWidth={1.8}
                />
              ) : null}
            </button>
          );
          })}
        </span>
      ) : null}
      <style jsx>{`
        .workflow-builder-chip-menu-wrap {
          position: relative;
          z-index: ${isOpen ? 50 : 1};
          display: inline-flex;
          flex: 0 0 auto;
        }

        .workflow-builder-chip-button,
        .workflow-builder-chip-option {
          display: inline-flex;
          align-items: center;
          padding: 0;
          border: 0;
          background: transparent;
          color: inherit;
          cursor: pointer;
          font: inherit;
        }

        .workflow-builder-chip-button:hover :global(.workflow-builder-chip) {
          background: rgba(249, 54, 60, 0.18);
        }

        .workflow-builder-chip-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          z-index: 60;
          display: flex;
          width: 234px;
          flex-direction: column;
          align-items: stretch;
          padding: 4px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.7);
          box-shadow:
            0 0 1px rgba(0, 0, 0, 0.08),
            0 4px 8px rgba(0, 0, 0, 0.08);
          backdrop-filter: blur(16px);
        }

        .workflow-builder-chip-option {
          min-height: 36px;
          justify-content: space-between;
          gap: 8px;
          padding: 0 8px;
          border-radius: 12px;
          color: #000;
          text-align: left;
        }

        .workflow-builder-chip-option[data-selected="true"],
        .workflow-builder-chip-option:hover {
          background: rgba(0, 0, 0, 0.04);
        }

        .workflow-builder-chip-option-content {
          display: inline-flex;
          min-width: 0;
          flex: 1;
          align-items: center;
          gap: 6px;
          padding: 8px 4px;
          color: #000;
          font-size: 14px;
          font-weight: 400;
          line-height: 20px;
        }

        .workflow-builder-chip-option-image {
          display: inline-flex;
          width: 20px;
          height: 20px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 999px;
          background: #f5f5f5;
        }

        .workflow-builder-chip-option-image img {
          display: block;
          width: 20px;
          height: 20px;
          object-fit: cover;
        }

        .workflow-builder-chip-option-check {
          flex: 0 0 auto;
          color: #f9363c;
          margin-left: 8px;
        }
      `}</style>
    </span>
  );
}

function Chip({ chip }: { chip: WorkflowChip }) {
  return (
    <>
      <span className="workflow-builder-chip">
        {chip.kind === "token" ? (
          <span className="workflow-builder-chip-image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" src={getTokenIconUrl(chip.symbol)} />
          </span>
        ) : null}
        {chip.kind === "person" ? (
          <span className="workflow-builder-chip-image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" src={chip.avatarUrl} />
          </span>
        ) : null}
        <span>{chip.label}</span>
      </span>
      <style jsx>{`
        .workflow-builder-chip {
          display: inline-flex;
          min-height: 24px;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 2px 6px;
          border-radius: 8px;
          background: rgba(249, 54, 60, 0.12);
          color: rgba(0, 0, 0, 0.6);
          font-size: 16px;
          font-weight: 400;
          line-height: 20px;
          white-space: nowrap;
        }

        .workflow-builder-chip-image {
          display: inline-flex;
          width: 20px;
          height: 20px;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 999px;
          background: #f5f5f5;
        }

        .workflow-builder-chip-image img {
          display: block;
          width: 20px;
          height: 20px;
          object-fit: cover;
        }
      `}</style>
    </>
  );
}
