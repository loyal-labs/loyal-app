"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDatabase } from "@/lib/core/database";
import {
  featureAppStatuses,
  featureEvidence,
  featureFlagLinks,
  type FeatureEvidenceType,
  type FeatureStatus,
} from "@loyal-labs/db-core/schema";

const FEATURE_STATUSES: FeatureStatus[] = [
  "missing",
  "planned",
  "in_progress",
  "implemented",
  "live",
];

const FEATURE_EVIDENCE_TYPES: FeatureEvidenceType[] = [
  "path",
  "branch",
  "pr",
  "linear",
  "commit",
  "doc",
];

function getStringValue(formData: FormData, key: string): string {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function getOptionalStringValue(formData: FormData, key: string): string | null {
  const value = getStringValue(formData, key);

  return value.length > 0 ? value : null;
}

function isFeatureStatus(value: string): value is FeatureStatus {
  return FEATURE_STATUSES.includes(value as FeatureStatus);
}

function isFeatureEvidenceType(value: string): value is FeatureEvidenceType {
  return FEATURE_EVIDENCE_TYPES.includes(value as FeatureEvidenceType);
}

function revalidateFeaturePath(featureId: string) {
  revalidatePath(`/features/${featureId}`);
}

export async function updateFeatureStatus(statusId: string, formData: FormData): Promise<void> {
  const featureId = getStringValue(formData, "featureId");
  const status = getStringValue(formData, "status");

  if (!featureId || !isFeatureStatus(status)) {
    return;
  }

  const db = getDatabase();

  await db
    .update(featureAppStatuses)
    .set({
      status,
      statusNote: getOptionalStringValue(formData, "statusNote"),
      updatedAt: new Date(),
    })
    .where(eq(featureAppStatuses.id, statusId));

  revalidateFeaturePath(featureId);
}

export async function addFeatureEvidence(formData: FormData): Promise<void> {
  const featureId = getStringValue(formData, "featureId");
  const featureAppStatusId = getStringValue(formData, "featureAppStatusId");
  const type = getStringValue(formData, "type");
  const label = getStringValue(formData, "label");
  const value = getStringValue(formData, "value");

  if (!featureId || !featureAppStatusId || !isFeatureEvidenceType(type) || !label || !value) {
    return;
  }

  const db = getDatabase();

  await db.insert(featureEvidence).values({
    featureAppStatusId,
    type,
    label,
    value,
    note: getOptionalStringValue(formData, "note"),
  });

  revalidateFeaturePath(featureId);
}

export async function linkFeatureFlag(formData: FormData): Promise<void> {
  const featureId = getStringValue(formData, "featureId");
  const flagId = getStringValue(formData, "flagId");

  if (!featureId || !flagId) {
    return;
  }

  const db = getDatabase();

  const existingLink = await db.query.featureFlagLinks.findFirst({
    where: and(eq(featureFlagLinks.featureId, featureId), eq(featureFlagLinks.flagId, flagId)),
  });

  if (!existingLink) {
    await db.insert(featureFlagLinks).values({
      featureId,
      flagId,
    });
  }

  revalidateFeaturePath(featureId);
}

export async function unlinkFeatureFlag(linkId: string, featureId: string): Promise<void> {
  const db = getDatabase();

  await db.delete(featureFlagLinks).where(eq(featureFlagLinks.id, linkId));
  revalidateFeaturePath(featureId);
}
