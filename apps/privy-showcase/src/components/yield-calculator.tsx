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

/** The closing argument: the deposits already exist, so drag the slider and
 *  watch what they would pay. Claim on the left, instrument on the right. */
export function YieldCalculator() {
  const [millions, setMillions] = useState(10);
  const base = millions * 1_000_000;

  return (
    <section className="calc">
      <div className="calc-claim">
        <h2>Make more money</h2>
      </div>
      <div className="calc-instrument">
        <span className="calc-caption">User balances</span>
        <span className="calc-value">{dollars(base)}</span>
        <input
          aria-label="User balances in millions of dollars"
          max={100}
          min={1}
          onChange={(event) => setMillions(Number(event.target.value))}
          step={1}
          type="range"
          value={millions}
        />
        <span className="calc-caption">You keep</span>
        <span className="calc-value calc-keep">
          {dollars((base * BUSINESS_PCT) / 100)}
          <small>/yr</small>
        </span>
        <p className="calc-note">
          Users earn {USER_PCT}%, you keep {BUSINESS_PCT}% of roughly{" "}
          {YIELD_PCT}% Kamino yield. Illustrative; rates float and the split is
          contracted.
        </p>
      </div>
    </section>
  );
}
