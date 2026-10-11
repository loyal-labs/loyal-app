import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import { zhAgents } from "@/features/marketing/i18n/zh/agents";
import { zhCommon } from "@/features/marketing/i18n/zh/common";
import {
  AGENTS_OG_IMAGE,
  AgentsPage,
} from "@/features/marketing/pages/agents-page";

export const metadata = buildPageMetadata({
  locale: "zh",
  path: "/agents",
  meta: zhAgents.meta,
  ogImage: AGENTS_OG_IMAGE,
});

export default function Page() {
  return <AgentsPage common={zhCommon} dict={zhAgents} locale="zh" />;
}
