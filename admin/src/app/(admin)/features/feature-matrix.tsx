import Link from "next/link";

import { type FeatureAppStatus, type FeatureRegistry } from "@loyal-labs/db-core/schema";

import { FeatureStatusBadge } from "./feature-status-badge";

const APPS = [
  "telegram_miniapp",
  "website",
  "mobile",
  "extension",
] as const;

type FeatureWithStatuses = FeatureRegistry & {
  appStatuses: FeatureAppStatus[];
};

export function FeatureMatrix({ features }: { features: FeatureWithStatuses[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left">
            <th className="px-4 py-3 font-medium">Feature</th>
            {APPS.map((app) => (
              <th key={app} className="px-4 py-3 font-medium capitalize">
                {app.replaceAll("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {features.length > 0 ? (
            features.map((feature) => (
              <tr key={feature.id} className="border-b last:border-b-0">
                <td className="px-4 py-3 align-top">
                  <Link
                    href={`/features/${feature.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {feature.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{feature.key}</p>
                </td>
                {APPS.map((app) => {
                  const status =
                    feature.appStatuses.find((row) => row.app === app)?.status ?? "missing";

                  return (
                    <td key={app} className="px-4 py-3 align-top">
                      <FeatureStatusBadge status={status} />
                    </td>
                  );
                })}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={APPS.length + 1} className="px-4 py-8 text-center text-muted-foreground">
                No features have been created yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
