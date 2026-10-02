import { enCommon } from "@/features/marketing/i18n/en/common";
import { enLanding } from "@/features/marketing/i18n/en/landing";
import { LandingPage } from "@/features/marketing/pages/landing-page";

export default function Page() {
  return <LandingPage common={enCommon} dict={enLanding} locale="en" />;
}
