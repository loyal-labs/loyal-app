import type { Metadata, Viewport } from "next";

import { CherryMobileDocumentScope } from "./cherry-mobile-document-scope";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
};

export const viewport: Viewport = {
  initialScale: 1,
  viewportFit: "cover",
  width: "device-width",
};

export default function CherryMobileLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <CherryMobileDocumentScope />
      {children}
    </>
  );
}
