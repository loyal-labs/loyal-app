"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";

import { CACHE_TAGS, communityTag } from "@/lib/data-cache";
import { getDatabase } from "@/lib/core/database";
import { communities } from "@loyal-labs/db-core/schema";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PER_DAY_VALUES = new Set(["off", "24", "48"]);
const PER_MESSAGE_VALUES = new Set(["off", "500", "1000"]);

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "off";
}

function toSummaryNotificationTimeHours(value: string): 24 | 48 | null {
  if (value === "off") {
    return null;
  }

  if (value === "24") {
    return 24;
  }

  if (value === "48") {
    return 48;
  }

  return null;
}

function toSummaryNotificationMessageCount(value: string): 500 | 1000 | null {
  if (value === "off") {
    return null;
  }

  if (value === "500") {
    return 500;
  }

  if (value === "1000") {
    return 1000;
  }

  return null;
}

export async function updateCommunityNotificationSettings(
  communityId: string,
  formData: FormData
) {
  if (!UUID_PATTERN.test(communityId)) {
    return;
  }

  const perDay = getFormValue(formData, "perDay");
  const perMessage = getFormValue(formData, "perMessage");
  const isMasterEnabled = formData.get("masterSwitch") === "on";
  const isActive = formData.get("isActive") === "on";
  const isPublic = formData.get("isPublic") === "on";

  if (!PER_DAY_VALUES.has(perDay) || !PER_MESSAGE_VALUES.has(perMessage)) {
    return;
  }

  const db = getDatabase();

  await db
    .update(communities)
    .set({
      summaryNotificationsEnabled: isActive ? isMasterEnabled : false,
      summaryNotificationTimeHours: toSummaryNotificationTimeHours(perDay),
      summaryNotificationMessageCount:
        toSummaryNotificationMessageCount(perMessage),
      isActive,
      isPublic,
      updatedAt: new Date(),
    })
    .where(eq(communities.id, communityId));

  revalidateTag(communityTag(communityId));
  revalidateTag(CACHE_TAGS.communitiesList);
  revalidateTag(CACHE_TAGS.overview);
  revalidatePath(`/communities/${communityId}`);
}
