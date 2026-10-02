import type { Metadata } from "next";

import { enCommon } from "@/features/marketing/i18n/en/common";
import { enLanding } from "@/features/marketing/i18n/en/landing";
import { alternateLanguages } from "@/features/marketing/i18n/locale";
import { LandingPage } from "@/features/marketing/pages/landing-page";

export const metadata: Metadata = {
  alternates: { canonical: "/", languages: alternateLanguages("/") },
};

export default function Page() {
  return <LandingPage common={enCommon} dict={enLanding} locale="en" />;
}
