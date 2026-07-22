"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type BalanceVisibility = {
  isBalanceHidden: boolean;
  toggleBalanceHidden: () => void;
};

const BalanceVisibilityContext = createContext<BalanceVisibility>({
  isBalanceHidden: false,
  toggleBalanceHidden: () => {},
});

// One shell-wide flag so the sidebar eye hides every user-related number, the
// same way the old workspace's single isBalanceHidden state did.
export function BalanceVisibilityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isBalanceHidden, setIsBalanceHidden] = useState(false);
  const value = useMemo(
    () => ({
      isBalanceHidden,
      toggleBalanceHidden: () => setIsBalanceHidden((current) => !current),
    }),
    [isBalanceHidden]
  );
  return (
    <BalanceVisibilityContext.Provider value={value}>
      {children}
    </BalanceVisibilityContext.Provider>
  );
}

export function useBalanceVisibility() {
  return useContext(BalanceVisibilityContext);
}

// Soft blur for hidden numbers ("lg" for 40px headline numbers, "sm" for the
// rest) — deliberately NOT the old front's pixelation; the user prefers blur.
export function hiddenBalanceStyle(
  isHidden: boolean,
  size: "sm" | "lg" = "sm"
): CSSProperties | undefined {
  return isHidden
    ? { filter: size === "lg" ? "blur(10px)" : "blur(8px)", userSelect: "none" }
    : undefined;
}

// The reused ForecastChart hides values via the old front's filter ids
// (url(#rs-pixelate-*)); the facelift defines those ids as BLUR filters so the
// whole shell hides numbers consistently. The old views inline their own
// pixelating defs, so this does not affect them.
export function HiddenBalanceFilterDefs() {
  return (
    <svg
      aria-hidden="true"
      style={{ height: 0, position: "absolute", width: 0 }}
    >
      <defs>
        <filter id="rs-pixelate-lg">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id="rs-pixelate-sm">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>
    </svg>
  );
}
