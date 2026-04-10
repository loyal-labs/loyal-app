"use server";

import { asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDatabase } from "@/lib/core/database";
import { featureAppStatuses, featureRegistry } from "@loyal-labs/db-core/schema";

const FEATURE_APPS = [
  "telegram_miniapp",
  "website",
  "mobile",
  "extension",
] as const;

function getOptionalTextValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getFeaturesForMatrix() {
  const db = getDatabase();

  return db.query.featureRegistry.findMany({
    orderBy: [asc(featureRegistry.title)],
    with: {
      appStatuses: {
        orderBy: [asc(featureAppStatuses.app)],
      },
    },
  });
}

export async function createFeature(formData: FormData): Promise<void> {
  const title = getOptionalTextValue(formData, "title");
  const key = getOptionalTextValue(formData, "key");
  const description = getOptionalTextValue(formData, "description");

  if (!title || !key || !description) {
    return;
  }

  const db = getDatabase();

  try {
    const insertedFeatures = await db
      .insert(featureRegistry)
      .values({
        title,
        key,
        description,
        owner: getOptionalTextValue(formData, "owner"),
        notes: getOptionalTextValue(formData, "notes"),
      })
      .returning({ id: featureRegistry.id });

    const feature = insertedFeatures[0];
    if (!feature) {
      return;
    }

    await db.insert(featureAppStatuses).values(
      FEATURE_APPS.map((app) => ({
        featureId: feature.id,
        app,
        status: "missing" as const,
        statusNote: null,
      })),
    );
  } catch {
    return;
  }

  revalidatePath("/features");
}
