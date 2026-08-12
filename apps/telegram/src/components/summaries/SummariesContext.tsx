"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getCloudValue,
  setCloudValue,
} from "@/lib/telegram/mini-app/cloud-storage";

import type { ChatSummary } from "./SummaryFeed";

const SESSION_STORAGE_KEY = "summaries_cache";
const CLOUD_STORAGE_KEY = "summaries_cache";
const CLOUD_MAX_SIZE = 3500; // Leave margin under 4096 limit

type SummariesContextType = {
  summaries: ChatSummary[];
  setSummaries: (summaries: ChatSummary[]) => void;
  hasCachedData: boolean;
};

const SummariesContext = createContext<SummariesContextType>({
  summaries: [],
  setSummaries: () => {},
  hasCachedData: false,
});

// Strip photos from summaries to fit in cloud storage (4KB limit)
function stripPhotos(summaries: ChatSummary[]): Omit<ChatSummary, "photoBase64" | "photoMimeType">[] {
  return summaries.map((summary) => {
    const copy = { ...summary };
    delete copy.photoBase64;
    delete copy.photoMimeType;
    return copy;
  });
}

// Trim summaries to fit within size limit
function trimToFit(summaries: ChatSummary[], maxSize: number): ChatSummary[] {
  // Start with all summaries, remove oldest until it fits
  let trimmed = [...summaries];
  let json = JSON.stringify(trimmed);

  while (json.length > maxSize && trimmed.length > 0) {
    trimmed = trimmed.slice(0, -1); // Remove last (oldest) summary
    json = JSON.stringify(trimmed);
  }

  return trimmed;
}

function loadFromSession(): ChatSummary[] {
  if (typeof window === "undefined") return [];
  try {
    const cached = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
}

async function loadFromCloud(): Promise<ChatSummary[]> {
  try {
    const cached = await getCloudValue(CLOUD_STORAGE_KEY);
    if (cached && typeof cached === "string") {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.error("Failed to load summaries from cloud storage:", error);
  }
  return [];
}

async function saveToCloud(summaries: ChatSummary[]): Promise<void> {
  try {
    // Strip photos and trim to fit
    const stripped = stripPhotos(summaries);
    const trimmed = trimToFit(stripped, CLOUD_MAX_SIZE);
    await setCloudValue(CLOUD_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error("Failed to save summaries to cloud storage:", error);
  }
}

export function SummariesProvider({ children }: { children: ReactNode }) {
  const [summaries, setSummariesState] = useState<ChatSummary[]>([]);
  const [hasCachedData, setHasCachedData] = useState(false);
  const cloudLoadedRef = useRef(false);

  // Load from session storage first (instant), then cloud storage (async)
  useEffect(() => {
    // 1. Session storage - instant
    const sessionCached = loadFromSession();
    if (sessionCached.length > 0) {
      setSummariesState(sessionCached);
      setHasCachedData(true);
    }

    // 2. Cloud storage - async, provides cross-device sync
    if (!cloudLoadedRef.current) {
      cloudLoadedRef.current = true;
      loadFromCloud().then((cloudCached) => {
        if (cloudCached.length > 0) {
          // Only use cloud data if we don't have session data
          // (session data is more complete with photos)
          setSummariesState((current) => {
            if (current.length === 0) {
              setHasCachedData(true);
              return cloudCached;
            }
            return current;
          });
        }
      });
    }
  }, []);

  const setSummaries = useCallback((newSummaries: ChatSummary[]) => {
    setSummariesState(newSummaries);
    setHasCachedData(newSummaries.length > 0);

    // Save to session storage (full data with photos)
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSummaries));
    } catch {
      // Storage full or unavailable
    }

    // Save to cloud storage (without photos, for cross-device sync)
    saveToCloud(newSummaries);
  }, []);

  const value = useMemo(
    () => ({ summaries, setSummaries, hasCachedData }),
    [summaries, setSummaries, hasCachedData]
  );

  return (
    <SummariesContext.Provider value={value}>
      {children}
    </SummariesContext.Provider>
  );
}

export function useSummaries(): SummariesContextType {
  return useContext(SummariesContext);
}
