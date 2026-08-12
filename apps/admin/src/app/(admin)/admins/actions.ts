"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDatabase } from "@/lib/core/database";
import { admins } from "@loyal-labs/db-core/schema";

function parseTelegramId(value: string): bigint | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export async function addAdmin(formData: FormData) {
  const telegramId = formData.get("telegramId") as string;
  const displayName = formData.get("displayName") as string;
  const username = (formData.get("username") as string) || null;
  const addedBy = (formData.get("addedBy") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  if (!telegramId || !displayName) {
    return { error: "Telegram ID and Display Name are required" };
  }

  const parsedTelegramId = parseTelegramId(telegramId);
  if (parsedTelegramId === null) {
    return { error: "Telegram ID must be a valid integer" };
  }

  const db = getDatabase();

  try {
    await db.insert(admins).values({
      telegramId: parsedTelegramId,
      displayName,
      username,
      addedBy,
      notes,
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("unique")) {
      return { error: "An admin with this Telegram ID already exists" };
    }
    return { error: "Failed to add admin" };
  }

  revalidatePath("/admins");
  return { success: true };
}

export async function updateAdmin(id: string, formData: FormData) {
  const telegramId = formData.get("telegramId") as string;
  const displayName = formData.get("displayName") as string;
  const username = (formData.get("username") as string) || null;
  const addedBy = (formData.get("addedBy") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  if (!telegramId || !displayName) {
    return { error: "Telegram ID and Display Name are required" };
  }

  const parsedTelegramId = parseTelegramId(telegramId);
  if (parsedTelegramId === null) {
    return { error: "Telegram ID must be a valid integer" };
  }

  const db = getDatabase();

  try {
    await db
      .update(admins)
      .set({
        telegramId: parsedTelegramId,
        displayName,
        username,
        addedBy,
        notes,
      })
      .where(eq(admins.id, id));
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("unique")) {
      return { error: "An admin with this Telegram ID already exists" };
    }
    return { error: "Failed to update admin" };
  }

  revalidatePath("/admins");
  return { success: true };
}

export async function deleteAdmin(id: string) {
  const db = getDatabase();
  await db.delete(admins).where(eq(admins.id, id));
  revalidatePath("/admins");
  return { success: true };
}
