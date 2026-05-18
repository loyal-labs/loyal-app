"use client";

import NumberFlow, { continuous } from "@number-flow/react";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

const EARN_VAULTS = [
  {
    apy: "8.46% APY",
    label: "Kamino · Lending Yield",
    logo: "/wallet-workspace/earn-kamino.png",
  },
  {
    apy: "5.46% APY",
    label: "Drift · Lending Yield",
    logo: "/wallet-workspace/earn-drift.png",
  },
];

const EARN_DEPOSIT_VAULTS = [
  {
    apy: "8.46% APY",
    id: "kamino",
    label: "Kamino · Lending Yield",
    logo: "/wallet-workspace/earn-deposit-kamino.png",
  },
  {
    apy: "2.46% APY",
    id: "drift",
    label: "Drift · Lending Yield",
    logo: "/wallet-workspace/earn-drift.png",
  },
] as const;

const EARN_CHART_WIDTH = 508;
const EARN_CHART_HEIGHT = 260;
const EARN_CHART_BASELINE = 238;
const EARN_CHART_TOP = 12;
const MIN_DEPOSIT_USDC = 0.5;
const EARN_BALANCE_APY = 0.0846;
const EARN_BALANCE_DECIMALS = 6;
const EARN_BALANCE_INITIAL_VALUE = 1000.000006;
const EARN_BALANCE_PRINCIPAL = 1000;
const EARN_BALANCE_SAMPLE_MS = 250;
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const EARN_NUMBER_FLOW_PLUGINS = [continuous];

export type EarnDepositSourceOption = {
  addressLabel: string;
  balanceFraction: string;
  balanceWhole: string;
  icon: string;
  id: string;
  label: string;
};

const FALLBACK_EARN_DEPOSIT_SOURCES: EarnDepositSourceOption[] = [
  {
    addressLabel: "2Lzb…UQUu",
    balanceFraction: "00",
    balanceWhole: "1,280",
    icon: "/agents/Agent-01.svg",
    id: "main",
    label: "Main",
  },
  {
    addressLabel: "9xQe…3Kf8",
    balanceFraction: "28",
    balanceWhole: "12,346",
    icon: "/agents/Stashx.svg",
    id: "stash",
    label: "Stash",
  },
];

type EarnChartPoint = {
  date: string;
  highValue: number;
  index: number;
  lowValue: number;
  value: number;
  yieldUsd: number;
};

