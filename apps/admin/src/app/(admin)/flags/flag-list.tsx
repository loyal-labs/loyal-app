"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { FlagAudience, FlagTargetEnvironment } from "@loyal-labs/db-core/schema";

import {
  deleteRuntimeFlag,
  linkFlagToFeature,
  toggleRuntimeFlag,
  unlinkFlagFromFeature,
  updateRuntimeFlag,
} from "./actions";

const ENVIRONMENTS = [
  { value: "development", label: "Development" },
  { value: "preview", label: "Preview" },
  { value: "production", label: "Production" },
] as const;

const AUDIENCE_OPTIONS = [
  { value: "all", label: "All users" },
  { value: "public", label: "Public users" },
  { value: "team", label: "Team only" },
] as const;

type FlagListItem = {
  id: string;
  key: string;
  description: string;
  enabled: boolean;
  audience: FlagAudience;
  targetEnvironments: FlagTargetEnvironment[];
  notes: string | null;
  linkedFeatures: Array<{
    linkId: string;
    id: string;
    title: string;
    key: string;
  }>;
};

type FeatureOption = {
  id: string;
  title: string;
  key: string;
};

function FlagRow({
  flag,
  availableFeatures,
}: {
  flag: FlagListItem;
  availableFeatures: FeatureOption[];
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(flag.enabled);
  const [pending, startTransition] = useTransition();
  const linkedFeatureIds = new Set(flag.linkedFeatures.map((feature) => feature.id));
  const linkableFeatures = availableFeatures.filter(
    (feature) => !linkedFeatureIds.has(feature.id),
  );

  useEffect(() => {
    setChecked(flag.enabled);
  }, [flag.enabled]);

  function handleChange(nextChecked: boolean) {
    const previousChecked = checked;
    setChecked(nextChecked);

    startTransition(async () => {
      try {
        await toggleRuntimeFlag(flag.id, nextChecked);
        router.refresh();
      } catch {
        setChecked(previousChecked);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 md:flex-row md:items-center md:justify-between">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{flag.key}</p>
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {flag.audience}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {flag.targetEnvironments.join(", ")}
          </span>
          <span
            className={[
              "rounded-full border px-2 py-0.5 text-xs",
              flag.enabled
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                : "text-muted-foreground",
            ].join(" ")}
          >
            {flag.enabled ? "enabled" : "disabled"}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{flag.description}</p>
        <p className="text-xs text-muted-foreground">
          {flag.linkedFeatures.length > 0
            ? "Linked features:"
            : "Linked features: none"}
        </p>
        {flag.linkedFeatures.length > 0 ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {flag.linkedFeatures.map((feature) => (
              <div key={feature.linkId} className="flex items-center gap-2 rounded-full border px-2 py-1">
                <Link
                  href={`/features/${feature.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {feature.title}
                </Link>
                <form action={unlinkFlagFromFeature.bind(null, feature.linkId, feature.id)}>
                  <button
                    type="submit"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Unlink
                  </button>
                </form>
              </div>
            ))}
          </div>
        ) : null}
        {flag.notes ? <p className="text-xs text-muted-foreground">{flag.notes}</p> : null}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">{pending ? "Saving..." : "Runtime"}</span>
        <Switch
          checked={checked}
          disabled={pending}
          onCheckedChange={handleChange}
          aria-label={`Toggle ${flag.key}`}
        />
      </div>

      <div className="md:basis-full">
        <details className="rounded-xl border bg-background p-4">
          <summary className="cursor-pointer text-sm font-medium">Manage flag</summary>

          <div className="mt-4 space-y-4">
            <form action={updateRuntimeFlag.bind(null, flag.id)} className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium">Key</span>
                <Input name="key" type="text" required defaultValue={flag.key} />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium">Audience</span>
                <select
                  name="audience"
                  defaultValue={flag.audience}
                  className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm shadow-xs outline-none"
                >
                  {AUDIENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block md:col-span-2">
                <span className="mb-1 block text-xs font-medium">Description</span>
                <textarea
                  name="description"
                  required
                  rows={3}
                  defaultValue={flag.description}
                  className="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none"
                />
              </label>

              <div className="md:col-span-2">
                <span className="mb-2 block text-xs font-medium">Target environments</span>
                <div className="grid gap-3 sm:grid-cols-3">
                  {ENVIRONMENTS.map((environment) => (
                    <label
                      key={environment.value}
                      className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        name="targetEnvironments"
                        value={environment.value}
                        defaultChecked={flag.targetEnvironments.includes(environment.value)}
                        className="size-4 accent-foreground"
                      />
                      <span>{environment.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium">Notes</span>
                <Input name="notes" type="text" defaultValue={flag.notes ?? ""} />
              </label>

              <label className="flex items-center gap-2 self-end rounded-xl border bg-card px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={flag.enabled}
                  className="size-4 accent-foreground"
                />
                <span>Enabled</span>
              </label>

              <div className="md:col-span-2 flex justify-end">
                <Button type="submit" size="sm">Save changes</Button>
              </div>
            </form>

            <form action={linkFlagToFeature} className="space-y-3 rounded-xl border p-4">
              <input type="hidden" name="flagId" value={flag.id} />

              <label className="block">
                <span className="mb-1 block text-xs font-medium">Link feature</span>
                <select
                  name="featureId"
                  defaultValue={linkableFeatures[0]?.id ?? ""}
                  disabled={linkableFeatures.length === 0}
                  className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm shadow-xs outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {linkableFeatures.length > 0 ? (
                    linkableFeatures.map((feature) => (
                      <option key={feature.id} value={feature.id}>
                        {feature.title}
                      </option>
                    ))
                  ) : (
                    <option value="">All features are already linked</option>
                  )}
                </select>
              </label>

              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={linkableFeatures.length === 0}>
                  Link feature
                </Button>
              </div>
            </form>

            <form action={deleteRuntimeFlag.bind(null, flag.id)} className="flex justify-end">
              <Button type="submit" size="sm" variant="destructive">
                Delete flag
              </Button>
            </form>
          </div>
        </details>
      </div>
    </div>
  );
}

export function FlagList({
  flags,
  availableFeatures,
}: {
  flags: FlagListItem[];
  availableFeatures: FeatureOption[];
}) {
  if (flags.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
        No runtime flags have been created yet.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {flags.map((flag) => (
        <FlagRow key={flag.id} flag={flag} availableFeatures={availableFeatures} />
      ))}
    </div>
  );
}
