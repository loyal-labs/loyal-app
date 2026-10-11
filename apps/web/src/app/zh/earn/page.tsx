import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import { zhCommon } from "@/features/marketing/i18n/zh/common";
import { zhEarn } from "@/features/marketing/i18n/zh/earn";
import { EARN_OG_IMAGE, EarnPage } from "@/features/marketing/pages/earn-page";

export const metadata = buildPageMetadata({
  locale: "zh",
  path: "/earn",
  meta: zhEarn.meta,
  ogImage: EARN_OG_IMAGE,
});

export default function Page() {
  return <EarnPage common={zhCommon} dict={zhEarn} locale="zh" />;
}