function formatMoney(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function buildEarnChartPoints(): EarnChartPoint[] {
  const months = 12;
  const principal = 1000;
  const target = 1120.48;
  const lowTarget = 1070;
  const highTarget = 1190;
  const dates = [
    "May 2026",
    "Jun 2026",
    "Jul 2026",
    "Aug 2026",
    "Sep 2026",
    "Oct 2026",
    "Nov 2026",
    "Dec 2026",
    "Jan 2027",
    "Feb 2027",
    "Mar 2027",
    "Apr 2027",
    "May 2027",
  ];

  return Array.from({ length: months + 1 }, (_, index) => {
    const progress = index / months;
    const eased = Math.pow(progress, 1.08);
    const value = principal + (target - principal) * eased;
    return {
      date: dates[index] ?? "May 2027",
      highValue: principal + (highTarget - principal) * progress,
      index,
      lowValue: principal + (lowTarget - principal) * progress,
      value,
      yieldUsd: value - principal,
    };
  });
}

function EarnYieldIcon({ size = 64 }: { size?: number }) {
  const scale = size / 64;

  return (
    <span
      aria-hidden="true"
      style={{
        background: "#32B67C",
        borderRadius: `${16 * scale}px`,
        display: "inline-block",
        flexShrink: 0,
        height: size,
        overflow: "hidden",
        position: "relative",
        width: size,
      }}
    >
      <span
        style={{
          background: "#fff",
          borderRadius: `${2.667 * scale}px`,
          height: `${21.333 * scale}px`,
          left: `${10.67 * scale}px`,
          position: "absolute",
          top: `${32 * scale}px`,
          width: `${8 * scale}px`,
        }}
      />
      <span
        style={{
          background: "#fff",
          borderRadius: `${2.667 * scale}px`,
          height: `${42.667 * scale}px`,
          left: `${28 * scale}px`,
          position: "absolute",
          top: `${10.67 * scale}px`,
          width: `${8 * scale}px`,
        }}
      />
      <span
        style={{
          background: "#fff",
          borderRadius: `${2.667 * scale}px`,
          height: `${32 * scale}px`,
          left: `${45.33 * scale}px`,
          position: "absolute",
          top: `${21.33 * scale}px`,
          width: `${8 * scale}px`,
        }}
      />
    </span>
  );
}

function ApyBadge({ value }: { value: string }) {
  return (
    <span
      style={{
        alignItems: "center",
        background: "rgba(52, 199, 89, 0.14)",
        borderRadius: "6px",
        color: "#34C759",
        display: "inline-flex",
        fontFamily: font,
        fontSize: "16px",
        fontWeight: 500,
        gap: "4px",
        lineHeight: "20px",
        padding: "1px 4px",
        whiteSpace: "nowrap",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        aria-hidden="true"
        src="/wallet-workspace/earn-flash.svg"
        style={{ height: "20px", width: "12px" }}
      />
      {value}
    </span>
  );
}

function VaultIcon({ logo }: { logo: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        flexShrink: 0,
        height: "48px",
        position: "relative",
        width: "48px",
      }}
    >
      <span
        style={{
          border: "2.286px solid #fff",
          borderRadius: "80px",
          height: "32px",
          left: 0,
          overflow: "hidden",
          position: "absolute",
          top: 0,
          width: "32px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src="/wallet-workspace/earn-vault-usdc.png"
          style={{
            height: "100%",
            inset: 0,
            objectFit: "cover",
            position: "absolute",
            width: "100%",
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src="/wallet-workspace/earn-vault-usdc-overlay.png"
          style={{
            height: "100%",
            inset: 0,
            objectFit: "cover",
            position: "absolute",
            width: "100%",
          }}
        />
      </span>
      <span
        style={{
          borderRadius: "80px",
          bottom: 0,
          height: "32px",
          overflow: "hidden",
          position: "absolute",
          right: 0,
          width: "32px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src={logo}
          style={{
            height: "100%",
            inset: 0,
            objectFit: "cover",
            position: "absolute",
            width: "100%",
          }}
        />
      </span>
    </span>
  );
}

function DepositButton({
  dark = false,
  onClick,
  withIcon = false,
}: {
  dark?: boolean;
  onClick?: () => void;
  withIcon?: boolean;
}) {
  return (
    <>
      <style jsx>{`
        .earn-detail-deposit,
        .earn-detail-deposit-dark {
          transition:
            background 0.15s ease,
            transform 0.15s ease;
        }
        .earn-detail-deposit:hover {
          background: rgba(0, 0, 0, 0.08) !important;
          transform: translateY(-1px);
        }
        .earn-detail-deposit-dark:hover {
          background: #222 !important;
          transform: translateY(-1px);
        }
        .earn-detail-deposit:active,
        .earn-detail-deposit-dark:active {
          transform: translateY(0);
        }
      `}</style>
      <button
        className={dark ? "earn-detail-deposit-dark" : "earn-detail-deposit"}
        onClick={onClick}
        style={{
          alignItems: "center",
          background: dark ? "#000" : "rgba(0, 0, 0, 0.04)",
          border: "none",
          borderRadius: "9999px",
          color: dark ? "#fff" : "#000",
          cursor: "pointer",
          display: "inline-flex",
          flexShrink: 0,
          fontFamily: font,
          fontSize: "14px",
          fontWeight: 500,
          gap: "6px",
          justifyContent: "center",
          lineHeight: "20px",
          padding: withIcon ? "6px 16px 6px 6px" : "6px 16px",
          whiteSpace: "nowrap",
        }}
        type="button"
      >
        {withIcon ? (
          <span
            style={{
              alignItems: "center",
              display: "inline-flex",
              height: "24px",
              justifyContent: "center",
              width: "24px",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              src="/wallet-workspace/earn-plus.svg"
              style={{ height: "16px", width: "16px" }}
            />
          </span>
        ) : null}
        Deposit
      </button>
    </>
  );
}

function EarnGrowingBalance() {
  const [value, setValue] = useState(EARN_BALANCE_INITIAL_VALUE);

  useEffect(() => {
    const startedAt = performance.now();
    const interval = window.setInterval(() => {
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      const earned =
        (EARN_BALANCE_PRINCIPAL * EARN_BALANCE_APY * elapsedSeconds) /
        SECONDS_PER_YEAR;

      setValue(
        Number(
          (EARN_BALANCE_INITIAL_VALUE + earned).toFixed(EARN_BALANCE_DECIMALS)
        )
      );
    }, EARN_BALANCE_SAMPLE_MS);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <>
      <style jsx>{`
        :global(.earn-growing-balance-flow) {
          --number-flow-mask-height: 0.12em;
          --number-flow-mask-width: 0.24em;
          color: #000;
          font-family: ${font};
          font-size: 40px;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          line-height: 48px;
        }
        :global(.earn-growing-balance-flow::part(decimal)),
        :global(.earn-growing-balance-flow::part(fraction)) {
          color: rgba(60, 60, 67, 0.4);
        }
      `}</style>
      <NumberFlow
        className="earn-growing-balance-flow"
        format={{
          maximumFractionDigits: EARN_BALANCE_DECIMALS,
          minimumFractionDigits: EARN_BALANCE_DECIMALS,
          useGrouping: true,
        }}
        opacityTiming={{ duration: 280, easing: "ease-out" }}
        plugins={EARN_NUMBER_FLOW_PLUGINS}
        prefix="$"
        spinTiming={{ duration: 900, easing: "cubic-bezier(0.2, 0, 0, 1)" }}
        transformTiming={{
          duration: 900,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }}
        trend={1}
        value={value}
      />
    </>
  );
}

function EarnForecastBlock({ padding = "8px 20px" }: { padding?: string }) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        padding,
        width: "100%",
      }}
    >
      <div style={{ display: "flex", gap: "8px", padding: "0 0 10px" }}>
        {["Balance", "Yield", "Forecast"].map((tab) => (
          <button
            key={tab}
            style={{
              background:
                tab === "Forecast" ? "rgba(0, 0, 0, 0.04)" : "transparent",
              border: "none",
              borderRadius: "9999px",
              color: tab === "Forecast" ? "#000" : secondary,
              cursor: "default",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: tab === "Forecast" ? 500 : 400,
              lineHeight: "20px",
              padding: "6px 12px",
            }}
            type="button"
          >
            {tab}
          </button>
        ))}
      </div>
      <DepositChart />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          overflow: "hidden",
          paddingTop: "8px",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <span
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "16px",
            }}
          >
            May 2026
          </span>
          <span
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 500,
              lineHeight: "20px",
            }}
          >
            $1,000
            <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>.00</span>
          </span>
        </div>
        <div
          style={{
            alignItems: "flex-end",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          <span
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "16px",
            }}
          >
            May 2027
          </span>
          <span
            style={{
              alignItems: "center",
              color: "#34C759",
              display: "flex",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 500,
              gap: "4px",
              lineHeight: "20px",
            }}
          >
            $1,120.48
            <span
              style={{
                alignItems: "center",
                background: "#34C759",
                borderRadius: "4px",
                display: "inline-flex",
                height: "16px",
                justifyContent: "center",
                width: "16px",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                src="/wallet-workspace/earn-growth-arrow.svg"
                style={{ height: "12px", width: "12px" }}
              />
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

export function EarnDetailView({
  hasCurrentPosition = false,
  onDeposit,
  onOpenPosition,
  onWithdraw,
}: {
  hasCurrentPosition?: boolean;
  onDeposit?: () => void;
  onOpenPosition?: () => void;
  onWithdraw?: () => void;
}) {
  return (
    <div
      style={{
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          padding: "16px 20px 8px",
        }}
      >
        <h2
          style={{
            color: "#000",
            flex: 1,
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            lineHeight: "28px",
            margin: 0,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          Earn
        </h2>
        {hasCurrentPosition ? (
          <div style={{ display: "flex", gap: "8px" }}>
            <PositionHeaderButton
              icon="withdraw"
              iconColor="#85868A"
              label="Withdraw"
              onClick={onWithdraw}
            />
            <PositionHeaderButton
              dark
              icon="deposit"
              label="Deposit"
              onClick={onDeposit}
            />
          </div>
        ) : (
          <DepositButton dark onClick={onDeposit} withIcon />
        )}
      </div>

      <div
        style={{
          alignItems: "center",
          borderRadius: "20px",
          display: "flex",
          overflow: "hidden",
          padding: "8px 20px",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", padding: "8px 12px 8px 0" }}>
          <EarnYieldIcon />
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            gap: "2px",
            minWidth: 0,
            padding: "8px 0",
          }}
        >
          <span
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "14px",
              fontWeight: 400,
              lineHeight: "20px",
            }}
          >
            {hasCurrentPosition ? (
              <>
                Balance · <span style={{ color: "#34C759" }}>8.46% APY</span>
              </>
            ) : (
              "Balance"
            )}
          </span>
          <span
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "40px",
              fontWeight: 600,
              lineHeight: "48px",
              whiteSpace: "nowrap",
            }}
          >
            {hasCurrentPosition ? (
              <EarnGrowingBalance />
            ) : (
              <>
                $0
                <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>.00</span>
              </>
            )}
          </span>
        </div>
      </div>

      {hasCurrentPosition ? <EarnForecastBlock /> : null}

      {hasCurrentPosition ? (
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px",
            width: "100%",
          }}
        >
          <div style={{ padding: "3px 12px 1px" }}>
            <h3
              style={{
                color: "#000",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 600,
                lineHeight: "20px",
                margin: 0,
                padding: "12px 0 8px",
            }}
          >
              Current positions
            </h3>
          </div>
          <button
            className="earn-current-position-row"
            onClick={onOpenPosition}
            style={{
              alignItems: "center",
              background: "transparent",
              border: "none",
              borderRadius: "16px",
              cursor: "pointer",
              display: "flex",
              minHeight: "60px",
              overflow: "hidden",
              padding: "0 12px",
              textAlign: "left",
              transition: "background 0.15s ease",
              width: "100%",
            }}
            type="button"
          >
            <style jsx>{`
              .earn-current-position-row:hover {
                background: rgba(0, 0, 0, 0.04) !important;
              }
            `}</style>
            <div style={{ display: "flex", padding: "6px 12px 6px 0" }}>
              <VaultIcon logo="/wallet-workspace/earn-kamino.png" />
            </div>
            <div
              style={{
                display: "flex",
                flex: 1,
                flexDirection: "column",
                gap: "2px",
                justifyContent: "center",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "13px",
                  lineHeight: "16px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                Kamino · Lending Yield
              </span>
              <div>
                <ApyBadge value="8.46% APY" />
              </div>
            </div>
            <span
              style={{
                color: "#000",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 500,
                lineHeight: "20px",
                marginLeft: "12px",
                whiteSpace: "nowrap",
              }}
            >
              $1,000
              <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>.00</span>
            </span>
          </button>
        </section>
      ) : null}

      <section
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "8px",
          width: "100%",
        }}
      >
        <div style={{ padding: "3px 12px 1px" }}>
          <h3
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 600,
              lineHeight: "20px",
              margin: 0,
              padding: "12px 0 8px",
            }}
          >
            {hasCurrentPosition ? "Available positions" : "Available vaults"}
          </h3>
        </div>
        {EARN_VAULTS.filter(
          (vault) => !hasCurrentPosition || !vault.label.startsWith("Kamino")
        ).map((vault) => (
          <div
            className="earn-detail-row"
            key={vault.label}
            style={{
              alignItems: "center",
              borderRadius: "16px",
              display: "flex",
              minHeight: "60px",
              overflow: "hidden",
              padding: "0 12px",
              width: "100%",
            }}
          >
            <div style={{ display: "flex", padding: "6px 12px 6px 0" }}>
              <VaultIcon logo={vault.logo} />
            </div>
            <div
              style={{
                display: "flex",
                flex: 1,
                flexDirection: "column",
                gap: "2px",
                height: "60px",
                justifyContent: "center",
                minWidth: 0,
                padding: "9px 0",
              }}
            >
              <span
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "13px",
                  fontWeight: 400,
                  lineHeight: "16px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {vault.label}
              </span>
              <div>
                <ApyBadge value={vault.apy} />
              </div>
            </div>
            <div style={{ display: "flex", paddingLeft: "12px" }}>
              <DepositButton onClick={onDeposit} />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function PositionHeaderButton({
  dark = false,
  icon,
  iconColor,
  label,
  onClick,
}: {
  dark?: boolean;
  icon: "deposit" | "withdraw";
  iconColor?: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <>
      <style jsx>{`
        .earn-position-action {
          transition:
            background 0.15s ease,
            transform 0.15s ease;
        }
        .earn-position-action:hover {
          transform: translateY(-1px);
        }
        .earn-position-action:active {
          transform: translateY(0);
        }
      `}</style>
      <button
        className="earn-position-action"
        onClick={onClick}
        style={{
          alignItems: "center",
          background: dark ? "#000" : "rgba(0, 0, 0, 0.04)",
          border: "none",
          borderRadius: "9999px",
          color: dark ? "#fff" : "#000",
          cursor: "pointer",
          display: "inline-flex",
          flexShrink: 0,
          fontFamily: font,
          fontSize: "14px",
          fontWeight: 500,
          gap: "8px",
          height: "36px",
          lineHeight: "20px",
          padding: "6px 16px 6px 8px",
          whiteSpace: "nowrap",
        }}
        type="button"
      >
        <span
          style={{
            alignItems: "center",
            display: "inline-flex",
            height: "24px",
            justifyContent: "center",
            width: "24px",
          }}
        >
          {icon === "withdraw" ? (
            <ArrowUp color={iconColor} size={24} strokeWidth={2} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              aria-hidden="true"
              src="/wallet-workspace/earn-plus.svg"
              style={{ height: "16px", width: "16px" }}
            />
          )}
        </span>
        {label}
      </button>
    </>
  );
}

function EarnPositionIcon() {
  return (
    <span aria-hidden="true" style={{ display: "flex", padding: "8px 12px 8px 0" }}>
      <VaultIcon logo="/wallet-workspace/earn-kamino.png" />
    </span>
  );
}

export function EarnPositionView({
  onBack,
  onDeposit,
  onWithdraw,
}: {
  onBack?: () => void;
  onDeposit?: () => void;
  onWithdraw?: () => void;
}) {
  return (
    <div
      style={{
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          padding: "16px 20px 8px",
        }}
      >
        <div style={{ display: "flex", paddingRight: "12px" }}>
          <BackButton iconColor="#85868A" onClick={onBack} />
        </div>
        <h2
          style={{
            color: "#000",
            flex: 1,
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            lineHeight: "28px",
            margin: 0,
            minWidth: 0,
          }}
        >
          Lending Yield
        </h2>
        <div style={{ display: "flex", gap: "8px" }}>
          <PositionHeaderButton
            icon="withdraw"
            iconColor="#85868A"
            label="Withdraw"
            onClick={onWithdraw}
          />
          <PositionHeaderButton dark icon="deposit" label="Deposit" onClick={onDeposit} />
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          scrollbarWidth: "none",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            padding: "8px 20px",
            width: "100%",
          }}
        >
          <EarnPositionIcon />
          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              gap: "2px",
              minWidth: 0,
              padding: "8px 0",
            }}
          >
            <span
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "14px",
                lineHeight: "20px",
              }}
            >
              Balance · <span style={{ color: "#34C759" }}>8.46% APY</span>
            </span>
            <span
              style={{
                color: "#000",
                fontFamily: font,
                fontSize: "40px",
                fontWeight: 600,
                lineHeight: "48px",
                whiteSpace: "nowrap",
              }}
            >
              <EarnGrowingBalance />
            </span>
          </div>
        </div>

        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px 20px",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", gap: "8px", padding: "0 0 10px" }}>
            {["Balance", "Yield", "Forecast"].map((tab) => (
              <button
                key={tab}
                style={{
                  background:
                    tab === "Forecast" ? "rgba(0, 0, 0, 0.04)" : "transparent",
                  border: "none",
                  borderRadius: "9999px",
                  color: tab === "Forecast" ? "#000" : secondary,
                  cursor: "default",
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: tab === "Forecast" ? 500 : 400,
                  lineHeight: "20px",
                  padding: "6px 12px",
                }}
                type="button"
              >
                {tab}
              </button>
            ))}
          </div>
          <div style={{ width: "100%" }}>
            <DepositChart />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                overflow: "hidden",
                paddingTop: "8px",
                width: "100%",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ color: secondary, fontFamily: font, fontSize: "13px", lineHeight: "16px" }}>
                  May 2026
                </span>
                <span style={{ color: "#000", fontFamily: font, fontSize: "16px", fontWeight: 500, lineHeight: "20px" }}>
                  $1,000<span style={{ color: "rgba(60, 60, 67, 0.4)" }}>.00</span>
                </span>
              </div>
              <div style={{ alignItems: "flex-end", display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ color: secondary, fontFamily: font, fontSize: "13px", lineHeight: "16px" }}>
                  May 2027
                </span>
                <span style={{ alignItems: "center", color: "#34C759", display: "flex", fontFamily: font, fontSize: "16px", fontWeight: 500, gap: "4px", lineHeight: "20px" }}>
                  $1,120.48
                  <span style={{ alignItems: "center", background: "#34C759", borderRadius: "4px", display: "inline-flex", height: "16px", justifyContent: "center", width: "16px" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" aria-hidden="true" src="/wallet-workspace/earn-growth-arrow.svg" style={{ height: "12px", width: "12px" }} />
                  </span>
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function WithdrawRouteRow({
  amount,
  icon,
  isDropdown = false,
  isOpen = false,
  isPosition = false,
  isSelected = false,
  onClick,
  subtitle,
}: {
  amount: string;
  icon: string;
  isDropdown?: boolean;
  isOpen?: boolean;
  isPosition?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  subtitle: string;
}) {
  const [wholeAmount, fractionAmount = "00"] = amount.split(".");

  return (
    <button
      className={onClick ? "earn-withdraw-route" : undefined}
      onClick={onClick}
      style={{
        alignItems: "center",
        background: isOpen ? "rgba(0, 0, 0, 0.04)" : "transparent",
        border: "none",
        borderRadius: isDropdown ? "16px" : "8px",
        cursor: onClick ? "pointer" : "default",
        display: "flex",
        minHeight: "60px",
        overflow: "hidden",
        padding: "0 12px",
        textAlign: "left",
        transition: "background 0.15s ease",
        width: "100%",
      }}
      type="button"
    >
      <style jsx>{`
        .earn-withdraw-route:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
      `}</style>
      <div style={{ display: "flex", padding: "6px 12px 6px 0" }}>
        {isPosition ? (
          <VaultIcon logo={icon} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            aria-hidden="true"
            src={icon}
            style={{
              borderRadius: "12px",
              height: "48px",
              objectFit: "cover",
              width: "48px",
            }}
          />
        )}
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          gap: "2px",
          justifyContent: "center",
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: secondary,
            fontFamily: font,
            fontSize: "13px",
            lineHeight: "16px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {subtitle}
        </span>
        <span
          style={{
            color: "#000",
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            lineHeight: "24px",
            whiteSpace: "nowrap",
          }}
        >
          {wholeAmount}
          <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>
            .{fractionAmount} USDC
          </span>
        </span>
      </div>
      {isDropdown ? (
        <span
          aria-hidden="true"
          style={{
            display: "flex",
            marginLeft: "12px",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
          }}
        >
          {isOpen ? (
            <ChevronsDownUp color="#B1B1B4" size={24} strokeWidth={2} />
          ) : (
            <ChevronsUpDown color="#B1B1B4" size={24} strokeWidth={2} />
          )}
        </span>
      ) : isSelected ? (
        <Check
          color="#F9363C"
          size={24}
          strokeWidth={2}
          style={{ marginLeft: "12px" }}
        />
      ) : null}
    </button>
  );
}

export function EarnWithdrawView({
  onBack,
  onClose,
  onComplete,
}: {
  onBack?: () => void;
  onClose?: () => void;
  onComplete?: () => void;
}) {
  const withdrawAmountInputRef = useRef<HTMLInputElement | null>(null);
  const withdrawSourceCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isWithdrawSourceMenuOpen, setIsWithdrawSourceMenuOpen] =
    useState(false);
  const [isWithdrawSourceMenuClosing, setIsWithdrawSourceMenuClosing] =
    useState(false);
  const hasWithdrawAmount = withdrawAmount.length > 0;
  const withdrawUsdDisplay = hasWithdrawAmount
    ? `$${withdrawAmount}${withdrawAmount.includes(".") ? "" : ".00"}`
    : "$0.00";
  const shouldShowWithdrawSourceMenu =
    isWithdrawSourceMenuOpen || isWithdrawSourceMenuClosing;

  const closeWithdrawSourceMenu = () => {
    if (!isWithdrawSourceMenuOpen || isWithdrawSourceMenuClosing) return;
    setIsWithdrawSourceMenuClosing(true);
    withdrawSourceCloseTimerRef.current = setTimeout(() => {
      setIsWithdrawSourceMenuOpen(false);
      setIsWithdrawSourceMenuClosing(false);
      withdrawSourceCloseTimerRef.current = null;
    }, 180);
  };

  const openWithdrawSourceMenu = () => {
    if (withdrawSourceCloseTimerRef.current) {
      clearTimeout(withdrawSourceCloseTimerRef.current);
      withdrawSourceCloseTimerRef.current = null;
    }
    setIsWithdrawSourceMenuClosing(false);
    setIsWithdrawSourceMenuOpen(true);
  };

  const toggleWithdrawSourceMenu = () => {
    if (isWithdrawSourceMenuClosing) {
      openWithdrawSourceMenu();
      return;
    }
    if (isWithdrawSourceMenuOpen) {
      closeWithdrawSourceMenu();
      return;
    }
    openWithdrawSourceMenu();
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      withdrawAmountInputRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (withdrawSourceCloseTimerRef.current) {
        clearTimeout(withdrawSourceCloseTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      style={{
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <style jsx>{`
        .earn-withdraw-chip:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
        .earn-withdraw-submit:hover {
          background: #222 !important;
        }
        .earn-withdraw-submit:disabled:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .earn-withdraw-amount-input::selection {
          background: rgba(249, 54, 60, 0.18);
        }
        .earn-withdraw-amount-input::placeholder {
          color: rgba(60, 60, 67, 0.4);
          opacity: 1;
        }
        .earn-withdraw-source-sheet {
          animation: earn-withdraw-source-sheet-open 0.18s ease forwards;
          transform-origin: top center;
        }
        .earn-withdraw-source-sheet-closing {
          animation: earn-withdraw-source-sheet-close 0.18s ease forwards;
          pointer-events: none;
        }
        @keyframes earn-withdraw-source-sheet-open {
          0% {
            opacity: 0;
            transform: translateY(-6px) scale(0.985);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes earn-withdraw-source-sheet-close {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-6px) scale(0.985);
          }
        }
      `}</style>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          padding: "16px 20px 8px",
        }}
      >
        <div style={{ display: "flex", paddingRight: "12px" }}>
          <BackButton iconColor="#85868A" onClick={onBack} />
        </div>
        <h2
          style={{
            color: "#000",
            flex: 1,
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            lineHeight: "28px",
            margin: 0,
            minWidth: 0,
          }}
        >
          Withdraw
        </h2>
        <CloseButton iconColor="#85868A" onClick={onClose} />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          scrollbarWidth: "none",
          width: "100%",
        }}
      >
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "30px 20px 8px",
            width: "100%",
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <div
              style={{
                alignItems: "baseline",
                display: "flex",
                gap: "8px",
                minWidth: 0,
              }}
            >
              <input
                className="earn-withdraw-amount-input"
                inputMode="decimal"
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "" || /^[\d,]*\.?\d*$/.test(value)) {
                    setWithdrawAmount(value);
                  }
                }}
                placeholder="0"
                ref={withdrawAmountInputRef}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#000",
                  flexShrink: 1,
                  fontFamily: font,
                  fontSize: "40px",
                  fontWeight: 600,
                  lineHeight: "48px",
                  minWidth: 0,
                  outline: "none",
                  padding: 0,
                  width: `${Math.max(withdrawAmount.length, 1)}ch`,
                }}
                type="text"
                value={withdrawAmount}
              />
              <span
                style={{
                  color: "rgba(60, 60, 67, 0.4)",
                  fontFamily: font,
                  fontSize: "28px",
                  fontWeight: 600,
                  lineHeight: "32px",
                }}
              >
                USDC
              </span>
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
              <button
                className="earn-withdraw-chip"
                style={{
                  background: "rgba(0, 0, 0, 0.04)",
                  border: "none",
                  borderRadius: "9999px",
                  color: "#000",
                  cursor: "pointer",
                  fontFamily: font,
                  fontSize: "14px",
                  fontWeight: 500,
                  lineHeight: "20px",
                  padding: "6px 16px",
                  transition: "background 0.15s ease",
                }}
                type="button"
              >
                Earnings
              </button>
              <button
                className="earn-withdraw-submit"
                onClick={() => setWithdrawAmount("1,280")}
                style={{
                  background: "#000",
                  border: "none",
                  borderRadius: "9999px",
                  color: "#fff",
                  cursor: "pointer",
                  fontFamily: font,
                  fontSize: "14px",
                  fontWeight: 500,
                  lineHeight: "20px",
                  padding: "6px 16px",
                  transition: "background 0.15s ease",
                }}
                type="button"
              >
                MAX
              </button>
            </div>
          </div>
          <span
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "16px",
              lineHeight: "22px",
              paddingTop: "4px",
            }}
          >
            {withdrawUsdDisplay}
          </span>
        </section>

        <section style={{ padding: "8px", position: "relative", width: "100%", zIndex: 2 }}>
          <div style={{ padding: "3px 12px 1px" }}>
            <p
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "16px",
                lineHeight: "20px",
                margin: 0,
                padding: "12px 0 4px",
              }}
            >
              From
            </p>
          </div>
          <WithdrawRouteRow
            amount="1,280.00"
            icon="/wallet-workspace/earn-kamino.png"
            isDropdown
            isOpen={isWithdrawSourceMenuOpen}
            isPosition
            onClick={toggleWithdrawSourceMenu}
            subtitle="Kamino · Lending Yield"
          />
          {shouldShowWithdrawSourceMenu ? (
            <div
              className={`earn-withdraw-source-sheet ${
                isWithdrawSourceMenuClosing
                  ? "earn-withdraw-source-sheet-closing"
                  : ""
              }`}
              style={{
                backdropFilter: "blur(16px)",
                background: "rgba(255, 255, 255, 0.7)",
                borderRadius: "16px",
                boxShadow:
                  "0 0 2px rgba(0, 0, 0, 0.08), 0 4px 16px rgba(0, 0, 0, 0.08)",
                display: "flex",
                flexDirection: "column",
                left: "8px",
                overflow: "hidden",
                padding: "8px",
                position: "absolute",
                right: "8px",
                top: "108px",
                WebkitBackdropFilter: "blur(16px)",
                zIndex: 4,
              }}
            >
              <WithdrawRouteRow
                amount="1,280.00"
                icon="/wallet-workspace/earn-kamino.png"
                isPosition
                isSelected
                onClick={closeWithdrawSourceMenu}
                subtitle="Kamino · Lending Yield"
              />
            </div>
          ) : null}
          <div style={{ padding: "3px 12px 1px" }}>
            <p
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "16px",
                lineHeight: "20px",
                margin: 0,
                padding: "12px 0 4px",
              }}
            >
              To
            </p>
          </div>
          <WithdrawRouteRow
            amount="1,280.00"
            icon="/agents/Stashx.svg"
            subtitle="Stash"
          />
        </section>
      </div>

      <div
        style={{
          background: "linear-gradient(to bottom, rgba(255,255,255,0), #fff 28%)",
          padding: "16px 32px 24px",
          width: "100%",
        }}
      >
        <button
          className="earn-withdraw-submit"
          disabled={!hasWithdrawAmount}
          onClick={onComplete}
          style={{
            alignItems: "center",
            background: hasWithdrawAmount ? "#000" : "rgba(0, 0, 0, 0.04)",
            border: "none",
            borderRadius: "78px",
            color: hasWithdrawAmount ? "#fff" : secondary,
            cursor: hasWithdrawAmount ? "pointer" : "default",
            display: "flex",
            fontFamily: font,
            fontSize: "17px",
            fontWeight: 500,
            height: "50px",
            justifyContent: "center",
            lineHeight: "22px",
            padding: "15px 12px",
            transition: "background 0.15s ease",
            width: "100%",
          }}
          type="button"
        >
          Withdraw
        </button>
      </div>
    </div>
  );
}

