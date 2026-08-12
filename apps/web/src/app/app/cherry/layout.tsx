import type { Metadata, Viewport } from "next";

import { CherryDocumentScope } from "./cherry-document-scope";

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

export default function CherryEmbeddedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <CherryDocumentScope />
      {children}
    </>
  );
}
