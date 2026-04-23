"use client";

import { createContext, useContext } from "react";

type FeatureFlagsContextValue = {
  isEnabled: (key: string) => boolean;
  version: string | null;
};

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | null>(null);

export function FeatureFlagsContextProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: FeatureFlagsContextValue;
}) {
  return (
    <FeatureFlagsContext.Provider value={value}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlagsContext() {
  const value = useContext(FeatureFlagsContext);

  if (!value) {
    throw new Error(
      "useFeatureFlagsContext must be used within FeatureFlagsContextProvider"
    );
  }

  return value;
}