function CloseButton({
  iconColor,
  onClick,
}: {
  iconColor?: string;
  onClick?: () => void;
}) {
  return (
    <>
      <style jsx>{`
        .earn-deposit-close:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
      `}</style>
      <button
        className="earn-deposit-close"
        onClick={onClick}
        style={{
          alignItems: "center",
          background: "rgba(0, 0, 0, 0.04)",
          border: "none",
          borderRadius: "9999px",
          color: "#3C3C43",
          cursor: "pointer",
          display: "inline-flex",
          height: "36px",
          justifyContent: "center",
          padding: "6px",
          transition: "background 0.15s ease",
          width: "36px",
        }}
        type="button"
      >
        <X color={iconColor} size={24} strokeWidth={2} />
      </button>
    </>
  );
}

function BackButton({
  iconColor,
  onClick,
}: {
  iconColor?: string;
  onClick?: () => void;
}) {
  return (
    <>
      <style jsx>{`
        .earn-deposit-back:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
      `}</style>
      <button
        className="earn-deposit-back"
        onClick={onClick}
        style={{
          alignItems: "center",
          background: "rgba(0, 0, 0, 0.04)",
          border: "none",
          borderRadius: "9999px",
          color: "#3C3C43",
          cursor: "pointer",
          display: "inline-flex",
          height: "36px",
          justifyContent: "center",
          padding: "6px",
          transition: "background 0.15s ease",
          width: "36px",
        }}
        type="button"
      >
        <ArrowLeft color={iconColor} size={24} strokeWidth={2} />
      </button>
    </>
  );
}

