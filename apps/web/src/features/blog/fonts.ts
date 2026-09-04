import { IBM_Plex_Sans } from "next/font/google";

/**
 * Editorial italic face used only for blog post blockquotes (per the Figma
 * design). Exposed as a CSS variable and applied on the post article wrapper,
 * so the font is requested only on blog post pages, not site-wide.
 */
export const ibmPlexSans = IBM_Plex_Sans({
  weight: ["400"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});
