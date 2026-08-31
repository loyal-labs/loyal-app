"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";
import { requireAdminSession } from "@/lib/require-admin-session";
import { CACHE_TAGS, communityTag } from "@/lib/data-cache";
import { communities } from "@loyal-labs/db-core/schema";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CommunityActionResult = { success: true } | { error: string };

export async function setCommunityActiveStatus(
  communityId: string,
  nextIsActive: boolean
): Promise<CommunityActionResult> {
  await requireAdminSession();

  if (!UUID_PATTERN.test(communityId)) {
    return { error: "Invalid community ID" };
  }

  const db = getDatabase();

  try {
    const updatedRows = nextIsActive
      ? await db
          .update(communities)
          .set({
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(communities.id, communityId))
          .returning({ id: communities.id })
      : await db
          .update(communities)
          .set({
            isActive: false,
            summaryNotificationsEnabled: false,
            updatedAt: new Date(),
          })
          .where(eq(communities.id, communityId))
          .returning({ id: communities.id });

    if (updatedRows.length === 0) {
      return { error: "Community not found" };
    }
  } catch {
    return { error: "Failed to update community status" };
  }

  revalidateTag(communityTag(communityId));
  revalidateTag(CACHE_TAGS.communitiesList);
  revalidateTag(CACHE_TAGS.overview);
  revalidatePath(`/communities/${communityId}`);

  return { success: true };
}
