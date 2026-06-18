import { communities } from "@loyal-labs/db-core/schema";
import { eq, sql } from "drizzle-orm";

import { getCloudflareCdnUrlClientFromEnv } from "@/lib/core/cdn-url";
import { getDatabase } from "@/lib/core/database";
import {
  getCloudflareR2UploadClientFromEnv,
  isCloudflareR2UploadConfigured,
} from "@/lib/core/r2-upload";
import { resolveCommunityPhotoObjectKey } from "@/lib/telegram/photo-path";

type CommunitySettings = Record<string, unknown> & {
  photoUrl?: string;
  photoBase64?: string;
  photoMimeType?: string;
  photoUpdatedAt?: string;
};

type BackfillStats = {
  scanned: number;
  skippedAlreadyMigrated: number;
  skippedInvalidBase64: number;
  dryRunCandidates: number;
  uploaded: number;
  updated: number;
  failed: number;
};

function normalizePhotoContentType(value: unknown): string {
  if (typeof value !== "string") {
    return "image/jpeg";
  }

  const normalized = value.split(";")[0]?.trim().toLowerCase();
  if (!normalized || !normalized.startsWith("image/")) {
    return "image/jpeg";
  }

  return normalized;
}

function decodeStrictBase64(value: string): Buffer | null {
  const normalized = value.trim().replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 !== 0) {
    return null;
  }

  // Telegram photo blobs are standard base64, not URL-safe base64.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return null;
  }

  const decoded = Buffer.from(normalized, "base64");
  if (decoded.length === 0) {
    return null;
  }

  const canonicalInput = normalized.replace(/=+$/, "");
  const canonicalOutput = decoded.toString("base64").replace(/=+$/, "");
  return canonicalInput === canonicalOutput ? decoded : null;
}

function isDirectExecution(scriptName: string): boolean {
  const entrypoint = process.argv[1];
  return typeof entrypoint === "string" && entrypoint.endsWith(scriptName);
}

export async function runBackfillCommunityPhotosToCdn(options?: {
  apply?: boolean;
}): Promise<BackfillStats> {
  const shouldApply = options?.apply ?? false;

  if (!isCloudflareR2UploadConfigured()) {
    throw new Error("Cloudflare R2 upload is not configured");
  }

  const db = getDatabase();
  const uploadClient = getCloudflareR2UploadClientFromEnv();
  const cdnClient = getCloudflareCdnUrlClientFromEnv();
  const stats: BackfillStats = {
    scanned: 0,
    skippedAlreadyMigrated: 0,
    skippedInvalidBase64: 0,
    dryRunCandidates: 0,
    uploaded: 0,
    updated: 0,
    failed: 0,
  };

  const rows = await db
    .select({
      id: communities.id,
      chatId: communities.chatId,
      settings: communities.settings,
    })
    .from(communities)
    .where(sql`${communities.settings} ? 'photoBase64'`);

  stats.scanned = rows.length;

  for (const row of rows) {
    try {
      const settings =
        row.settings && typeof row.settings === "object"
          ? ({ ...row.settings } as CommunitySettings)
          : ({} as CommunitySettings);

      if (
        typeof settings.photoUrl === "string" &&
        settings.photoUrl.length > 0
      ) {
        stats.skippedAlreadyMigrated += 1;
        continue;
      }

      if (
        typeof settings.photoBase64 !== "string" ||
        settings.photoBase64.length === 0
      ) {
        stats.skippedInvalidBase64 += 1;
        continue;
      }

      const body = decodeStrictBase64(settings.photoBase64);
      if (!body) {
        stats.skippedInvalidBase64 += 1;
        continue;
      }

      const contentType = normalizePhotoContentType(settings.photoMimeType);
      const key = resolveCommunityPhotoObjectKey(
        String(row.chatId),
        contentType
      );
      const photoUrl = cdnClient.resolveUrl({ key });

      if (!shouldApply) {
        stats.dryRunCandidates += 1;
        console.info("[backfill-community-photos] dry-run candidate", {
          communityId: row.id,
          chatId: String(row.chatId),
          key,
          photoUrl,
        });
        continue;
      }

      await uploadClient.uploadImage({
        key,
        body,
        contentType,
      });
      stats.uploaded += 1;

      const photoUpdatedAt = new Date().toISOString();
      await db
        .update(communities)
        .set({
          // Update only photo fields in JSONB to avoid clobbering concurrent settings writes.
          settings: sql`jsonb_set(
            jsonb_set(
              ${communities.settings} - 'photoBase64' - 'photoMimeType',
              '{photoUrl}',
              to_jsonb(${photoUrl}::text),
              true
            ),
            '{photoUpdatedAt}',
            to_jsonb(${photoUpdatedAt}::text),
            true
          )`,
          updatedAt: new Date(),
        })
        .where(eq(communities.id, row.id));

      stats.updated += 1;
    } catch (error) {
      stats.failed += 1;
      console.error("[backfill-community-photos] failed row", {
        communityId: row.id,
        chatId: String(row.chatId),
        error,
      });
    }
  }

  return stats;
}

export async function runBackfillCommunityPhotosToCdnCli(): Promise<number> {
  const shouldApply = process.argv.includes("--apply");

  try {
    const stats = await runBackfillCommunityPhotosToCdn({
      apply: shouldApply,
    });

    console.info("[backfill-community-photos] complete", {
      mode: shouldApply ? "apply" : "dry-run",
      ...stats,
    });
    return 0;
  } catch (error) {
    console.error("[backfill-community-photos] failed", error);
    return 1;
  }
}

if (isDirectExecution("backfill-community-photos-to-cdn.ts")) {
  process.exit(await runBackfillCommunityPhotosToCdnCli());
}
