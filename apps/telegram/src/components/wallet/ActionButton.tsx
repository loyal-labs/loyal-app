import React from "react";

export type ActionButtonProps = {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export function ActionButton({
  icon,
  label,
  onClick,
  disabled,
}: ActionButtonProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`flex-1 flex flex-col items-center justify-center gap-2 min-w-0 overflow-hidden rounded-2xl ${disabled ? "opacity-40" : ""} group`}
    >
      <div
        className="w-[52px] h-[52px] rounded-full flex items-center justify-center transition-all duration-150 group-active:scale-95"
        style={{
          background: "rgba(249, 54, 60, 0.14)",
        }}
      >
        <div className="text-black">
          {React.cloneElement(
            icon as React.ReactElement<{ size?: number; strokeWidth?: number }>,
            { size: 28, strokeWidth: 1.5 }
          )}
        </div>
      </div>
      <span className="text-[13px] leading-4" style={{ color: "rgba(60, 60, 67, 0.6)" }}>{label}</span>
    </button>
  );
}
