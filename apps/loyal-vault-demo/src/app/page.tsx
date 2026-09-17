import { Dashboard } from "@/features/vault/ui/dashboard";
import { DemoWalletProvider } from "@/features/vault/ui/wallet-provider";

export default function Home() {
  return (
    <DemoWalletProvider>
      <Dashboard />
    </DemoWalletProvider>
  );
}
