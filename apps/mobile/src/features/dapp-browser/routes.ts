import type { Href } from "expo-router";

export function buildBrowserHref(): Href {
  return "/browser" as Href;
}

export function buildBrowserSiteHref(url: string): Href {
  return {
    pathname: "/browser/site",
    params: { url },
  } as Href;
}
