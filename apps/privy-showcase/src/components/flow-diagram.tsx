"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { UsdcAmount } from "@/components/usdc-amount";
import type { DemoMoveAction } from "@/lib/sponsor-protocol";

/** Tween a raw USDC amount toward its latest value with requestAnimationFrame
 *  (no timers), so balance changes read as movement instead of a silent swap. */
function useAnimatedUsdc(raw: bigint): { animating: boolean; value: bigint } {
  const [display, setDisplay] = useState(raw);
  const [animating, setAnimating] = useState(false);
  const shownRef = useRef(raw);

  useEffect(() => {
    const from = shownRef.current;
    if (from === raw) return;
    const delta = Number(raw - from);
    const start = performance.now();
    const durationMs = 700;
    let frame = 0;
    setAnimating(true);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + BigInt(Math.round(delta * eased));
      shownRef.current = value;
      setDisplay(value);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        shownRef.current = raw;
        setDisplay(raw);
        setAnimating(false);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [raw]);

  return { animating, value: display };
}

function FlowNode(props: {
  caption: string;
  extra?: ReactNode;
  icon: "earn" | "smart" | "usdc";
  raw: bigint;
  sub: string;
  unit?: string;
}) {
  const amount = useAnimatedUsdc(props.raw);
  return (
    <div className={`flow-node${amount.animating ? " pulsing" : ""}`}>
      <span className="flow-caption">
        <i aria-hidden="true" className={`flow-icon ${props.icon}`} />
        {props.caption}
      </span>
      <span className="flow-amount">
        <UsdcAmount raw={amount.value} unit={props.unit ?? "USDC"} />
      </span>
      <span className="flow-sub">{props.sub}</span>
      {props.extra}
    </div>
  );
}

function Lane(props: {
  active: boolean;
  direction: "forward" | "reverse";
  rule: string;
}) {
  return (
    <div className={`lane ${props.direction}${props.active ? " active" : ""}`}>
      <span className="lane-line">
        <i className="dot" />
      </span>
      <span className="rule-chip">{props.rule}</span>
    </div>
  );
}

/** Wallet ↔ smart account ↔ Kamino, with the four policies drawn as the
 *  gates on each directional lane. The lane whose policy authorizes the
 *  in-flight move lights up and animates while the backend executes it. */
export function FlowDiagram(props: {
  activeMove: DemoMoveAction | null;
  kaminoRaw: bigint;
  smartAccountRaw: bigint;
  walletRaw: bigint;
}) {
  return (
    <div className="flow">
      <FlowNode
        caption="In wallet"
        icon="usdc"
        raw={props.walletRaw}
        sub="Privy embedded wallet, the user's spendable cash"
      />
      <div className="flow-edge">
        <Lane
          active={props.activeMove === "wallet_to_smart_account"}
          direction="forward"
          rule="Pull 2 USDC · recurring"
        />
        <Lane
          active={props.activeMove === "smart_account_to_wallet"}
          direction="reverse"
          rule="Exit ≤ 10 USDC/day · this wallet only"
        />
      </div>
      <FlowNode
        caption="In smart account"
        icon="smart"
        raw={props.smartAccountRaw}
        sub="Loyal smart account, programmable and policy-guarded"
      />
      <div className="flow-edge">
        <Lane
          active={props.activeMove === "smart_account_to_kamino"}
          direction="forward"
          rule="Deposit · Main Market USDC only"
        />
        <Lane
          active={props.activeMove === "kamino_to_smart_account"}
          direction="reverse"
          rule="Withdraw · Main Market USDC only"
        />
      </div>
      <FlowNode
        caption="In Kamino"
        extra={
          props.kaminoRaw > 0n ? (
            <span className="earning-pill">Earning yield now</span>
          ) : undefined
        }
        icon="earn"
        raw={props.kaminoRaw}
        sub="Kamino Main Market, where idle cash works"
        unit="USDC est."
      />
    </div>
  );
}
