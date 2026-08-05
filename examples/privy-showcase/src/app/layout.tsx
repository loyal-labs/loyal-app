import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./styles.css";

export const metadata: Metadata = {
  title: "Privy × Loyal — Smart Account Autodeposit",
  description:
    "Mainnet compatibility showcase for Privy embedded Solana wallets and Loyal/Squads smart accounts.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
