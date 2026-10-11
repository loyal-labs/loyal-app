import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import { zhCommon } from "@/features/marketing/i18n/zh/common";
import { zhTrust } from "@/features/marketing/i18n/zh/trust";
import { TRUST_OG_IMAGE, TrustPage } from "@/features/marketing/pages/trust-page";

export const metadata = buildPageMetadata({
  locale: "zh",
  path: "/trust",
  meta: zhTrust.meta,
  ogImage: TRUST_OG_IMAGE,
});

export default function Page() {
  return <TrustPage common={zhCommon} dict={zhTrust} locale="zh" />;
}
