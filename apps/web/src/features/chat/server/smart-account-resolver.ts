import "server-only";

import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";

export async function resolveChatUserSmartAccount(userId: string) {
  return findReadyCurrentUserSmartAccount({ userId });
}
