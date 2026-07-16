"use client";

import { useEffect, useRef } from "react";

import { captureBrowserError } from "@/features/observability/client";

export default function AppError({
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
    captureBrowserError(error, "react.error_boundary");
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
      <h1 className="font-semibold text-2xl">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground text-sm">
        We could not finish loading this page. You can safely try again.
      </p>
      <button
        className="rounded-full bg-foreground px-5 py-2 font-medium text-background text-sm"
        onClick={reset}
        type="button"
      >
        Try again
      </button>
    </main>
  );
}
