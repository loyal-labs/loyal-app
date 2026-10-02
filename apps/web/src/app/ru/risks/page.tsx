import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import { ruCommon } from "@/features/marketing/i18n/ru/common";
import { ruRisks } from "@/features/marketing/i18n/ru/risks";
import { RISKS_OG_IMAGE, RisksPage } from "@/features/marketing/pages/risks-page";

export const metadata = buildPageMetadata({
  locale: "ru",
  path: "/risks",
  meta: ruRisks.meta,
  ogImage: RISKS_OG_IMAGE,
});

export default function Page() {
  return <RisksPage common={ruCommon} dict={ruRisks} locale="ru" />;
}
