import { usePathname } from "expo-router";
import { useEffect } from "react";

import {
  initObservability,
  setObservabilityPathname,
} from "@/services/observability";
import { setMobileLoadingMetricsPathname } from "@/services/loading-metrics";

/**
 * Installs the ClickStack global error hooks and keeps the reporter's
 * pathname in sync with the active route. Renders nothing.
 */
export function ObservabilityInit() {
  const pathname = usePathname();

  useEffect(() => {
    initObservability();
  }, []);

  useEffect(() => {
    setObservabilityPathname(pathname);
    setMobileLoadingMetricsPathname(pathname);
  }, [pathname]);

  return null;
}
