import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { fetchTrustedDapps } from "@/services/api";

import { coerceBrowserUrl } from "../model/origin";
import { TRUSTED_DAPPS } from "../model/trusted-dapps";
import type { TrustedDapp } from "../model/types";
import { buildBrowserSiteHref } from "../routes";
import { BrowserHome } from "./BrowserHome";

export function BrowserHomeScreen() {
  const router = useRouter();
  const [urlInput, setUrlInput] = useState("");
  const [dapps, setDapps] = useState<TrustedDapp[]>(TRUSTED_DAPPS);

  useEffect(() => {
    let cancelled = false;
    fetchTrustedDapps()
      .then((remote) => {
        if (cancelled || remote.length === 0) return;
        setDapps(
          remote.map((dapp) => ({
            origin: dapp.origin,
            name: dapp.name,
            startUrl: dapp.startUrl,
            category: dapp.category,
          })),
        );
      })
      .catch(() => {
        // Keep local fallback list when the network call fails.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const navigateToSite = useCallback(
    (rawUrl: string) => {
      const url = coerceBrowserUrl(rawUrl);
      router.push(buildBrowserSiteHref(url));
    },
    [router],
  );

  const handleSubmitUrl = useCallback(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    navigateToSite(trimmed);
    setUrlInput("");
  }, [navigateToSite, urlInput]);

  const handleOpenTrustedDapp = useCallback(
    (dapp: TrustedDapp) => navigateToSite(dapp.startUrl),
    [navigateToSite],
  );

  return (
    <BrowserHome
      trustedDapps={dapps}
      urlInput={urlInput}
      onChangeUrlInput={setUrlInput}
      onSubmitUrlInput={handleSubmitUrl}
      onOpenTrustedDapp={handleOpenTrustedDapp}
    />
  );
}
