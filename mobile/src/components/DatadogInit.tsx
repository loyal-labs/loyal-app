import { useEffect } from "react";

export function DatadogInit() {
  useEffect(() => {
    // Lazy-load the SDK so Expo Go / test environments that don't include the
    // native module never trip the import.
    void import("@/lib/datadog/datadog").then(({ initDatadog }) => initDatadog());
  }, []);

  return null;
}
