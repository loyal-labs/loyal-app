import { enCommon } from "@/features/marketing/i18n/en/common";
import { enTrust } from "@/features/marketing/i18n/en/trust";
import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import {
  TRUST_OG_IMAGE,
  TrustPage,
} from "@/features/marketing/pages/trust-page";

export const metadata = buildPageMetadata({
  locale: "en",
  path: "/trust",
  meta: enTrust.meta,
  ogImage: TRUST_OG_IMAGE,
});

export default function Page() {
  return <TrustPage common={enCommon} dict={enTrust} locale="en" />;
}
