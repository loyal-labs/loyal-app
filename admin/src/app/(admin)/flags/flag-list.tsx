"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Switch } from "@/components/ui/switch";
import type { FlagAudience, FlagTargetEnvironment } from "@loyal-labs/db-core/schema";

import { toggleRuntimeFlag } from "./actions";

type FlagListItem = {
  id: string;
  key: string;
  description: string;
  enabled: boolean;
  audience: FlagAudience;
  targetEnvironments: FlagTargetEnvironment[];
  notes: string | null;
};

function FlagRow({ flag }: { flag: FlagListItem }) {
  const router = useRouter();
  const [checked, setChecked] = useState(flag.enabled);
  const [pending, startTransition] = useTransition();

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
    </div>
  );
}

export function FlagList({ flags }: { flags: FlagListItem[] }) {
  if (flags.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
        No runtime flags have been created yet.
      </div>
    );
  }

  return <div className="grid gap-4">{flags.map((flag) => <FlagRow key={flag.id} flag={flag} />)}</div>;
}
