"use client";

import type { PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type UserChat = {
  id: string;
  clientChatId: string | null;
  title: string | null;
  lastMessageAt: string | null;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  clientMessageId: string | null;
  createdAt: string;
};

type UserChatsContextValue = {
  userChats: UserChat[];
  isLoading: boolean;
  refreshUserChats: () => Promise<void>;
  clearUserChats: () => void;
  loadChatMessages: (chatId: string) => Promise<ChatMessage[]>;
};

const UserChatsContext = createContext<UserChatsContextValue | undefined>(
  undefined
);

export const UserChatsProvider = ({ children }: PropsWithChildren) => {
  const [userChats, setUserChats] = useState<UserChat[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refreshUserChats = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/chats");
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as { chats: UserChat[] };
      setUserChats(data.chats);
    } catch {
      // Silently fail — sidebar just stays empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadChatMessages = useCallback(
    async (chatId: string): Promise<ChatMessage[]> => {
      try {
        const res = await fetch(`/api/chats/${chatId}/messages`);
        if (!res.ok) {
          return [];
        }
        const data = (await res.json()) as { messages: ChatMessage[] };
        return data.messages;
      } catch {
        return [];
      }
    },
    []
  );

  const clearUserChats = useCallback(() => {
    setUserChats([]);
  }, []);

  // No auto-fetch on mount — consumers call refreshUserChats()
  // when auth state is ready (avoids fetching before auth hydrates).

  const value = useMemo<UserChatsContextValue>(
    () => ({
      userChats,
      isLoading,
      refreshUserChats,
      clearUserChats,
      loadChatMessages,
    }),
    [userChats, isLoading, refreshUserChats, clearUserChats, loadChatMessages]
  );

  return (
    <UserChatsContext.Provider value={value}>
      {children}
    </UserChatsContext.Provider>
  );
};

export const useUserChats = () => {
  const context = useContext(UserChatsContext);
  if (!context) {
    throw new Error("useUserChats must be used within a UserChatsProvider");
  }
  return context;
};
