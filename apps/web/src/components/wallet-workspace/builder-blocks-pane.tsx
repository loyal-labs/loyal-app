"use client";

import { ArrowUpRight, RefreshCcw } from "lucide-react";

type BuilderBlockTone = "action" | "condition" | "trigger";

type BuilderBlock = {
  label: string;
  tone: BuilderBlockTone;
};

type BuilderBlockGroup = {
  blocks: BuilderBlock[];
  title: string;
};

const blockGroups: BuilderBlockGroup[] = [
  {
    blocks: [
      { label: "Schedule trigger", tone: "trigger" },
      { label: "Label", tone: "trigger" },
      { label: "Label", tone: "trigger" },
    ],
    title: "Triggers",
  },
  {
    blocks: [
      { label: "If", tone: "condition" },
      { label: "Label", tone: "condition" },
      { label: "Label", tone: "condition" },
    ],
    title: "Conditions",
  },
  {
    blocks: [
      { label: "Swap", tone: "action" },
      { label: "Send", tone: "action" },
      { label: "Buy", tone: "action" },
      { label: "Deposit", tone: "action" },
      { label: "Sell", tone: "action" },
      { label: "Shield", tone: "action" },
      { label: "Unshield", tone: "action" },
      { label: "Notify", tone: "action" },
    ],
    title: "Actions",
  },
  {
    blocks: [
      { label: "Label", tone: "trigger" },
      { label: "Label", tone: "trigger" },
      { label: "Label", tone: "trigger" },
    ],
    title: "Execution rules",
  },
  {
    blocks: [
      { label: "Label", tone: "trigger" },
      { label: "Label", tone: "trigger" },
      { label: "Label", tone: "trigger" },
    ],
    title: "Safety limits",
  },
];

export function BuilderBlocksPane() {
  return (
    <div className="builder-blocks-pane">
      <header className="builder-blocks-header">
        <h2>Builder Blocks</h2>
      </header>

      <div className="builder-blocks-content">
        {blockGroups.map((group) => (
          <section className="builder-blocks-group" key={group.title}>
            <h3>{group.title}</h3>
            <div className="builder-blocks-grid">
              {group.blocks.map((block, index) => (
                <button
                  className="builder-block-chip"
                  data-tone={block.tone}
                  key={`${group.title}-${block.label}-${index}`}
                  type="button"
                >
                  <span className="builder-block-chip-icon" aria-hidden="true">
                    {block.tone === "action" ? (
                      <RefreshCcw size={15} strokeWidth={2.2} />
                    ) : (
                      <ArrowUpRight size={15} strokeWidth={2.2} />
                    )}
                  </span>
                  <span>{block.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <style jsx>{`
        .builder-blocks-pane {
          display: flex;
          width: calc(100% + 8px);
          height: 100%;
          margin-left: -8px;
          min-height: 0;
          flex-direction: column;
          align-items: center;
          overflow: hidden;
          border-radius: 0 20px 20px 0;
          background: #f5f5f5;
          color: #000;
          padding: 8px;
        }

        .builder-blocks-header {
          display: flex;
          width: 100%;
          height: 52px;
          flex: 0 0 auto;
          align-items: flex-start;
          padding: 14px 20px 2px 12px;
        }

        .builder-blocks-header h2 {
          min-width: 0;
          margin: 0;
          color: #000;
          font-size: 20px;
          font-weight: 600;
          line-height: 24px;
          letter-spacing: 0;
        }

        .builder-blocks-content {
          display: flex;
          width: 100%;
          min-height: 0;
          flex: 1;
          flex-direction: column;
          align-items: flex-start;
          overflow: auto;
          padding-bottom: 16px;
        }

        .builder-blocks-content::-webkit-scrollbar {
          width: 0;
          height: 0;
        }

        .builder-blocks-group {
          display: flex;
          width: 100%;
          flex: 0 0 auto;
          flex-direction: column;
          align-items: flex-start;
        }

        .builder-blocks-group h3 {
          width: 100%;
          margin: 0;
          padding: 15px 12px 8px;
          color: #000;
          font-size: 16px;
          font-weight: 500;
          line-height: 20px;
          letter-spacing: -0.176px;
        }

        .builder-blocks-grid {
          display: flex;
          width: 100%;
          flex-wrap: wrap;
          align-items: flex-start;
          gap: 8px;
        }

        .builder-block-chip {
          display: inline-flex;
          height: 40px;
          flex: 0 0 auto;
          align-items: center;
          overflow: hidden;
          padding: 0 16px 0 8px;
          border: 0;
          border-radius: 26px;
          background: #fff;
          color: #000;
          cursor: pointer;
          font-family: inherit;
          font-size: 16px;
          font-weight: 400;
          line-height: 20px;
          white-space: nowrap;
          transition:
            background 0.15s ease,
            transform 0.15s ease;
        }

        .builder-block-chip:hover {
          background: rgba(255, 255, 255, 0.82);
          transform: translateY(-1px);
        }

        .builder-block-chip-icon {
          display: inline-flex;
          width: 24px;
          height: 24px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          margin-right: 8px;
          border-radius: 6px;
          color: #fff;
        }

        .builder-block-chip[data-tone="trigger"] .builder-block-chip-icon {
          background: #32b67c;
        }

        .builder-block-chip[data-tone="condition"] .builder-block-chip-icon {
          background: #f9363c;
        }

        .builder-block-chip[data-tone="action"] .builder-block-chip-icon {
          background: #000;
        }
      `}</style>
    </div>
  );
}
