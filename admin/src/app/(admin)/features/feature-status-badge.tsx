import { Badge } from "@/components/ui/badge";
import type { FeatureStatus } from "@loyal-labs/db-core/schema";

const STATUS_STYLES = {
  missing: "bg-zinc-200 text-zinc-900",
  planned: "bg-sky-200 text-sky-950",
  in_progress: "bg-amber-200 text-amber-950",
  implemented: "bg-emerald-200 text-emerald-950",
  live: "bg-violet-200 text-violet-950",
} as const satisfies Record<FeatureStatus, string>;

export function FeatureStatusBadge({ status }: { status: FeatureStatus }) {
  return <Badge className={STATUS_STYLES[status]}>{status.replaceAll("_", " ")}</Badge>;
}
