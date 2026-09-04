export const AutomationReadinessFlow = () => {
  const nodes = [
    ["Trigger", "What starts it?"],
    ["Action", "What may happen?"],
    ["Limits", "What must stay inside the boundary?"],
    ["Proof", "How can the result be verified?"],
    ["Exit", "How can access be removed?"],
  ];

  return (
    <>
      <style>{`
        .loyal-readiness-flow {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 1.55rem;
          margin: 1.35rem 0 1.6rem;
          padding: 0;
          list-style: none;
        }
        .loyal-readiness-flow__node {
          position: relative;
          min-width: 0;
          border: 1px solid rgba(127, 127, 127, 0.24);
          border-radius: 1rem;
          padding: 0.9rem;
          background: rgba(127, 127, 127, 0.04);
        }
        .loyal-readiness-flow__node:not(:last-child)::after {
          position: absolute;
          top: 50%;
          right: -1.35rem;
          width: 1rem;
          color: #cd1d09;
          content: "→";
          font-size: 1.1rem;
          font-weight: 700;
          line-height: 1;
          text-align: center;
          transform: translateY(-50%);
        }
        .loyal-readiness-flow__title {
          display: block;
          margin-bottom: 0.45rem;
          color: #cd1d09;
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }
        .loyal-readiness-flow__detail {
          margin: 0;
          color: rgba(127, 127, 127, 0.98);
          font-size: 0.78rem;
          line-height: 1.45;
        }
        @media (max-width: 900px) {
          .loyal-readiness-flow {
            grid-template-columns: 1fr;
            gap: 0.65rem;
          }
          .loyal-readiness-flow__node:not(:last-child)::after {
            display: none;
          }
        }
      `}</style>

      <ol
        className="loyal-readiness-flow"
        aria-label="The five questions every automation must answer"
      >
        {nodes.map(([title, detail]) => (
          <li className="loyal-readiness-flow__node" key={title}>
            <span className="loyal-readiness-flow__title">{title}</span>
            <p className="loyal-readiness-flow__detail">{detail}</p>
          </li>
        ))}
      </ol>
    </>
  );
};
