"use server";

import { libraryArticles, librarySections } from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { serverEnv } from "@/lib/core/config/server";
import { getDatabase } from "@/lib/core/database";
import { requireAdminSession } from "@/lib/require-admin-session";

type ActionResult = { error?: string; success?: boolean };

function parseInt0(value: FormDataEntryValue | null): number {
  if (typeof value !== "string") return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: FormDataEntryValue | null): string | null {
  const trimmed = readString(value);
  return trimmed.length > 0 ? trimmed : null;
}

// ---------- Sections ----------

export async function addLibrarySection(
  formData: FormData
): Promise<ActionResult> {
  await requireAdminSession();

  const title = readString(formData.get("title"));
  if (!title) return { error: "Title is required" };

  const db = getDatabase();
  await db.insert(librarySections).values({
    title,
    displayOrder: parseInt0(formData.get("displayOrder")),
    isActive: formData.get("isActive") === "on",
  });

  revalidatePath("/library");
  return { success: true };
}

export async function updateLibrarySection(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdminSession();

  const title = readString(formData.get("title"));
  if (!title) return { error: "Title is required" };

  const db = getDatabase();
  await db
    .update(librarySections)
    .set({
      title,
      displayOrder: parseInt0(formData.get("displayOrder")),
      isActive: formData.get("isActive") === "on",
      updatedAt: new Date(),
    })
    .where(eq(librarySections.id, id));

  revalidatePath("/library");
  return { success: true };
}

export async function deleteLibrarySection(id: string): Promise<ActionResult> {
  await requireAdminSession();

  const db = getDatabase();
  try {
    await db.delete(librarySections).where(eq(librarySections.id, id));
  } catch (e: unknown) {
    if (e instanceof Error && e.message.toLowerCase().includes("foreign")) {
      return {
        error: "Section has articles. Delete or move them first.",
      };
    }
    return { error: "Failed to delete section" };
  }
  revalidatePath("/library");
  return { success: true };
}

// ---------- Articles ----------

function readArticleFields(formData: FormData): {
  sectionId: string;
  title: string;
  coverImageUrl: string;
  contentMarkdown: string;
  readTime: string;
  excerpt: string | null;
  isFeatured: boolean;
  isActive: boolean;
  displayOrder: number;
} {
  return {
    sectionId: readString(formData.get("sectionId")),
    title: readString(formData.get("title")),
    coverImageUrl: readString(formData.get("coverImageUrl")),
    contentMarkdown: readString(formData.get("contentMarkdown")),
    readTime: readString(formData.get("readTime")),
    excerpt: readOptionalString(formData.get("excerpt")),
    isFeatured: formData.get("isFeatured") === "on",
    isActive: formData.get("isActive") === "on",
    displayOrder: parseInt0(formData.get("displayOrder")),
  };
}

function validateArticle(
  fields: ReturnType<typeof readArticleFields>
): string | null {
  if (!fields.sectionId) return "Section is required";
  if (!fields.title) return "Title is required";
  if (!fields.coverImageUrl) return "Cover image is required";
  if (!fields.contentMarkdown) return "Content is required";
  if (!fields.readTime) return "Read time is required";
  return null;
}

export async function addLibraryArticle(
  formData: FormData
): Promise<ActionResult> {
  await requireAdminSession();

  const fields = readArticleFields(formData);
  const invalid = validateArticle(fields);
  if (invalid) return { error: invalid };

  const db = getDatabase();
  await db.insert(libraryArticles).values({
    sectionId: fields.sectionId,
    title: fields.title,
    coverImageUrl: fields.coverImageUrl,
    contentMarkdown: fields.contentMarkdown,
    readTime: fields.readTime,
    excerpt: fields.excerpt,
    isFeatured: fields.isFeatured,
    isActive: fields.isActive,
    displayOrder: fields.displayOrder,
    publishedAt: fields.isActive ? new Date() : null,
  });

  revalidatePath("/library");
  return { success: true };
}

export async function updateLibraryArticle(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdminSession();

  const fields = readArticleFields(formData);
  const invalid = validateArticle(fields);
  if (invalid) return { error: invalid };

  const db = getDatabase();
  const [existing] = await db
    .select({
      isActive: libraryArticles.isActive,
      publishedAt: libraryArticles.publishedAt,
    })
    .from(libraryArticles)
    .where(eq(libraryArticles.id, id))
    .limit(1);

  const publishedAt = (() => {
    if (!existing) return fields.isActive ? new Date() : null;
    if (fields.isActive && !existing.publishedAt) return new Date();
    return existing.publishedAt;
  })();

  await db
    .update(libraryArticles)
    .set({
      sectionId: fields.sectionId,
      title: fields.title,
      coverImageUrl: fields.coverImageUrl,
      contentMarkdown: fields.contentMarkdown,
      readTime: fields.readTime,
      excerpt: fields.excerpt,
      isFeatured: fields.isFeatured,
      isActive: fields.isActive,
      displayOrder: fields.displayOrder,
      publishedAt,
      updatedAt: new Date(),
    })
    .where(eq(libraryArticles.id, id));

  revalidatePath("/library");
  return { success: true };
}

export async function deleteLibraryArticle(id: string): Promise<ActionResult> {
  await requireAdminSession();

  const db = getDatabase();
  await db.delete(libraryArticles).where(eq(libraryArticles.id, id));
  revalidatePath("/library");
  return { success: true };
}

export async function toggleLibraryArticleActive(
  id: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireAdminSession();

  const db = getDatabase();
  const [existing] = await db
    .select({ publishedAt: libraryArticles.publishedAt })
    .from(libraryArticles)
    .where(eq(libraryArticles.id, id))
    .limit(1);

  await db
    .update(libraryArticles)
    .set({
      isActive,
      publishedAt:
        isActive && !existing?.publishedAt
          ? new Date()
          : existing?.publishedAt ?? null,
      updatedAt: new Date(),
    })
    .where(eq(libraryArticles.id, id));

  revalidatePath("/library");
  return { success: true };
}

// ---------- Image upload (proxy to /app) ----------

export async function uploadLibraryCover(
  formData: FormData
): Promise<{ url?: string; error?: string }> {
  await requireAdminSession();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "No file provided" };
  }

  const endpoint = `${serverEnv.appApiBaseUrl.replace(
    /\/$/,
    ""
  )}/api/admin/library/upload`;
  const proxyBody = new FormData();
  proxyBody.set("file", file);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serverEnv.libraryUploadToken}`,
      },
      body: proxyBody,
    });
  } catch {
    return { error: "Upload request failed" };
  }

  if (!response.ok) {
    let message = `Upload failed (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore parse error
    }
    return { error: message };
  }

  const data = (await response.json()) as { url?: string };
  if (!data.url) return { error: "Upload returned no URL" };

  return { url: data.url };
}
