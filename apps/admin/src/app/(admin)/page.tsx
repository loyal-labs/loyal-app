import { requireAdminSession } from "@/lib/require-admin-session";

import OverviewPage from "./overview/page";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAdminSession();

  return <OverviewPage />;
}
