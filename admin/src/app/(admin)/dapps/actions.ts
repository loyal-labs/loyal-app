"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDatabase } from "@/lib/core/database";
import { trustedDapps } from "@loyal-labs/db-core/schema";

type ActionResult = { error?: string; success?: boolean };

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

function readForm(formData: FormData): {
  origin: string | null;
  name: string;
  startUrl: string | null;
  displayOrder: number;
  isActive: boolean;
} {
  const rawOrigin = (formData.get("origin") as string | null) ?? "";
  const rawStartUrl = (formData.get("startUrl") as string | null) ?? rawOrigin;
  return {
    origin: normalizeOrigin(rawOrigin),
    name: ((formData.get("name") as string | null) ?? "").trim(),
    startUrl: normalizeStartUrl(rawStartUrl || rawOrigin),
    displayOrder: parseDisplayOrder(formData.get("displayOrder") as string | null),
    isActive: formData.get("isActive") === "on",
  };
}

export async function addTrustedDapp(formData: FormData): Promise<ActionResult> {
  const fields = readForm(formData);
  if (!fields.origin) return { error: "Origin must be a valid http(s) URL" };
  if (!fields.startUrl) return { error: "Start URL must be a valid http(s) URL" };
  if (!fields.name) return { error: "Name is required" };

  const db = getDatabase();
  try {
    await db.insert(trustedDapps).values({
      origin: fields.origin,
      name: fields.name,
      startUrl: fields.startUrl,
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
  if (!fields.startUrl) return { error: "Start URL must be a valid http(s) URL" };
  if (!fields.name) return { error: "Name is required" };

  const db = getDatabase();
  try {
    await db
      .update(trustedDapps)
      .set({
        origin: fields.origin,
        name: fields.name,
        startUrl: fields.startUrl,
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
