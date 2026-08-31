import "server-only";

import { cookies } from "next/headers";

import {
  ADMIN_SESSION_COOKIE,
  requireValidAdminSessionToken,
} from "@/lib/admin-auth";

export async function requireAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

  return requireValidAdminSessionToken(token);
}
