"use client";

import { MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Variant = "details" | "card";

const MENU_ITEMS: { id: string; label: string }[] = [
  { id: "edit", label: "Edit" },
  { id: "disable", label: "Disable" },
  { id: "duplicate", label: "Duplicate" },
  { id: "rename", label: "Rename" },
  { id: "action-1", label: "Action" },
  { id: "action-2", label: "Action" },
];

export function PolicyMoreMenu({
  onSelect,
  variant = "details",
}: {
  onSelect?: (id: string) => void;
  variant?: Variant;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleItemClick = (id: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    onSelect?.(id);
  };

  return (
    <div className="policy-more-wrap" data-variant={variant} ref={wrapRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More actions"
        className="policy-more-trigger"
        data-active={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            setOpen((v) => !v);
          }
        }}
        type="button"
      >
        <MoreHorizontal size={20} strokeWidth={1.8} />
      </button>
      {open ? (
        <div
          className="policy-more-menu"
          onClick={(event) => event.stopPropagation()}
          role="menu"
        >
          {MENU_ITEMS.map((item) => (
            <button
              className="policy-more-item"
              key={item.id}
              onClick={handleItemClick(item.id)}
              role="menuitem"
              type="button"
            >
              <span aria-hidden="true" className="policy-more-item-icon" />
              <span className="policy-more-item-label">{item.label}</span>
            </button>
          ))}
          <div aria-hidden="true" className="policy-more-separator" />
          <button
            className="policy-more-item"
            onClick={handleItemClick("delete")}
            role="menuitem"
            type="button"
          >
            <span aria-hidden="true" className="policy-more-item-icon">
              <Trash2 size={16} strokeWidth={1.8} />
            </span>
            <span className="policy-more-item-label">Delete</span>
          </button>
        </div>
      ) : null}
      <style jsx>{`
        .policy-more-wrap {
          position: relative;
          display: inline-flex;
          flex: 0 0 auto;
        }

        /* details variant: persistent 36px round button */
        .policy-more-wrap[data-variant="details"] .policy-more-trigger {
          width: 36px;
          height: 36px;
          background: rgba(0, 0, 0, 0.04);
          color: #000;
        }

        .policy-more-wrap[data-variant="details"]
          .policy-more-trigger:hover,
        .policy-more-wrap[data-variant="details"]
          .policy-more-trigger[data-active="true"] {
          background: rgba(0, 0, 0, 0.08);
        }

        /* card variant: 32px round bg appears on hover/active, icon visible
           via parent .policy-card:hover (CSS in policies-pane.tsx) */
        .policy-more-wrap[data-variant="card"] .policy-more-trigger {
          width: 32px;
          height: 32px;
          background: transparent;
          color: rgba(60, 60, 67, 0.6);
        }

        .policy-more-wrap[data-variant="card"]
          .policy-more-trigger:hover,
        .policy-more-wrap[data-variant="card"]
          .policy-more-trigger[data-active="true"] {
          background: rgba(0, 0, 0, 0.04);
          color: #000;
        }

        .policy-more-trigger {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 9999px;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .policy-more-menu {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          z-index: 30;
          display: flex;
          width: 168px;
          flex-direction: column;
          gap: 0;
          padding: 4px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          box-shadow:
            0 0 2px rgba(0, 0, 0, 0.08),
            0 4px 16px rgba(0, 0, 0, 0.08);
        }

        .policy-more-item {
          display: flex;
          align-items: center;
          gap: 0;
          width: 100%;
          padding: 8px;
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

        .policy-more-item:hover {
          background: rgba(0, 0, 0, 0.04);
        }

        .policy-more-item-icon {
          display: inline-flex;
          width: 20px;
          height: 20px;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          margin-right: 4px;
          border-radius: 4px;
          color: rgba(60, 60, 67, 0.7);
        }

        /* placeholder dashed glyph for items without a real icon */
        .policy-more-item-icon:empty {
          border: 1px dashed rgba(60, 60, 67, 0.45);
        }

        .policy-more-item-label {
          flex: 1 1 auto;
          padding: 0 4px;
        }

        .policy-more-separator {
          height: 1px;
          margin: 6px 8px;
          background: rgba(0, 0, 0, 0.08);
        }
      `}</style>
    </div>
  );
}
