"use client";

import { useEffect, useRef } from "react";

import { captureBrowserError } from "@/features/observability/client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const reportedError = useRef<Error | null>(null);

  useEffect(() => {
    if (reportedError.current === error) {
      return;
    }
    reportedError.current = error;
    captureBrowserError(error, "react.global_error_boundary");
  }, [error]);

  return (
    <html className="dark" lang="en">
      <body>
        <main
          style={{
            alignItems: "center",
            background: "#0a0a0a",
            color: "#fafafa",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "1.5rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
            Something went wrong
          </h1>
          <p style={{ color: "#a3a3a3", margin: 0, maxWidth: "28rem" }}>
            We could not finish loading Loyal. You can safely try again.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#fafafa",
              border: 0,
              borderRadius: "9999px",
              color: "#0a0a0a",
              cursor: "pointer",
              fontWeight: 600,
              padding: "0.625rem 1.25rem",
            }}
            type="button"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
