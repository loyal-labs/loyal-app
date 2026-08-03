export const AuthorityMap = () => (
  <>
    <style>{`
      .loyal-authority-map {
        margin: 1.25rem 0 1.5rem;
        border: 1px solid rgba(127, 127, 127, 0.22);
        border-radius: 1.15rem;
        padding: 1rem;
        background: rgba(127, 127, 127, 0.035);
      }
      .loyal-authority-branches {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.85rem;
      }
      .loyal-authority-branch {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }
      .loyal-authority-node {
        border-radius: 0.85rem;
        padding: 0.9rem;
        background: rgba(127, 127, 127, 0.07);
      }
      .loyal-authority-node--owner {
        background: rgba(205, 29, 9, 0.09);
      }
      .loyal-authority-node--gate {
        border: 1px solid rgba(205, 29, 9, 0.35);
        background: transparent;
      }
      .loyal-authority-node--shared,
      .loyal-authority-node--exit {
        width: min(100%, 29rem);
        box-sizing: border-box;
        margin: 0 auto;
      }
      .loyal-authority-node--shared {
        border: 1px solid rgba(205, 29, 9, 0.5);
        background: rgba(205, 29, 9, 0.09);
        text-align: center;
      }
      .loyal-authority-node--exit {
        text-align: center;
      }
      .loyal-authority-kicker {
        display: block;
        margin-bottom: 0.4rem;
        color: #cd1d09;
        font-size: 0.66rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .loyal-authority-node strong {
        display: block;
        margin-bottom: 0.3rem;
        font-size: 0.92rem;
      }
      .loyal-authority-node p {
        margin: 0;
        color: rgba(127, 127, 127, 0.98);
        font-size: 0.8rem;
        line-height: 1.45;
      }
      .loyal-authority-arrow {
        display: block;
        color: #cd1d09;
        font-weight: 700;
        line-height: 1;
        text-align: center;
      }
      .loyal-authority-converge {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin: 0.45rem auto;
        color: #cd1d09;
        font-size: 1.2rem;
        font-weight: 700;
      }
      .loyal-authority-converge span {
        text-align: center;
      }
      .loyal-authority-exit-arrow {
        margin: 0.5rem 0;
      }
      @media (max-width: 520px) {
        .loyal-authority-map {
          padding: 0.75rem;
        }
        .loyal-authority-branches {
          gap: 0.55rem;
        }
        .loyal-authority-node {
          padding: 0.75rem;
        }
        .loyal-authority-node strong {
          font-size: 0.84rem;
        }
        .loyal-authority-node p {
          font-size: 0.75rem;
        }
      }
    `}</style>

    <div
      className="loyal-authority-map"
      role="figure"
      aria-label="Customer control and Loyal's limited authority"
    >
      <div className="loyal-authority-branches">
        <div className="loyal-authority-branch loyal-authority-branch--customer">
          <div className="loyal-authority-node loyal-authority-node--owner">
            <span className="loyal-authority-kicker">Root authority</span>
            <strong>Customer wallet</strong>
            <p>Approves setup or exit.</p>
          </div>
        </div>

        <div className="loyal-authority-branch">
          <div className="loyal-authority-node">
            <span className="loyal-authority-kicker">Limited authority</span>
            <strong>Loyal signer</strong>
            <p>Runs the approved Earn job.</p>
          </div>
          <span className="loyal-authority-arrow" aria-hidden="true">
            ↓
          </span>
          <div className="loyal-authority-node loyal-authority-node--gate">
            <span className="loyal-authority-kicker">Boundary</span>
            <strong>Approved rule</strong>
            <p>Checks the approved action and limit. Rejects anything else.</p>
          </div>
        </div>
      </div>

      <div className="loyal-authority-converge" aria-hidden="true">
        <span>↘</span>
        <span>↙</span>
      </div>

      <div className="loyal-authority-node loyal-authority-node--shared">
        <span className="loyal-authority-kicker">Customer-controlled account</span>
        <strong>Customer Smart Account</strong>
        <p>Controls the Earn vault and lending position.</p>
      </div>

      <span
        className="loyal-authority-arrow loyal-authority-exit-arrow"
        aria-hidden="true"
      >
        ↓
      </span>

      <div className="loyal-authority-node loyal-authority-node--exit">
        <span className="loyal-authority-kicker">Customer-signed exit</span>
        <strong>Withdraw or close</strong>
        <p>Returns funds or removes recurring sweep access.</p>
      </div>
    </div>
  </>
);
