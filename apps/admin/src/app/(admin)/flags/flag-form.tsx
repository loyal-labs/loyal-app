import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { createRuntimeFlag } from "./actions";

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

export function FlagForm() {
  return (
    <form action={createRuntimeFlag} className="rounded-2xl border bg-card p-5">
      <div className="mb-4 space-y-1">
        <h2 className="text-lg font-semibold">Create flag</h2>
        <p className="text-sm text-muted-foreground">
          Runtime delivery is wired only for the Loyal web frontend in v1.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium">
            Key <span className="text-destructive">*</span>
          </span>
          <Input name="key" type="text" required placeholder="frontend_checkout_redesign" />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium">
            Audience <span className="text-destructive">*</span>
          </span>
          <select
            name="audience"
            defaultValue="all"
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive h-10 w-full rounded-md border px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
          >
            {AUDIENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs font-medium">
            Description <span className="text-destructive">*</span>
          </span>
          <textarea
            name="description"
            required
            rows={3}
            placeholder="What this flag controls and why it exists"
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive min-h-24 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
          />
        </label>

        <div className="md:col-span-2">
          <span className="mb-2 block text-xs font-medium">Target environments</span>
          <div className="grid gap-3 sm:grid-cols-3">
            {ENVIRONMENTS.map((environment) => (
              <label
                key={environment.value}
                className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="targetEnvironments"
                  value={environment.value}
                  defaultChecked
                  className="size-4 accent-foreground"
                />
                <span>{environment.label}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium">Notes</span>
          <Input name="notes" type="text" placeholder="Optional rollout notes" />
        </label>

        <label className="flex items-center gap-2 self-end rounded-xl border bg-background px-3 py-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked className="size-4 accent-foreground" />
          <span>Enabled on create</span>
        </label>
      </div>

      <div className="mt-4 flex items-center justify-end">
        <Button type="submit">Create flag</Button>
      </div>
    </form>
  );
}