function DepositVaultIcon({ logo }: { logo: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        flexShrink: 0,
        height: "48px",
        position: "relative",
        width: "48px",
      }}
    >
      <span
        style={{
          border: "2.286px solid #fff",
          borderRadius: "80px",
          height: "32px",
          left: 0,
          overflow: "hidden",
          position: "absolute",
          top: 0,
          width: "32px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src="/wallet-workspace/earn-deposit-usdc.png"
          style={{ height: "100%", objectFit: "cover", width: "100%" }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src="/wallet-workspace/earn-deposit-usdc-overlay.png"
          style={{ height: "100%", inset: 0, objectFit: "cover", position: "absolute", width: "100%" }}
        />
      </span>
      <span
        style={{
          borderRadius: "80px",
          bottom: 0,
          height: "32px",
          overflow: "hidden",
          position: "absolute",
          right: 0,
          width: "32px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src={logo}
          style={{ height: "100%", objectFit: "cover", width: "100%" }}
        />
      </span>
    </span>
  );
}

function DepositVaultRow({
  isHighlighted = false,
  isOpen = false,
  isPulsing = false,
  isSelected = false,
  isTrigger = false,
  onClick,
  vault,
}: {
  isHighlighted?: boolean;
  isOpen?: boolean;
  isPulsing?: boolean;
  isSelected?: boolean;
  isTrigger?: boolean;
  onClick?: () => void;
  vault: (typeof EARN_DEPOSIT_VAULTS)[number];
}) {
  return (
    <>
      <style jsx>{`
        .earn-yield-trigger,
        .earn-yield-option {
          transition:
            background 0.15s ease,
            transform 0.18s ease;
        }
        .earn-yield-trigger:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .earn-yield-option:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .earn-yield-row-pulse {
          animation: earn-yield-row-pulse 0.22s ease;
        }
        .earn-yield-check {
          animation: earn-yield-check-in 0.18s ease;
        }
        .earn-yield-chevron {
          transition: transform 0.18s ease;
        }
        @keyframes earn-yield-row-pulse {
          0% {
            transform: scale(0.99);
          }
          100% {
            transform: scale(1);
          }
        }
        @keyframes earn-yield-check-in {
          0% {
            opacity: 0;
            transform: scale(0.82);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
      <button
        className={`${isTrigger ? "earn-yield-trigger" : "earn-yield-option"} ${
          isPulsing ? "earn-yield-row-pulse" : ""
        }`}
        onClick={onClick}
        style={{
          alignItems: "center",
          background: isTrigger
            ? isOpen
              ? "rgba(0, 0, 0, 0.04)"
              : "transparent"
            : isHighlighted
              ? "rgba(0, 0, 0, 0.04)"
              : "transparent",
          border: "none",
          borderRadius: isTrigger ? "16px" : "8px",
          cursor: onClick ? "pointer" : "default",
          display: "flex",
          minHeight: "60px",
          overflow: "hidden",
          padding: "0 12px",
          textAlign: "left",
          width: "100%",
        }}
        type="button"
      >
        <div style={{ display: "flex", padding: "6px 12px 6px 0" }}>
          <DepositVaultIcon logo={vault.logo} />
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            gap: "2px",
            height: "60px",
            justifyContent: "center",
            minWidth: 0,
            padding: "9px 0",
          }}
        >
          <span
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "16px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {vault.label}
          </span>
          <div>
            <ApyBadge value={vault.apy} />
          </div>
        </div>
        {isTrigger ? (
          <span
            aria-hidden="true"
            className="earn-yield-chevron"
            style={{
              display: "flex",
              marginLeft: "12px",
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            {isOpen ? (
              <ChevronsDownUp
                color="#B1B1B4"
                size={24}
                strokeWidth={2}
              />
            ) : (
              <ChevronsUpDown
                color="#B1B1B4"
                size={24}
                strokeWidth={2}
              />
            )}
          </span>
        ) : isSelected ? (
          <Check
            className="earn-yield-check"
            color="#F9363C"
            size={24}
            strokeWidth={2}
            style={{ marginLeft: "12px" }}
          />
        ) : null}
      </button>
    </>
  );
}

function DepositSourceRow({
  isHighlighted = false,
  isOpen = false,
  isSelected = false,
  isTrigger = false,
  onClick,
  source,
}: {
  isHighlighted?: boolean;
  isOpen?: boolean;
  isSelected?: boolean;
  isTrigger?: boolean;
  onClick?: () => void;
  source: EarnDepositSourceOption;
}) {
  return (
    <>
      <style jsx>{`
        .earn-source-trigger,
        .earn-source-option {
          transition:
            background 0.15s ease,
            transform 0.18s ease;
        }
        .earn-source-trigger:hover,
        .earn-source-option:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .earn-source-chevron {
          transition: transform 0.18s ease;
        }
        .earn-source-check {
          animation: earn-source-check-in 0.18s ease;
        }
        @keyframes earn-source-check-in {
          0% {
            opacity: 0;
            transform: scale(0.82);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
      <button
        className={isTrigger ? "earn-source-trigger" : "earn-source-option"}
        onClick={onClick}
        style={{
          alignItems: "center",
          background: isTrigger
            ? isOpen
              ? "rgba(0, 0, 0, 0.04)"
              : "transparent"
            : isHighlighted
              ? "rgba(0, 0, 0, 0.04)"
              : "transparent",
          border: "none",
          borderRadius: isTrigger ? "16px" : "8px",
          cursor: onClick ? "pointer" : "default",
          display: "flex",
          minHeight: "60px",
          overflow: "hidden",
          padding: "0 12px",
          textAlign: "left",
          width: "100%",
        }}
        type="button"
      >
        <div style={{ display: "flex", padding: "6px 12px 6px 0" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            src={source.icon}
            style={{
              borderRadius: "12px",
              height: "48px",
              objectFit: "cover",
              width: "48px",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            gap: "2px",
            height: "60px",
            justifyContent: "center",
            minWidth: 0,
            padding: "9px 0",
          }}
        >
          <span
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "16px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {source.label} · {source.addressLabel}
          </span>
          <span
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "20px",
              fontWeight: 600,
              lineHeight: "24px",
              whiteSpace: "nowrap",
            }}
          >
            {source.balanceWhole}
            <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>
              .{source.balanceFraction} USDC
            </span>
          </span>
        </div>
        {isTrigger ? (
          <span
            aria-hidden="true"
            className="earn-source-chevron"
            style={{
              display: "flex",
              marginLeft: "12px",
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            {isOpen ? (
              <ChevronsDownUp
                color="#B1B1B4"
                size={24}
                strokeWidth={2}
              />
            ) : (
              <ChevronsUpDown
                color="#B1B1B4"
                size={24}
                strokeWidth={2}
              />
            )}
          </span>
        ) : isSelected ? (
          <Check
            className="earn-source-check"
            color="#F9363C"
            size={24}
            strokeWidth={2}
            style={{ marginLeft: "12px" }}
          />
        ) : null}
      </button>
    </>
  );
}

function DepositChart() {
  const points = useMemo(buildEarnChartPoints, []);
  const defaultHoverIndex = Math.floor((points.length - 1) / 2);
  const [hoverIndex, setHoverIndex] = useState(defaultHoverIndex);
  const minValue = 1000;
  const maxValue = 1190;
  const chartHeight = EARN_CHART_BASELINE - EARN_CHART_TOP;
  const plot = (value: number) =>
    EARN_CHART_BASELINE -
    ((value - minValue) / (maxValue - minValue)) * chartHeight;
  const xForIndex = (index: number) =>
    (index / (points.length - 1)) * EARN_CHART_WIDTH;
  const plotted = points.map((point) => ({
    ...point,
    highY: plot(point.highValue),
    lowY: plot(point.lowValue),
    x: xForIndex(point.index),
    y: plot(point.value),
  }));
  const pathFrom = (key: "highY" | "lowY" | "y") =>
    plotted
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point[key]}`)
      .join(" ");
  const activePath = plotted
    .slice(0, hoverIndex + 1)
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const areaPath = [
    `M${plotted[0]?.x ?? 0},${EARN_CHART_BASELINE}`,
    ...plotted.map((point) => `L${point.x},${point.y}`),
    `L${EARN_CHART_WIDTH},${EARN_CHART_BASELINE}`,
    "Z",
  ].join(" ");
  const hoverPoint = plotted[Math.min(hoverIndex, plotted.length - 1)];
  const hoverLeft = (hoverPoint.x / EARN_CHART_WIDTH) * 100;
  const tooltipLeft = Math.min(Math.max(hoverLeft, 21), 79);
  const pointTop = (value: number) => (value / EARN_CHART_HEIGHT) * 100;

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const nextIndex = Math.round((x / rect.width) * (points.length - 1));
    setHoverIndex(nextIndex);
  };

  return (
    <div
      onPointerLeave={() => setHoverIndex(defaultHoverIndex)}
      onPointerMove={handlePointerMove}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        height: "300px",
        justifyContent: "center",
        padding: "2px 0",
        position: "relative",
        width: "100%",
      }}
    >
      <div style={{ flex: 1, minHeight: 0, position: "relative", width: "100%" }}>
        <svg
          aria-label="Estimated earnings chart"
          preserveAspectRatio="none"
          role="img"
          style={{ display: "block", height: "100%", width: "100%" }}
          viewBox={`0 0 ${EARN_CHART_WIDTH} ${EARN_CHART_HEIGHT}`}
        >
          <defs>
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id="earn-chart-area"
              x1="254"
              x2="254"
              y1="0"
              y2={EARN_CHART_BASELINE}
            >
              <stop stopColor="#FDAFB1" stopOpacity="0.2" />
              <stop offset="1" stopColor="#FDAFB1" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#earn-chart-area)" />
          <path
            d={pathFrom("highY")}
            fill="none"
            stroke="#FDAFB1"
            strokeDasharray="6 6"
            strokeLinecap="round"
          />
          <path
            d={pathFrom("lowY")}
            fill="none"
            stroke="#FDAFB1"
            strokeDasharray="6 6"
            strokeLinecap="round"
          />
          <path
            d={pathFrom("y")}
            fill="none"
            stroke="#F9363C"
            strokeLinecap="round"
            strokeOpacity="0.35"
            strokeWidth="2"
          />
          <path
            d={activePath}
            fill="none"
            stroke="#F9363C"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
        <div
          aria-hidden="true"
          style={{
            borderLeft: "1px dashed rgba(60, 60, 67, 0.18)",
            bottom: `${((EARN_CHART_HEIGHT - EARN_CHART_BASELINE) / EARN_CHART_HEIGHT) * 100}%`,
            left: `${hoverLeft}%`,
            pointerEvents: "none",
            position: "absolute",
            top: `${(EARN_CHART_TOP / EARN_CHART_HEIGHT) * 100}%`,
          }}
        />
        {[
          { color: "#FDAFB1", top: pointTop(hoverPoint.highY) },
          { color: "#F9363C", top: pointTop(hoverPoint.y) },
          { color: "#FDAFB1", top: pointTop(hoverPoint.lowY) },
        ].map((dot) => (
          <span
            aria-hidden="true"
            key={`${dot.color}-${dot.top}`}
            style={{
              background: dot.color,
              borderRadius: "9999px",
              height: "8px",
              left: `${hoverLeft}%`,
              pointerEvents: "none",
              position: "absolute",
              top: `${dot.top}%`,
              transform: "translate(-50%, -50%)",
              width: "8px",
            }}
          />
        ))}
        <div
          style={{
            background: "#F5F5F5",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            left: `${tooltipLeft}%`,
            overflow: "hidden",
            padding: "8px 12px",
            pointerEvents: "none",
            position: "absolute",
            top: 0,
            transform: "translateX(-50%)",
            width: "200px",
          }}
        >
          <span
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "20px",
              fontWeight: 600,
              lineHeight: "24px",
            }}
          >
            ${formatMoney(hoverPoint.value).split(".")[0]}
            <span style={{ color: "rgba(60, 60, 67, 0.4)" }}>
              .{formatMoney(hoverPoint.value).split(".")[1]}
            </span>
          </span>
          <span
            style={{
              color: secondary,
              display: "flex",
              flexDirection: "column",
              fontFamily: font,
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "16px",
            }}
          >
            <span>{hoverPoint.date}</span>
            <span>
              <span style={{ color: "#000" }}>
                +{formatMoney(hoverPoint.yieldUsd)} USDC{" "}
              </span>
              yield
            </span>
            <span>with 8.46% simulated APY</span>
            <span>Range: 7% – 9%</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function EarnDepositView({
  onComplete,
  onClose,
  sources = FALLBACK_EARN_DEPOSIT_SOURCES,
}: {
  onComplete?: () => void;
  onClose?: () => void;
  sources?: EarnDepositSourceOption[];
}) {
  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const [depositStep, setDepositStep] = useState<"overview" | "amount">(
    "overview"
  );
  const [screenTransition, setScreenTransition] = useState<
    "back" | "forward" | null
  >(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [isYieldMenuOpen, setIsYieldMenuOpen] = useState(false);
  const [isYieldMenuClosing, setIsYieldMenuClosing] = useState(false);
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const [isSourceMenuClosing, setIsSourceMenuClosing] = useState(false);
  const [selectionPulseId, setSelectionPulseId] =
    useState<(typeof EARN_DEPOSIT_VAULTS)[number]["id"] | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [selectedVaultId, setSelectedVaultId] =
    useState<(typeof EARN_DEPOSIT_VAULTS)[number]["id"]>("kamino");
  const sourceOptions =
    sources.length > 0 ? sources : FALLBACK_EARN_DEPOSIT_SOURCES;
  const [selectedSourceId, setSelectedSourceId] = useState(
    sourceOptions[0]?.id ?? FALLBACK_EARN_DEPOSIT_SOURCES[0].id
  );
  const selectedVault =
    EARN_DEPOSIT_VAULTS.find((vault) => vault.id === selectedVaultId) ??
    EARN_DEPOSIT_VAULTS[0];
  const selectedSource =
    sourceOptions.find((source) => source.id === selectedSourceId) ??
    sourceOptions[0] ??
    FALLBACK_EARN_DEPOSIT_SOURCES[0];
  const selectedSourceBalance = Number.parseFloat(
    `${selectedSource.balanceWhole}.${selectedSource.balanceFraction}`.replace(
      /,/g,
      ""
    )
  );
  const numericDepositAmount =
    Number.parseFloat(depositAmount.replace(/,/g, "")) || 0;
  const hasDepositAmount = depositAmount.length > 0;
  const depositUsdDisplay = hasDepositAmount
    ? `$${depositAmount}${depositAmount.includes(".") ? "" : ".00"}`
    : "$0.00";
  const amountError =
    hasDepositAmount && numericDepositAmount < MIN_DEPOSIT_USDC
      ? `Minimum deposit is ${MIN_DEPOSIT_USDC} USDC`
      : hasDepositAmount && numericDepositAmount > selectedSourceBalance
        ? "Insufficient balance"
        : null;
  const isDepositButtonDisabled = !hasDepositAmount || amountError !== null;
  const shouldShowYieldMenu = isYieldMenuOpen || isYieldMenuClosing;
  const shouldShowSourceMenu = isSourceMenuOpen || isSourceMenuClosing;
  const openYieldMenu = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsYieldMenuClosing(false);
    setIsYieldMenuOpen(true);
  };
  const closeYieldMenu = () => {
    if (!isYieldMenuOpen || isYieldMenuClosing) return;
    setIsYieldMenuClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setIsYieldMenuOpen(false);
      setIsYieldMenuClosing(false);
      closeTimerRef.current = null;
    }, 180);
  };
  const toggleYieldMenu = () => {
    if (isYieldMenuClosing) {
      openYieldMenu();
      return;
    }
    if (isYieldMenuOpen) {
      closeYieldMenu();
      return;
    }
    openYieldMenu();
  };
  const handleYieldSelect = (
    vaultId: (typeof EARN_DEPOSIT_VAULTS)[number]["id"]
  ) => {
    setSelectedVaultId(vaultId);
    setSelectionPulseId(vaultId);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => {
      setSelectionPulseId(null);
      pulseTimerRef.current = null;
    }, 260);
    closeYieldMenu();
  };
  const openSourceMenu = () => {
    if (sourceCloseTimerRef.current) {
      clearTimeout(sourceCloseTimerRef.current);
      sourceCloseTimerRef.current = null;
    }
    setIsSourceMenuClosing(false);
    setIsSourceMenuOpen(true);
  };
  const closeSourceMenu = () => {
    if (!isSourceMenuOpen || isSourceMenuClosing) return;
    setIsSourceMenuClosing(true);
    sourceCloseTimerRef.current = setTimeout(() => {
      setIsSourceMenuOpen(false);
      setIsSourceMenuClosing(false);
      sourceCloseTimerRef.current = null;
    }, 180);
  };
  const toggleSourceMenu = () => {
    if (isSourceMenuClosing) {
      openSourceMenu();
      return;
    }
    if (isSourceMenuOpen) {
      closeSourceMenu();
      return;
    }
    openSourceMenu();
  };
  const handleSourceSelect = (sourceId: string) => {
    setSelectedSourceId(sourceId);
    closeSourceMenu();
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      if (sourceCloseTimerRef.current) {
        clearTimeout(sourceCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!sourceOptions.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(sourceOptions[0]?.id ?? FALLBACK_EARN_DEPOSIT_SOURCES[0].id);
    }
  }, [selectedSourceId, sourceOptions]);

  useEffect(() => {
    if (depositStep !== "amount") return;
    const frame = window.requestAnimationFrame(() => {
      amountInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [depositStep]);

  const handleOverviewPrimaryClick = () => {
    if (isYieldMenuOpen) {
      closeYieldMenu();
      return;
    }
    setScreenTransition("forward");
    setDepositStep("amount");
  };

  if (depositStep === "amount") {
    return (
      <div
        className={
          screenTransition === "forward" ? "earn-deposit-screen-forward" : ""
        }
        style={{
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
          width: "100%",
        }}
      >
        <style jsx>{`
          .earn-deposit-max:hover,
          .earn-deposit-submit:not(:disabled):hover {
            background: #222 !important;
          }
          .earn-deposit-amount-input::selection {
            background: rgba(249, 54, 60, 0.18);
          }
          .earn-deposit-amount-input::placeholder {
            color: rgba(60, 60, 67, 0.4);
            opacity: 1;
          }
          .earn-deposit-screen-forward {
            animation: earn-deposit-screen-forward 0.24s
              cubic-bezier(0.2, 0, 0, 1) both;
          }
          .earn-source-sheet {
            animation: earn-source-sheet-open 0.18s ease forwards;
            transform-origin: top center;
          }
          .earn-source-sheet-closing {
            animation: earn-source-sheet-close 0.18s ease forwards;
            pointer-events: none;
          }
          @keyframes earn-source-sheet-open {
            0% {
              opacity: 0;
              transform: translateY(-6px) scale(0.985);
            }
            100% {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          @keyframes earn-source-sheet-close {
            0% {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
            100% {
              opacity: 0;
              transform: translateY(-6px) scale(0.985);
            }
          }
          @keyframes earn-deposit-screen-forward {
            0% {
              opacity: 0;
              transform: translateX(20px);
            }
            100% {
              opacity: 1;
              transform: translateX(0);
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .earn-deposit-screen-forward {
              animation: none;
            }
          }
        `}</style>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between",
            padding: "16px 20px 8px",
          }}
        >
          <div style={{ display: "flex", paddingRight: "12px" }}>
            <BackButton
              onClick={() => {
                if (isSourceMenuOpen) closeSourceMenu();
                setScreenTransition("back");
                setDepositStep("overview");
              }}
            />
          </div>
          <h2
            style={{
              color: "#000",
              flex: 1,
              fontFamily: font,
              fontSize: "20px",
              fontWeight: 600,
              lineHeight: "28px",
              margin: 0,
              minWidth: 0,
            }}
          >
            Deposit
          </h2>
          <CloseButton onClick={onClose} />
        </div>

        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            minHeight: 0,
            overflowY: "auto",
            scrollbarWidth: "none",
            width: "100%",
          }}
        >
          <section
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "30px 8px 8px",
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                padding: "8px 12px",
                width: "100%",
              }}
            >
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "4px",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    alignItems: "baseline",
                    display: "flex",
                    flex: 1,
                    gap: "8px",
                    minWidth: 0,
                  }}
                >
                  <input
                    className="earn-deposit-amount-input"
                    inputMode="decimal"
                    ref={amountInputRef}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "" || /^[\d,]*\.?\d*$/.test(value)) {
                        setDepositAmount(value);
                      }
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#000",
                      flexShrink: 1,
                      fontFamily: font,
                      fontSize: "40px",
                      fontWeight: 600,
                      lineHeight: "48px",
                      minWidth: 0,
                      outline: "none",
                      padding: 0,
                      width: `${Math.max(depositAmount.length, 1)}ch`,
                    }}
                    placeholder="0"
                    type="text"
                    value={depositAmount}
                  />
                  <span
                    style={{
                      color: "rgba(60, 60, 67, 0.4)",
                      fontFamily: font,
                      fontSize: "28px",
                      fontWeight: 600,
                      lineHeight: "32px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    USDC
                  </span>
                </div>
                <button
                  className="earn-deposit-max"
                  onClick={() => setDepositAmount("1,000")}
                  style={{
                    background: "#000",
                    border: "none",
                    borderRadius: "9999px",
                    color: "#fff",
                    cursor: "pointer",
                    flexShrink: 0,
                    fontFamily: font,
                    fontSize: "14px",
                    fontWeight: 500,
                    lineHeight: "20px",
                    padding: "6px 16px",
                    transition: "background 0.15s ease",
                  }}
                  type="button"
                >
                  MAX
                </button>
              </div>
              <span
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                }}
              >
                {depositUsdDisplay}
              </span>
            </div>
          </section>

          <section
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "8px",
              position: "relative",
              width: "100%",
              zIndex: 2,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
              <div style={{ padding: "3px 12px 1px" }}>
                <p
                  style={{
                    color: secondary,
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    margin: 0,
                    padding: "12px 0 4px",
                  }}
                >
                  From
                </p>
              </div>
              <DepositSourceRow
                isOpen={isSourceMenuOpen}
                isTrigger
                onClick={toggleSourceMenu}
                source={selectedSource}
              />
              {shouldShowSourceMenu ? (
                <div
                  className={`earn-source-sheet ${
                    isSourceMenuClosing ? "earn-source-sheet-closing" : ""
                  }`}
                  style={{
                    backdropFilter: "blur(16px)",
                    background: "rgba(255, 255, 255, 0.7)",
                    borderRadius: "16px",
                    boxShadow:
                      "0 0 2px rgba(0, 0, 0, 0.08), 0 4px 16px rgba(0, 0, 0, 0.08)",
                    display: "flex",
                    flexDirection: "column",
                    left: "8px",
                    overflow: "hidden",
                    padding: "8px",
                    position: "absolute",
                    right: "8px",
                    top: "108px",
                    WebkitBackdropFilter: "blur(16px)",
                    zIndex: 4,
                  }}
                >
                  {sourceOptions.map((source, index) => (
                    <DepositSourceRow
                      isHighlighted={
                        source.id !== selectedSource.id &&
                        index ===
                          Math.min(
                            sourceOptions.findIndex(
                              (option) => option.id === selectedSource.id
                            ) + 1,
                            sourceOptions.length - 1
                          )
                      }
                      isSelected={source.id === selectedSource.id}
                      key={source.id}
                      onClick={() => handleSourceSelect(source.id)}
                      source={source}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
              <div style={{ padding: "3px 12px 1px" }}>
                <p
                  style={{
                    color: secondary,
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    margin: 0,
                    padding: "12px 0 4px",
                  }}
                >
                  To
                </p>
              </div>
              <DepositVaultRow vault={selectedVault} />
            </div>
          </section>
        </div>

        <div
          style={{
            background: "linear-gradient(to bottom, rgba(255,255,255,0), #fff 28%)",
            padding: "16px 32px 24px",
            width: "100%",
          }}
        >
          <button
            className="earn-deposit-submit"
            disabled={isDepositButtonDisabled}
            onClick={onComplete}
            style={{
              alignItems: "center",
              background: amountError
                ? "rgba(249, 54, 60, 0.14)"
                : isDepositButtonDisabled
                  ? "rgba(0, 0, 0, 0.04)"
                  : "#000",
              border: "none",
              borderRadius: "78px",
              color: amountError
                ? "#F9363C"
                : isDepositButtonDisabled
                  ? secondary
                  : "#fff",
              cursor: isDepositButtonDisabled ? "default" : "pointer",
              display: "flex",
              fontFamily: font,
              fontSize: "17px",
              fontWeight: 500,
              height: "50px",
              justifyContent: "center",
              lineHeight: "22px",
              padding: "15px 12px",
              transition: "background 0.15s ease",
              width: "100%",
            }}
            type="button"
          >
            {amountError ?? "Deposit"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={screenTransition === "back" ? "earn-deposit-screen-back" : ""}
      style={{
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <style jsx>{`
        .earn-deposit-next:hover {
          background: #222 !important;
        }
        .earn-deposit-screen-back {
          animation: earn-deposit-screen-back 0.24s
            cubic-bezier(0.2, 0, 0, 1) both;
        }
        .earn-yield-sheet {
          animation: earn-yield-sheet-open 0.18s ease forwards;
          transform-origin: top center;
        }
        .earn-yield-sheet-closing {
          animation: earn-yield-sheet-close 0.18s ease forwards;
          pointer-events: none;
        }
        @keyframes earn-yield-sheet-open {
          0% {
            opacity: 0;
            transform: translateY(-6px) scale(0.985);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes earn-yield-sheet-close {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-6px) scale(0.985);
          }
        }
        @keyframes earn-deposit-screen-back {
          0% {
            opacity: 0;
            transform: translateX(-20px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .earn-deposit-screen-back {
            animation: none;
          }
        }
      `}</style>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          padding: "16px 20px 8px",
        }}
      >
        <h2
          style={{
            color: "#000",
            flex: 1,
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            lineHeight: "28px",
            margin: 0,
            minWidth: 0,
          }}
        >
          Deposit
        </h2>
        <CloseButton onClick={onClose} />
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          minHeight: 0,
          overflowY: "auto",
          scrollbarWidth: "none",
          width: "100%",
        }}
      >
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "8px",
            position: "relative",
            width: "100%",
            zIndex: 2,
          }}
        >
          <div style={{ padding: "3px 12px 1px" }}>
            <p
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                margin: 0,
                padding: "12px 0 4px",
              }}
            >
              Earn with
            </p>
          </div>
          <DepositVaultRow
            isOpen={isYieldMenuOpen}
            isPulsing={selectionPulseId === selectedVault.id}
            isTrigger
            onClick={toggleYieldMenu}
            vault={selectedVault}
          />
          {shouldShowYieldMenu ? (
            <div
              className={`earn-yield-sheet ${
                isYieldMenuClosing ? "earn-yield-sheet-closing" : ""
              }`}
              style={{
                backdropFilter: "blur(16px)",
                background: "rgba(255, 255, 255, 0.7)",
                borderRadius: "16px",
                boxShadow:
                  "0 0 2px rgba(0, 0, 0, 0.08), 0 4px 16px rgba(0, 0, 0, 0.08)",
                display: "flex",
                flexDirection: "column",
                left: "8px",
                overflow: "hidden",
                padding: "8px",
                position: "absolute",
                right: "8px",
                top: "116px",
                WebkitBackdropFilter: "blur(16px)",
                zIndex: 4,
              }}
            >
              {EARN_DEPOSIT_VAULTS.map((vault) => (
                <DepositVaultRow
                  isHighlighted={vault.id !== selectedVaultId}
                  isPulsing={selectionPulseId === vault.id}
                  isSelected={vault.id === selectedVaultId}
                  key={vault.id}
                  onClick={() => handleYieldSelect(vault.id)}
                  vault={vault}
                />
              ))}
            </div>
          ) : null}
        </section>

        <section style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, padding: "8px", width: "100%" }}>
          <div style={{ padding: "3px 12px 1px" }}>
            <p
              style={{
                color: secondary,
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                margin: 0,
                padding: "12px 0 4px",
              }}
            >
              Estimated earnings
            </p>
          </div>
          <div style={{ padding: "12px", width: "100%" }}>
            <DepositChart />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                overflow: "hidden",
                paddingTop: "8px",
                width: "100%",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ color: secondary, fontFamily: font, fontSize: "13px", lineHeight: "16px" }}>
                  May 2026
                </span>
                <span style={{ color: "#000", fontFamily: font, fontSize: "16px", fontWeight: 500, lineHeight: "20px" }}>
                  $1,000<span style={{ color: "rgba(60, 60, 67, 0.4)" }}>.00</span>
                </span>
              </div>
              <div style={{ alignItems: "flex-end", display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ color: secondary, fontFamily: font, fontSize: "13px", lineHeight: "16px" }}>
                  May 2027
                </span>
                <span style={{ alignItems: "center", color: "#34C759", display: "flex", fontFamily: font, fontSize: "16px", fontWeight: 500, gap: "4px", lineHeight: "20px" }}>
                  $1,120.48
                  <span style={{ alignItems: "center", background: "#34C759", borderRadius: "4px", display: "inline-flex", height: "16px", justifyContent: "center", width: "16px" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" aria-hidden="true" src="/wallet-workspace/earn-growth-arrow.svg" style={{ height: "12px", width: "12px" }} />
                  </span>
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div
        style={{
          background: "linear-gradient(to bottom, rgba(255,255,255,0), #fff 28%)",
          padding: "16px 32px 24px",
          width: "100%",
        }}
      >
        <button
          className="earn-deposit-next"
          onClick={handleOverviewPrimaryClick}
          style={{
            alignItems: "center",
            background: "#000",
            border: "none",
            borderRadius: "78px",
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            fontFamily: font,
            fontSize: "17px",
            fontWeight: 500,
            height: "50px",
            justifyContent: "center",
            lineHeight: "22px",
            padding: "15px 12px",
            width: "100%",
          }}
          type="button"
        >
          {isYieldMenuOpen ? "Select" : "Next"}
        </button>
      </div>
    </div>
  );
}
