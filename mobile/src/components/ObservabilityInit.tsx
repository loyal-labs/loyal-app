import { usePathname } from "expo-router";
import { useEffect } from "react";

import {
  initObservability,
  setObservabilityPathname,
} from "@/services/observability";

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
  }, [pathname]);

  return null;
}
