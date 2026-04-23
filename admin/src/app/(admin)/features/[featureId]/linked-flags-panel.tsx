import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { linkFeatureFlag, unlinkFeatureFlag } from "./feature-detail-actions";
import {
  type FeatureFlagLink,
  type FeatureRegistry,
  type RuntimeFlag,
} from "@loyal-labs/db-core/schema";

type FeatureWithFlags = FeatureRegistry & {
  flagLinks: (FeatureFlagLink & { flag: RuntimeFlag })[];
};

export function LinkedFlagsPanel({
  feature,
  availableFlags,
}: {
  feature: FeatureWithFlags;
  availableFlags: RuntimeFlag[];
}) {
  const linkedFlagIds = new Set(feature.flagLinks.map((link) => link.flagId));
  const linkableFlags = availableFlags.filter((flag) => !linkedFlagIds.has(flag.id));

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Linked flags</h2>
          <p className="text-sm text-muted-foreground">Attach runtime flags to this feature.</p>
        </div>
        <Badge variant="outline">{feature.flagLinks.length} linked</Badge>
      </div>

      <form action={linkFeatureFlag} className="mb-6 space-y-4 rounded-xl border bg-background p-4">
        <input type="hidden" name="featureId" value={feature.id} />

        <label className="block">
          <span className="mb-1 block text-xs font-medium">Flag</span>
          <select
            name="flagId"
            defaultValue={linkableFlags[0]?.id ?? ""}
            disabled={linkableFlags.length === 0}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {linkableFlags.length > 0 ? (
              linkableFlags.map((flag) => (
                <option key={flag.id} value={flag.id}>
                  {flag.key}
                </option>
              ))
            ) : (
              <option value="">All flags are already linked</option>
            )}
          </select>
        </label>

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={linkableFlags.length === 0}>
            Link flag
          </Button>
        </div>
      </form>

      {feature.flagLinks.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Flag</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {feature.flagLinks.map((link) => (
              <TableRow key={link.id}>
                <TableCell className="font-medium">
                  {link.flag.key}
                </TableCell>
                <TableCell className="text-muted-foreground">{link.flag.description}</TableCell>
                <TableCell className="text-right">
                  <form action={unlinkFeatureFlag.bind(null, link.id, feature.id)}>
                    <Button type="submit" variant="ghost" size="xs">
                      Unlink
                    </Button>
                  </form>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          No runtime flags are linked yet.
        </div>
      )}
    </section>
  );
}
