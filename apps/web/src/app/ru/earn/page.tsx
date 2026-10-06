import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import { ruCommon } from "@/features/marketing/i18n/ru/common";
import { ruEarn } from "@/features/marketing/i18n/ru/earn";
import { EARN_OG_IMAGE, EarnPage } from "@/features/marketing/pages/earn-page";

export const metadata = buildPageMetadata({
  locale: "ru",
  path: "/earn",
  meta: ruEarn.meta,
  ogImage: EARN_OG_IMAGE,
});

export default function Page() {
  return <EarnPage common={ruCommon} dict={ruEarn} locale="ru" />;
}
