import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import { zhCommon } from "@/features/marketing/i18n/zh/common";
import { zhRisks } from "@/features/marketing/i18n/zh/risks";
import { RISKS_OG_IMAGE, RisksPage } from "@/features/marketing/pages/risks-page";

export const metadata = buildPageMetadata({
  locale: "zh",
  path: "/risks",
  meta: zhRisks.meta,
  ogImage: RISKS_OG_IMAGE,
});

export default function Page() {
  return <RisksPage common={zhCommon} dict={zhRisks} locale="zh" />;
}
