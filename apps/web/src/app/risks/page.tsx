import { enCommon } from "@/features/marketing/i18n/en/common";
import { enRisks } from "@/features/marketing/i18n/en/risks";
import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import {
  RISKS_OG_IMAGE,
  RisksPage,
} from "@/features/marketing/pages/risks-page";

export const metadata = buildPageMetadata({
  locale: "en",
  path: "/risks",
  meta: enRisks.meta,
  ogImage: RISKS_OG_IMAGE,
});

export default function Page() {
  return <RisksPage common={enCommon} dict={enRisks} locale="en" />;
}
