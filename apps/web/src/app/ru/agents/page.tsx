import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import { ruAgents } from "@/features/marketing/i18n/ru/agents";
import { ruCommon } from "@/features/marketing/i18n/ru/common";
import {
  AGENTS_OG_IMAGE,
  AgentsPage,
} from "@/features/marketing/pages/agents-page";

export const metadata = buildPageMetadata({
  locale: "ru",
  path: "/agents",
  meta: ruAgents.meta,
  ogImage: AGENTS_OG_IMAGE,
});

export default function Page() {
  return <AgentsPage common={ruCommon} dict={ruAgents} locale="ru" />;
}
