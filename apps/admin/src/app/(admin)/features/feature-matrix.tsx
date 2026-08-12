import Link from "next/link";

import {
  type FeatureAppStatus,
  type FeatureFlagLink,
  type FeatureRegistry,
  type RuntimeFlag,
} from "@loyal-labs/db-core/schema";

import { FeatureStatusBadge } from "./feature-status-badge";

const APPS = [
  "telegram_miniapp",
  "website",
  "mobile",
  "extension",
] as const;

type FeatureWithStatuses = FeatureRegistry & {
  appStatuses: FeatureAppStatus[];
  flagLinks: (FeatureFlagLink & { flag: RuntimeFlag })[];
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
                  <div className="mt-2 text-xs text-muted-foreground">
                    {feature.flagLinks.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        <span>Flags:</span>
                        {feature.flagLinks.map((link) => (
                          <Link
                            key={link.id}
                            href={`/flags#flag-${link.flag.id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {link.flag.key}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <span>Flags: none linked</span>
                    )}
                  </div>
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
