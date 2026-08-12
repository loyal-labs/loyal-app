"use client";

import { createContext, useContext } from "react";

import type { PublicEnv } from "@/lib/core/config/public";

const PublicEnvContext = createContext<PublicEnv | null>(null);

type PublicEnvProviderProps = {
  children: React.ReactNode;
  value: PublicEnv;
};

export function PublicEnvProvider({
  children,
  value,
}: PublicEnvProviderProps) {
  return (
    <PublicEnvContext.Provider value={value}>
      {children}
    </PublicEnvContext.Provider>
  );
}

export function usePublicEnv(): PublicEnv {
  const value = useContext(PublicEnvContext);

  if (!value) {
    throw new Error("usePublicEnv must be used within a PublicEnvProvider");
  }

  return value;
}
