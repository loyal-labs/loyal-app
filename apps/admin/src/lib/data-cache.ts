export const DATA_CACHE_TTL_SECONDS = 60;

export const CACHE_TAGS = {
  communitiesList: "communities:list",
  overview: "overview",
  communityPrefix: "community",
} as const;

export function communityTag(communityId: string) {
  return `${CACHE_TAGS.communityPrefix}:${communityId}`;
}
