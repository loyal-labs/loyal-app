export const AuditRecord = ({ reviewer, scope, reviewDate, deployment }) => (
  <>
    <style>{`
      .loyal-audit-record {
        display: grid;
        grid-template-columns: minmax(7rem, 0.35fr) minmax(0, 1fr);
        margin: 0;
      }
      .loyal-audit-record__label,
      .loyal-audit-record__value {
        margin: 0;
        border-top: 1px solid rgba(127, 127, 127, 0.18);
        padding: 0.75rem 0;
        line-height: 1.5;
      }
      .loyal-audit-record__label:first-of-type,
      .loyal-audit-record__label:first-of-type + .loyal-audit-record__value {
        border-top: 0;
      }
      .loyal-audit-record__label {
        padding-right: 1rem;
        color: rgba(127, 127, 127, 0.98);
        font-size: 0.76rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .loyal-audit-record__value {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      @media (max-width: 620px) {
        .loyal-audit-record {
          grid-template-columns: 1fr;
        }
        .loyal-audit-record__label {
          border-top: 1px solid rgba(127, 127, 127, 0.18);
          padding: 0.8rem 0 0.2rem;
        }
        .loyal-audit-record__value {
          border-top: 0;
          padding: 0 0 0.8rem;
        }
      }
    `}</style>

    <dl className="loyal-audit-record">
      <dt className="loyal-audit-record__label">Reviewer</dt>
      <dd className="loyal-audit-record__value">{reviewer}</dd>
      <dt className="loyal-audit-record__label">Reviewed scope</dt>
      <dd className="loyal-audit-record__value">{scope}</dd>
      <dt className="loyal-audit-record__label">Review date</dt>
      <dd className="loyal-audit-record__value">{reviewDate}</dd>
      <dt className="loyal-audit-record__label">Deployment comparison</dt>
      <dd className="loyal-audit-record__value">{deployment}</dd>
    </dl>
  </>
);
