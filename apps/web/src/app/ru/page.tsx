import { buildPageMetadata } from "@/features/marketing/i18n/metadata";
import { ruCommon } from "@/features/marketing/i18n/ru/common";
import { ruLanding } from "@/features/marketing/i18n/ru/landing";
import { LandingPage } from "@/features/marketing/pages/landing-page";

const HOME_OG_IMAGE = {
  url: "https://askloyal.com/og-home-2026-08.png",
  width: 1200,
  height: 640,
};

export const metadata = buildPageMetadata({
  locale: "ru",
  path: "/",
  meta: ruLanding.meta,
  ogImage: HOME_OG_IMAGE,
});

export default function Page() {
  return <LandingPage common={ruCommon} dict={ruLanding} locale="ru" />;
}
