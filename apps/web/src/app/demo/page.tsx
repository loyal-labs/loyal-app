import type { Metadata } from "next";

import { DemoStart } from "@/features/demo/ui/demo-start";

export const metadata: Metadata = {
  title: "Money that moves itself | Loyal",
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return <DemoStart />;
}
