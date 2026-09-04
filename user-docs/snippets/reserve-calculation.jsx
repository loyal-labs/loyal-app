export const ReserveCalculation = () => (
  <>
    <style>{`
      .loyal-reserve-calc {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: center;
        gap: 0.7rem;
        margin: 1.25rem 0 1.6rem;
      }
      .loyal-reserve-calc__amount {
        min-width: 0;
        border: 1px solid rgba(127, 127, 127, 0.24);
        border-radius: 1rem;
        padding: 1rem;
        background: rgba(127, 127, 127, 0.04);
        text-align: center;
      }
      .loyal-reserve-calc__amount--result {
        border-color: rgba(205, 29, 9, 0.55);
        background: rgba(205, 29, 9, 0.08);
      }
      .loyal-reserve-calc__value {
        display: block;
        font-size: clamp(1.3rem, 3vw, 2rem);
        font-weight: 750;
        line-height: 1.1;
      }
      .loyal-reserve-calc__label {
        display: block;
        margin-top: 0.45rem;
        color: rgba(127, 127, 127, 0.98);
        font-size: 0.78rem;
      }
      .loyal-reserve-calc__operator {
        color: #cd1d09;
        font-size: 1.4rem;
        font-weight: 750;
      }
      @media (max-width: 720px) {
        .loyal-reserve-calc {
          grid-template-columns: 1fr;
        }
        .loyal-reserve-calc__operator {
          transform: rotate(90deg);
          text-align: center;
        }
      }
    `}</style>

    <div className="loyal-reserve-calc" aria-label="$10,000 balance minus $2,000 reserve leaves up to $8,000 eligible">
      <div className="loyal-reserve-calc__amount">
        <span className="loyal-reserve-calc__value">$10,000</span>
        <span className="loyal-reserve-calc__label">current balance</span>
      </div>
      <span className="loyal-reserve-calc__operator" aria-hidden="true">−</span>
      <div className="loyal-reserve-calc__amount">
        <span className="loyal-reserve-calc__value">$2,000</span>
        <span className="loyal-reserve-calc__label">customer reserve</span>
      </div>
      <span className="loyal-reserve-calc__operator" aria-hidden="true">=</span>
      <div className="loyal-reserve-calc__amount loyal-reserve-calc__amount--result">
        <span className="loyal-reserve-calc__value">up to $8,000</span>
        <span className="loyal-reserve-calc__label">eligible before the recurring cap</span>
      </div>
    </div>
  </>
);
