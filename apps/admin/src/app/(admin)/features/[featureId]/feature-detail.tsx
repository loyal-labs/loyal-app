import {
  type FeatureAppStatus,
  type FeatureEvidence,
  type FeatureFlagLink,
  type FeatureRegistry,
  type RuntimeFlag,
} from "@loyal-labs/db-core/schema";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { FeatureStatusBadge } from "../feature-status-badge";
import { updateFeatureStatus } from "./feature-detail-actions";
import { FeatureEvidenceForm } from "./feature-evidence-form";
import { LinkedFlagsPanel } from "./linked-flags-panel";

const APP_ORDER = ["telegram_miniapp", "website", "mobile", "extension"] as const;

type FeatureDetailFeature = FeatureRegistry & {
  appStatuses: (FeatureAppStatus & { evidence: FeatureEvidence[] })[];
  flagLinks: (FeatureFlagLink & { flag: RuntimeFlag })[];
};

function FeatureSummary({ feature }: { feature: FeatureDetailFeature }) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Key</p>
          <p className="mt-1 text-sm font-medium">{feature.key}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Owner</p>
          <p className="mt-1 text-sm font-medium">{feature.owner ?? "Unassigned"}</p>
        </div>
        <div className="md:col-span-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Description
          </p>
          <p className="mt-1 text-sm leading-6 text-foreground">{feature.description}</p>
        </div>
        {feature.notes ? (
          <div className="md:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notes
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{feature.notes}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function FeatureStatusCard({
  feature,
  appStatus,
}: {
  feature: FeatureDetailFeature;
  appStatus?: (FeatureAppStatus & { evidence: FeatureEvidence[] }) | undefined;
}) {
  const statusOptions = ["missing", "planned", "in_progress", "implemented", "live"] as const;

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold capitalize">
            {appStatus?.app.replaceAll("_", " ") ?? "Unknown app"}
          </h2>
          <p className="text-sm text-muted-foreground">Track the current status and evidence.</p>
        </div>
        {appStatus ? (
          <FeatureStatusBadge status={appStatus.status} />
        ) : (
          <Badge variant="outline">Missing</Badge>
        )}
      </div>

      {appStatus ? (
        <div className="space-y-6">
          <form action={updateFeatureStatus.bind(null, appStatus.id)} className="space-y-4">
            <input type="hidden" name="featureId" value={feature.id} />

            <label className="block">
              <span className="mb-1 block text-xs font-medium">Status</span>
              <select
                name="status"
                defaultValue={appStatus.status}
                className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium">Status note</span>
              <textarea
                name="statusNote"
                rows={3}
                defaultValue={appStatus.statusNote ?? ""}
                placeholder="Optional note about the current implementation state"
                className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive min-h-24 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
              />
            </label>

            <div className="flex justify-end">
              <Button type="submit" size="sm">
                Save status
              </Button>
            </div>
          </form>

          <FeatureEvidenceForm feature={feature} appStatus={appStatus} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          No app status row exists for this app.
        </div>
      )}
    </section>
  );
}

export function FeatureDetail({
  feature,
  availableFlags,
}: {
  feature: FeatureDetailFeature;
  availableFlags: RuntimeFlag[];
}) {
  return (
    <div className="grid gap-6">
      <FeatureSummary feature={feature} />

      {APP_ORDER.map((app) => {
        const row = feature.appStatuses.find((status) => status.app === app);

        return <FeatureStatusCard key={app} feature={feature} appStatus={row} />;
      })}

      <LinkedFlagsPanel feature={feature} availableFlags={availableFlags} />
    </div>
  );
}
