import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import { zhCommon } from "@/features/marketing/i18n/zh/common";
import { zhLanding } from "@/features/marketing/i18n/zh/landing";
import { LandingPage } from "@/features/marketing/pages/landing-page";

const HOME_OG_IMAGE = {
  url: "https://askloyal.com/og-home-2026-08.png",
  width: 1200,
  height: 640,
};

export const metadata = buildPageMetadata({
  locale: "zh",
  path: "/",
  meta: zhLanding.meta,
  ogImage: HOME_OG_IMAGE,
});

export default function Page() {
  return <LandingPage common={zhCommon} dict={zhLanding} locale="zh" />;
}
