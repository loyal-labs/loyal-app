import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  fetchLibrary,
  type LibraryResponse,
  type RemoteLibraryArticle,
  type RemoteLibrarySection,
} from "@/services/api";

export type LibraryArticle = RemoteLibraryArticle;
export type LibrarySection = RemoteLibrarySection;

export type LibraryContent = {
  featured: LibraryArticle[];
  sections: LibrarySection[];
};

const EMPTY_CONTENT: LibraryContent = { featured: [], sections: [] };

export const LIBRARY_IMAGE_ASPECT = 740 / 480;

type StoreState = {
  content: LibraryContent;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  isLoaded: boolean;
};

export type LibraryContentState = {
  content: LibraryContent;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};

let storeState: StoreState = {
  content: EMPTY_CONTENT,
  isLoading: false,
  isRefreshing: false,
  error: null,
  isLoaded: false,
};
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): StoreState {
  return storeState;
}

function setStoreState(next: Partial<StoreState>) {
  storeState = { ...storeState, ...next };
  emit();
}

async function loadLibrary({ isRefresh }: { isRefresh: boolean }): Promise<void> {
  if (inflight) return inflight;

  setStoreState({
    isLoading: !storeState.isLoaded && !isRefresh,
    isRefreshing: isRefresh,
    error: null,
  });

  inflight = (async () => {
    try {
      const response: LibraryResponse = await fetchLibrary();
      setStoreState({
        content: {
          featured: response.featured,
          sections: response.sections,
        },
        isLoading: false,
        isRefreshing: false,
        error: null,
        isLoaded: true,
      });
    } catch (error) {
      setStoreState({
        isLoading: false,
        isRefreshing: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function useLibraryContent(): LibraryContentState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!storeState.isLoaded && !inflight) {
      void loadLibrary({ isRefresh: false });
    }
  }, []);

  const refresh = useCallback(() => loadLibrary({ isRefresh: true }), []);

  return {
    content: snapshot.content,
    isLoading: snapshot.isLoading,
    isRefreshing: snapshot.isRefreshing,
    error: snapshot.error,
    refresh,
  };
}

export function findLibraryArticleById(
  content: LibraryContent,
  id: string
): LibraryArticle | undefined {
  const featured = content.featured.find((article) => article.id === id);
  if (featured) return featured;
  for (const section of content.sections) {
    const match = section.articles.find((article) => article.id === id);
    if (match) return match;
  }
  return undefined;
}
