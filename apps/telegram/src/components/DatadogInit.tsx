"use client";

import { useEffect } from "react";

export function DatadogInit() {
  useEffect(() => {
    void import("@/lib/core/datadog").then(({ initDatadog }) => initDatadog());
  }, []);

  return null;
}
