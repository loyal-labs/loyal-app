export const AutomationWalkthrough = () => {
  const steps = [
    {
      label: "1. Set the reserve",
      title: "Choose what stays available",
      metric: "$10,000",
      primary: "Keep $2,000 available",
      secondary: "Up to $8,000 is eligible",
      boundary: "Loyal checks the live balance before each sweep.",
    },
    {
      label: "2. Approve the rule",
      title: "Limit where money can go",
      metric: "USDC → Earn",
      primary: "Earn is the only allowed destination",
      secondary: "The customer sets the recurring limit",
      boundary: "Only the customer can approve or change the rule.",
    },
    {
      label: "3. Sweep and route",
      title: "Move only the eligible amount",
      metric: "$8,000 → Earn",
      primary: "Loyal submits the sweep",
      secondary: "USDC enters the selected lending market",
      boundary: "The transaction fails if its amount or destination breaks the rule.",
    },
    {
      label: "4. Stay in control",
      title: "Pause, withdraw, or remove access",
      primary: "Pause stops new Loyal-scheduled sweeps",
      secondary: "Withdraw funds or approve a close",
      boundary: "Only a confirmed, customer-approved close removes recurring sweep access.",
    },
  ];

  const [activeStep, setActiveStep] = useState(0);
  const selected = steps[activeStep];

  return (
    <>
      <style>{`
        .loyal-automation-demo {
          display: grid;
          grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
          gap: 0.85rem;
          margin: 1.25rem 0 1.6rem;
        }
        .loyal-automation-steps {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .loyal-automation-step {
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.7rem;
          width: 100%;
          border: 1px solid rgba(127, 127, 127, 0.24);
          border-radius: 0.9rem;
          padding: 0.9rem 1rem;
          background: transparent;
          color: inherit;
          cursor: pointer;
          font: inherit;
          font-weight: 600;
          text-align: left;
          transition: border-color 160ms ease, background 160ms ease,
            transform 160ms ease;
        }
        .loyal-automation-step:hover {
          border-color: #cd1d09;
          transform: translateY(-1px);
        }
        .loyal-automation-step[aria-pressed="true"] {
          border-color: #cd1d09;
          background: rgba(205, 29, 9, 0.08);
        }
        .loyal-automation-step-number {
          display: inline-grid;
          width: 1.65rem;
          height: 1.65rem;
          flex: 0 0 auto;
          place-items: center;
          border-radius: 999px;
          background: rgba(127, 127, 127, 0.12);
          color: inherit;
          font-size: 0.75rem;
          font-weight: 700;
        }
        .loyal-automation-step[aria-pressed="true"]
          .loyal-automation-step-number {
          background: #cd1d09;
          color: #ffffff;
        }
        .loyal-automation-panel {
          border-radius: 1.15rem;
          padding: 1.25rem;
          background: #111111;
          color: #ffffff;
          box-shadow: 0 18px 55px rgba(0, 0, 0, 0.16);
        }
        .loyal-automation-title {
          margin: 0;
          color: #ffffff;
          font-size: 1.25rem;
          line-height: 1.2;
        }
        .loyal-automation-metric {
          margin: 0.4rem 0 0.9rem;
          color: #ffffff;
          font-size: clamp(1.9rem, 4vw, 2.7rem);
          font-weight: 700;
          letter-spacing: -0.05em;
          line-height: 1;
        }
        .loyal-automation-flow {
          display: grid;
          gap: 0.55rem;
          border-top: 1px solid rgba(255, 255, 255, 0.15);
          padding-top: 1rem;
        }
        .loyal-automation-flow p {
          margin: 0;
          color: rgba(255, 255, 255, 0.78);
        }
        .loyal-automation-boundary {
          margin-top: 0.8rem;
          border-left: 3px solid #f9363c;
          padding-left: 0.85rem;
          color: #ffffff;
          font-size: 0.9rem;
        }
        .loyal-automation-boundary-label {
          display: block;
          margin-bottom: 0.15rem;
          color: rgba(255, 255, 255, 0.58);
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        @media (max-width: 760px) {
          .loyal-automation-demo {
            grid-template-columns: 1fr;
          }
          .loyal-automation-panel {
            min-height: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .loyal-automation-step {
            transition: none;
          }
          .loyal-automation-step:hover {
            transform: none;
          }
        }
      `}</style>

      <div
        className="loyal-automation-demo"
        aria-label="How a Loyal automation moves through four states"
      >
        <div className="loyal-automation-steps" role="group">
          {steps.map((step, index) => (
            <button
              aria-pressed={activeStep === index}
              className="loyal-automation-step"
              key={step.label}
              onClick={() => setActiveStep(index)}
              type="button"
            >
              <span className="loyal-automation-step-number">{index + 1}</span>
              <span>{step.label.replace(/^\d+\.\s*/, "")}</span>
            </button>
          ))}
        </div>

        <div className="loyal-automation-panel" aria-live="polite">
          <h3 className="loyal-automation-title">{selected.title}</h3>
          {selected.metric ? (
            <p className="loyal-automation-metric">{selected.metric}</p>
          ) : null}
          <div className="loyal-automation-flow">
            <p>{selected.primary}</p>
            <p>{selected.secondary}</p>
          </div>
          <p className="loyal-automation-boundary">
            <span className="loyal-automation-boundary-label">
              What limits this step
            </span>
            {selected.boundary}
          </p>
        </div>
      </div>
    </>
  );
};
