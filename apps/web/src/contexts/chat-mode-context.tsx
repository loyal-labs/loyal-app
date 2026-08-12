"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

interface ChatModeContextType {
  isChatMode: boolean;
  setIsChatMode: (value: boolean) => void;
}

const ChatModeContext = createContext<ChatModeContextType | undefined>(
  undefined
);

export function ChatModeProvider({ children }: { children: ReactNode }) {
  const [isChatMode, setIsChatMode] = useState(false);

  return (
    <ChatModeContext.Provider value={{ isChatMode, setIsChatMode }}>
      {children}
    </ChatModeContext.Provider>
  );
}

export function useChatMode() {
  const context = useContext(ChatModeContext);
  if (context === undefined) {
    throw new Error("useChatMode must be used within a ChatModeProvider");
  }
  return context;
}
