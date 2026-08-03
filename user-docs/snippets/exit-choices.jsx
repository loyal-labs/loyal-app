export const ExitChoices = () => {
  const choices = [
    ["Pause new sweeps", "No new Loyal-scheduled sweep", "Access and Earn position stay"],
    ["Withdraw", "Funds leave the lending position", "Recurring access stays"],
    ["Close recurring access", "Future sweep authority ends", "Existing Earn position may stay"],
    ["Full Earn exit", "Position is emptied and access is removed", "Requires the complete approved flow"],
  ];

  return (
    <>
    <style>{`
      .loyal-exit-map {
        margin: 1.25rem 0 1.6rem;
      }
      .loyal-exit-map__origin {
        width: fit-content;
        margin: 0 auto 1.25rem;
        border-radius: 999px;
        padding: 0.55rem 0.9rem;
        background: rgba(205, 29, 9, 0.1);
        color: #cd1d09;
        font-size: 0.75rem;
        font-weight: 750;
      }
      .loyal-exit-map__choices {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
      }
      .loyal-exit-map__choice {
        position: relative;
        border: 1px solid rgba(127, 127, 127, 0.24);
        border-radius: 1rem;
        padding: 1rem;
        background: rgba(127, 127, 127, 0.04);
      }
      .loyal-exit-map__choice::before {
        position: absolute;
        top: -1.2rem;
        left: 50%;
        color: #cd1d09;
        content: "↙";
        font-weight: 750;
      }
      .loyal-exit-map__choice:nth-child(even)::before {
        content: "↘";
      }
      .loyal-exit-map__choice strong {
        display: block;
        margin-bottom: 0.55rem;
      }
      .loyal-exit-map__effect,
      .loyal-exit-map__remains {
        display: block;
        margin: 0;
        font-size: 0.8rem;
        line-height: 1.45;
      }
      .loyal-exit-map__remains {
        margin-top: 0.65rem;
        border-top: 1px solid rgba(127, 127, 127, 0.16);
        padding-top: 0.65rem;
        color: rgba(127, 127, 127, 0.98);
      }
      @media (max-width: 720px) {
        .loyal-exit-map__choices {
          grid-template-columns: 1fr;
        }
        .loyal-exit-map__choice::before,
        .loyal-exit-map__choice:nth-child(even)::before {
          content: "↓";
        }
      }
    `}</style>

    <div className="loyal-exit-map">
      <div className="loyal-exit-map__origin">Choose the intended outcome</div>
      <div className="loyal-exit-map__choices">
        {choices.map(([title, effect, remains]) => (
          <div className="loyal-exit-map__choice" key={title}>
            <strong>{title}</strong>
            <p className="loyal-exit-map__effect">{effect}</p>
            <p className="loyal-exit-map__remains">{remains}</p>
          </div>
        ))}
      </div>
    </div>
    </>
  );
};
