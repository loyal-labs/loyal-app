import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addFeatureEvidence } from "./feature-detail-actions";
import {
  type FeatureAppStatus,
  type FeatureEvidence,
  type FeatureRegistry,
} from "@loyal-labs/db-core/schema";

type FeatureEvidenceStatus = FeatureAppStatus & { evidence: FeatureEvidence[] };

const EVIDENCE_TYPES = ["path", "branch", "pr", "linear", "commit", "doc"] as const;

export function FeatureEvidenceForm({
  feature,
  appStatus,
}: {
  feature: FeatureRegistry;
  appStatus: FeatureEvidenceStatus;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Evidence</h3>
          <Badge variant="outline">{appStatus.evidence.length} item{appStatus.evidence.length === 1 ? "" : "s"}</Badge>
        </div>

        {appStatus.evidence.length > 0 ? (
          <div className="space-y-2">
            {appStatus.evidence.map((evidence) => (
              <div key={evidence.id} className="rounded-xl border bg-background p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{evidence.type.replaceAll("_", " ")}</Badge>
                  <span className="font-medium">{evidence.label}</span>
                </div>
                <p className="mt-1 break-words text-muted-foreground">{evidence.value}</p>
                {evidence.note ? (
                  <p className="mt-1 text-muted-foreground">{evidence.note}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No evidence has been attached yet.</p>
        )}
      </div>

      <form action={addFeatureEvidence} className="space-y-4 rounded-xl border bg-background p-4">
        <input type="hidden" name="featureId" value={feature.id} />
        <input type="hidden" name="featureAppStatusId" value={appStatus.id} />

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Type</span>
            <select
              name="type"
              defaultValue="path"
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
            >
              {EVIDENCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium">Label</span>
            <input
              name="label"
              type="text"
              required
              placeholder="e.g. roadmap doc"
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-medium">Value</span>
            <input
              name="value"
              type="text"
              required
              placeholder="Path, branch, PR URL, commit SHA, or doc URL"
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-medium">Note</span>
            <textarea
              name="note"
              rows={3}
              placeholder="Optional context for why this evidence matters"
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive min-h-24 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
            />
          </label>
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm">
            Add evidence
          </Button>
        </div>
      </form>
    </div>
  );
}
