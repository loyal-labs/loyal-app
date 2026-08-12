import { useLocalSearchParams } from "expo-router";

import { BrowserSiteScreen } from "@/features/dapp-browser/ui/BrowserSiteScreen";

export default function BrowserSiteRoute() {
  const { url } = useLocalSearchParams<{ url?: string | string[] }>();
  const initialUrl = Array.isArray(url) ? url[0] : url;

  if (!initialUrl) {
    return null;
  }

  return <BrowserSiteScreen initialUrl={initialUrl} />;
}
