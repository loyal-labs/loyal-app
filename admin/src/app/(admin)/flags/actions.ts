"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDatabase } from "@/lib/core/database";
import {
  runtimeFlags,
  type FlagAudience,
  type FlagTargetEnvironment,
} from "@loyal-labs/db-core/schema";

const AUDIENCE_VALUES: FlagAudience[] = ["all", "public", "team"];
const ENVIRONMENT_VALUES: FlagTargetEnvironment[] = [
  "development",
  "preview",
  "production",
];

function getTrimmedString(formData: FormData, key: string): string {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function getOptionalTrimmedString(formData: FormData, key: string): string | null {
  const value = getTrimmedString(formData, key);
  return value.length > 0 ? value : null;
}

function parseAudience(formData: FormData): FlagAudience | null {
  const value = getTrimmedString(formData, "audience");
  return AUDIENCE_VALUES.includes(value as FlagAudience) ? (value as FlagAudience) : null;
}

function parseEnvironments(formData: FormData): FlagTargetEnvironment[] {
  const values = formData.getAll("targetEnvironments");
  const environments = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value): value is FlagTargetEnvironment =>
      ENVIRONMENT_VALUES.includes(value as FlagTargetEnvironment),
    );

  return Array.from(new Set(environments));
}

function getFlagValues(formData: FormData) {
  const key = getTrimmedString(formData, "key");
  const description = getTrimmedString(formData, "description");
  const audience = parseAudience(formData);
  const targetEnvironments = parseEnvironments(formData);
  const notes = getOptionalTrimmedString(formData, "notes");

  return {
    key,
    description,
    audience,
    targetEnvironments,
    notes,
    enabled: formData.get("enabled") === "on",
  };
}

export async function createRuntimeFlag(formData: FormData) {
  const { key, description, audience, targetEnvironments, notes, enabled } =
    getFlagValues(formData);

  if (!key || !description || !audience) {
    return;
  }

  const db = getDatabase();

  try {
    await db.insert(runtimeFlags).values({
      key,
      description,
      enabled,
      audience,
      targetEnvironments:
        targetEnvironments.length > 0 ? targetEnvironments : ENVIRONMENT_VALUES,
      notes,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("unique")) {
      return;
    }

    return;
  }

  revalidatePath("/flags");
}

export async function updateRuntimeFlag(id: string, formData: FormData) {
  const { description, audience, targetEnvironments, notes, enabled } =
    getFlagValues(formData);

  if (!description || !audience) {
    return;
  }

  const db = getDatabase();

  try {
    await db
      .update(runtimeFlags)
      .set({
        description,
        enabled,
        audience,
        targetEnvironments:
          targetEnvironments.length > 0 ? targetEnvironments : ENVIRONMENT_VALUES,
        notes,
        updatedAt: new Date(),
      })
      .where(eq(runtimeFlags.id, id));
  } catch {
    return;
  }

  revalidatePath("/flags");
}

export async function toggleRuntimeFlag(id: string, enabled: boolean) {
  const db = getDatabase();

  await db
    .update(runtimeFlags)
    .set({
      enabled,
      updatedAt: new Date(),
    })
    .where(eq(runtimeFlags.id, id));

  revalidatePath("/flags");
}
