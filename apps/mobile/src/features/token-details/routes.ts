import type { Href } from "expo-router";

export function buildTokenDetailHref(mint: string): Href {
  return `/token/${mint}` as Href;
}
