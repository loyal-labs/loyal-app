import { serverEnv } from "./config/server";
import { encodeObjectPath, joinObjectPaths } from "./object-path";

export type CdnQueryValue = string | number | boolean | null | undefined;

export type ResolveCloudflareCdnUrlInput = {
  key: string;
  query?: Record<string, CdnQueryValue>;
};

export type ResolveCloudflareCdnUrlOptions = {
  query?: Record<string, CdnQueryValue>;
};

export type CloudflareCdnUrlClientConfig = {
  baseUrl: string;
  keyPrefix?: string;
  defaultQuery?: Record<string, CdnQueryValue>;
};

export type CloudflareCdnUrlClient = {
  resolveUrl: (input: ResolveCloudflareCdnUrlInput) => string;
  resolveUrls: (
    keys: string[],
    options?: ResolveCloudflareCdnUrlOptions
  ) => string[];
};

let clientFromEnv: CloudflareCdnUrlClient | null = null;

function normalizeBaseUrl(baseUrl: string): URL {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  return new URL(normalizedBase);
}

function appendQuery(url: URL, query?: Record<string, CdnQueryValue>): void {
  if (!query) return;

  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(name, String(value));
  }
}

export function getCloudflareCdnBaseUrlFromEnv(): string | null {
  return serverEnv.cloudflareCdnBaseUrl;
}

export function createCloudflareCdnUrlClient(
  config: CloudflareCdnUrlClientConfig
): CloudflareCdnUrlClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  const resolveUrl = (input: ResolveCloudflareCdnUrlInput): string => {
    const keyWithPrefix = joinObjectPaths(
      config.keyPrefix,
      input.key,
      "CDN key"
    );
    const encodedKey = encodeObjectPath(keyWithPrefix);

    const basePath = baseUrl.pathname.replace(/\/$/, "");
    const url = new URL(`${basePath}/${encodedKey}`, baseUrl);
    appendQuery(url, config.defaultQuery);
    appendQuery(url, input.query);
    return url.toString();
  };

  const resolveUrls = (
    keys: string[],
    options?: ResolveCloudflareCdnUrlOptions
  ): string[] => keys.map((key) => resolveUrl({ key, query: options?.query }));

  return { resolveUrl, resolveUrls };
}

export function getCloudflareCdnUrlClientFromEnv(): CloudflareCdnUrlClient {
  if (clientFromEnv) {
    return clientFromEnv;
  }

  const baseUrl = getCloudflareCdnBaseUrlFromEnv();
  if (!baseUrl) {
    throw new Error(
      "CDN base URL is not set. Configure CLOUDFLARE_CDN_BASE_URL or NEXT_PUBLIC_CLOUDFLARE_CDN_BASE_URL"
    );
  }

  clientFromEnv = createCloudflareCdnUrlClient({
    baseUrl,
    keyPrefix: serverEnv.cloudflareR2UploadPrefix,
  });

  return clientFromEnv;
}
