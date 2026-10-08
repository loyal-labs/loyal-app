import { enCommon } from "@/features/marketing/i18n/en/common";
import { enEarn } from "@/features/marketing/i18n/en/earn";
import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import { EARN_OG_IMAGE, EarnPage } from "@/features/marketing/pages/earn-page";

export const metadata = buildPageMetadata({
  locale: "en",
  path: "/earn",
  meta: enEarn.meta,
  ogImage: EARN_OG_IMAGE,
});

export default function Page() {
  return <EarnPage common={enCommon} dict={enEarn} locale="en" />;
}
