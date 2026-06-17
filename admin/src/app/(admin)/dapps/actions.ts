"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDatabase } from "@/lib/core/database";
import { trustedDapps } from "@loyal-labs/db-core/schema";

import { ALLOWLIST_SEED } from "./allowlist-seed";

type ActionResult = { error?: string; success?: boolean };

type SeedResult = {
  inserted: number;
  backfilled: number;
  skipped: number;
  error?: string;
};

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function normalizeStartUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseDisplayOrder(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

// Accept free-form strings so admins can introduce new categories without
// a code change. The canonical list lives in `@loyal-labs/shared` and
// drives the dropdown, but the column stays text.
function normalizeCategory(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readForm(formData: FormData): {
  origin: string | null;
  name: string;
  startUrl: string | null;
  category: string | null;
  displayOrder: number;
  isActive: boolean;
} {
  const rawOrigin = (formData.get("origin") as string | null) ?? "";
  const rawStartUrl = (formData.get("startUrl") as string | null) ?? rawOrigin;
  return {
    origin: normalizeOrigin(rawOrigin),
    name: ((formData.get("name") as string | null) ?? "").trim(),
    startUrl: normalizeStartUrl(rawStartUrl || rawOrigin),
    category: normalizeCategory(formData.get("category") as string | null),
    displayOrder: parseDisplayOrder(
      formData.get("displayOrder") as string | null
    ),
    isActive: formData.get("isActive") === "on",
  };
}

export async function addTrustedDapp(
  formData: FormData
): Promise<ActionResult> {
  const fields = readForm(formData);
  if (!fields.origin) return { error: "Origin must be a valid http(s) URL" };
  if (!fields.startUrl)
    return { error: "Start URL must be a valid http(s) URL" };
  if (!fields.name) return { error: "Name is required" };

  const db = getDatabase();
  try {
    await db.insert(trustedDapps).values({
      origin: fields.origin,
      name: fields.name,
      startUrl: fields.startUrl,
      category: fields.category,
      displayOrder: fields.displayOrder,
      isActive: fields.isActive,
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("unique")) {
      return { error: "A dApp with this origin already exists" };
    }
    return { error: "Failed to add dApp" };
  }

  revalidatePath("/dapps");
  return { success: true };
}

export async function updateTrustedDapp(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  const fields = readForm(formData);
  if (!fields.origin) return { error: "Origin must be a valid http(s) URL" };
  if (!fields.startUrl)
    return { error: "Start URL must be a valid http(s) URL" };
  if (!fields.name) return { error: "Name is required" };

  const db = getDatabase();
  try {
    await db
      .update(trustedDapps)
      .set({
        origin: fields.origin,
        name: fields.name,
        startUrl: fields.startUrl,
        category: fields.category,
        displayOrder: fields.displayOrder,
        isActive: fields.isActive,
        updatedAt: new Date(),
      })
      .where(eq(trustedDapps.id, id));
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("unique")) {
      return { error: "A dApp with this origin already exists" };
    }
    return { error: "Failed to update dApp" };
  }

  revalidatePath("/dapps");
  return { success: true };
}

export async function deleteTrustedDapp(id: string): Promise<ActionResult> {
  const db = getDatabase();
  await db.delete(trustedDapps).where(eq(trustedDapps.id, id));
  revalidatePath("/dapps");
  return { success: true };
}

export async function toggleTrustedDappActive(
  id: string,
  isActive: boolean
): Promise<ActionResult> {
  const db = getDatabase();
  await db
    .update(trustedDapps)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(trustedDapps.id, id));
  revalidatePath("/dapps");
  return { success: true };
}

/**
 * Inserts the v0.1 allowlist into `trusted_dapps`. Existing rows keyed by
 * origin are left alone *except* their `category` is backfilled when NULL,
 * so pre-category rows (Jupiter, Loyal) get grouped correctly without
 * clobbering admin edits (name / isActive / displayOrder).
 */
export async function seedAllowlist(): Promise<SeedResult> {
  const db = getDatabase();

  const existing = await db
    .select({
      origin: trustedDapps.origin,
      category: trustedDapps.category,
    })
    .from(trustedDapps);

  const existingByOrigin = new Map(existing.map((r) => [r.origin, r]));

  let inserted = 0;
  let backfilled = 0;
  let skipped = 0;

  for (const entry of ALLOWLIST_SEED) {
    const origin = `https://${entry.host}`;
    const found = existingByOrigin.get(origin);

    if (!found) {
      await db.insert(trustedDapps).values({
        origin,
        name: entry.name,
        startUrl: origin,
        category: entry.category,
        displayOrder: entry.displayOrder,
        isActive: true,
      });
      inserted += 1;
      continue;
    }

    if (found.category === null) {
      await db
        .update(trustedDapps)
        .set({ category: entry.category, updatedAt: new Date() })
        .where(eq(trustedDapps.origin, origin));
      backfilled += 1;
    } else {
      skipped += 1;
    }
  }

  revalidatePath("/dapps");
  return { inserted, backfilled, skipped };
}
