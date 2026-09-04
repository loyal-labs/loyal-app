import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const dashboardUrl =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://dashboard.askloyal.com";

export const metadata: Metadata = {
  title: {
    default: "Loyal Performance Dashboard",
    template: "%s | Loyal Performance",
  },
  description:
    "Public Loyal performance, reliability, and Earn metrics for customers and partners.",
  metadataBase: new URL(dashboardUrl),
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Loyal Performance",
    title: "Loyal Performance Dashboard",
    description:
      "Public Loyal performance, reliability, and Earn metrics for customers and partners.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Loyal Performance Dashboard",
    description:
      "Public Loyal performance, reliability, and Earn metrics for customers and partners.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
