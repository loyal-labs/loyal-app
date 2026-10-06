import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import { ruCommon } from "@/features/marketing/i18n/ru/common";
import { ruTrust } from "@/features/marketing/i18n/ru/trust";
import { TRUST_OG_IMAGE, TrustPage } from "@/features/marketing/pages/trust-page";

export const metadata = buildPageMetadata({
  locale: "ru",
  path: "/trust",
  meta: ruTrust.meta,
  ogImage: TRUST_OG_IMAGE,
});

export default function Page() {
  return <TrustPage common={ruCommon} dict={ruTrust} locale="ru" />;
}
