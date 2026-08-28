"use client";

import { useState } from "react";

const YIELD_PCT = 8;
const USER_PCT = 5;
const BUSINESS_PCT = 3;

const dollars = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/** The one picture that carries the pitch: user balances earn about 8% in
 *  Kamino, the business decides the split. Drag the slider to see the
 *  revenue line at any deposit base. Numbers are illustrative by design. */
export function YieldSplit() {
  const [millions, setMillions] = useState(10);
  const base = millions * 1_000_000;
  const total = (base * YIELD_PCT) / 100;
  const toUsers = (base * USER_PCT) / 100;
  const toBusiness = (base * BUSINESS_PCT) / 100;

  return (
    <div className="split-card">
      <label className="split-slider">
        <span className="split-caption">Your users&apos; active deposits</span>
        <strong>{dollars(base)}</strong>
        <input
          aria-label="Active deposits in millions of dollars"
          max={100}
          min={1}
          onChange={(event) => setMillions(Number(event.target.value))}
          step={1}
          type="range"
          value={millions}
        />
      </label>

      <div className="split-total">
        <span className="split-caption">Kamino yield at {YIELD_PCT}%</span>
        <strong>{dollars(total)}<small>/yr</small></strong>
      </div>

      <div aria-hidden="true" className="split-bar">
        <i className="users" style={{ width: `${(USER_PCT / YIELD_PCT) * 100}%` }} />
        <i className="business" style={{ width: `${(BUSINESS_PCT / YIELD_PCT) * 100}%` }} />
      </div>

      <div className="split-rows">
        <div className="split-row users">
          <i />
          <span>Your users earn {USER_PCT}%</span>
          <b>{dollars(toUsers)}</b>
        </div>
        <div className="split-row business">
          <i />
          <span>You keep {BUSINESS_PCT}%</span>
          <b>{dollars(toBusiness)}<small>/yr</small></b>
        </div>
      </div>

      <p className="split-note">
        Illustrative at {YIELD_PCT}%. Live Kamino rates float; the split is set
        in your contract.
      </p>
    </div>
  );
}
