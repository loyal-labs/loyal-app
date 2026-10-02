import { enAgents } from "@/features/marketing/i18n/en/agents";
import { enCommon } from "@/features/marketing/i18n/en/common";
import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import {
  AGENTS_OG_IMAGE,
  AgentsPage,
} from "@/features/marketing/pages/agents-page";

export const metadata = buildPageMetadata({
  locale: "en",
  path: "/agents",
  meta: enAgents.meta,
  ogImage: AGENTS_OG_IMAGE,
});

export default function Page() {
  return <AgentsPage common={enCommon} dict={enAgents} locale="en" />;
}
