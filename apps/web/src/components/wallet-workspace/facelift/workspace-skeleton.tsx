import React from "react";

// Shared by the initial Vite HTML, router fallback and session hydration.
export function WorkspacePaneSkeleton() {
  return (
    <section
      aria-label="Loading account"
      aria-busy="true"
      className="workspace-skeleton-pane"
      role="status"
    >
      <div aria-hidden="true" className="workspace-skeleton-content">
        <div className="workspace-skeleton-bar workspace-skeleton-title" />
        <div className="workspace-skeleton-bar workspace-skeleton-balance" />
        <div className="workspace-skeleton-bar workspace-skeleton-chart" />
        <div className="workspace-skeleton-bar workspace-skeleton-line" />
        <div className="workspace-skeleton-bar workspace-skeleton-line workspace-skeleton-short" />
      </div>
    </section>
  );
}

export function WorkspaceSkeleton() {
  return (
    <div
      aria-label="Loading app"
      aria-busy="true"
      className="workspace-skeleton"
      role="status"
    >
      <aside aria-hidden="true" className="workspace-skeleton-sidebar">
        <div className="workspace-skeleton-bar workspace-skeleton-title" />
        <div className="workspace-skeleton-bar workspace-skeleton-balance" />
        <div className="workspace-skeleton-nav">
          {["earn", "earnmax", "stables", "crypto"].map((page) => (
            <div className="workspace-skeleton-row" key={page}>
              <div className="workspace-skeleton-bar workspace-skeleton-icon" />
              <div className="workspace-skeleton-bar workspace-skeleton-line" />
            </div>
          ))}
        </div>
        <div className="workspace-skeleton-bar workspace-skeleton-footer" />
      </aside>
      <WorkspacePaneSkeleton />
      <aside aria-hidden="true" className="workspace-skeleton-rail">
        <div className="workspace-skeleton-bar workspace-skeleton-title" />
        <div className="workspace-skeleton-bar workspace-skeleton-chart" />
        <div className="workspace-skeleton-bar workspace-skeleton-line" />
        <div className="workspace-skeleton-bar workspace-skeleton-line workspace-skeleton-short" />
      </aside>
    </div>
  );
}
