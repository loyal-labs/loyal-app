import { useEffect, useState } from "react";

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

export type LibraryContentState = {
  content: LibraryContent;
  isLoading: boolean;
  error: Error | null;
};

export function useLibraryContent(): LibraryContentState {
  const [state, setState] = useState<LibraryContentState>({
    content: EMPTY_CONTENT,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    fetchLibrary()
      .then((response: LibraryResponse) => {
        if (cancelled) return;
        setState({
          content: {
            featured: response.featured,
            sections: response.sections,
          },
          isLoading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          content: EMPTY_CONTENT,
          isLoading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
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
