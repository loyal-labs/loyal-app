"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type SignInModalContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** Register an external handler (e.g. sidebar) to intercept open/close */
  registerHandler: (handler: { open: () => void; close: () => void } | null) => void;
};

const SignInModalContext = createContext<SignInModalContextValue | null>(null);

export function SignInModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const handlerRef = useRef<{ open: () => void; close: () => void } | null>(null);

  const open = useCallback(() => {
    if (handlerRef.current) {
      handlerRef.current.open();
    } else {
      setIsOpen(true);
    }
  }, []);

  const close = useCallback(() => {
    if (handlerRef.current) {
      handlerRef.current.close();
    } else {
      setIsOpen(false);
    }
  }, []);

  const registerHandler = useCallback(
    (handler: { open: () => void; close: () => void } | null) => {
      handlerRef.current = handler;
    },
    []
  );

  const value = useMemo(
    () => ({ isOpen, open, close, registerHandler }),
    [isOpen, open, close, registerHandler]
  );

  return (
    <SignInModalContext.Provider value={value}>
      {children}
    </SignInModalContext.Provider>
  );
}

export function useSignInModal() {
  const context = useContext(SignInModalContext);
  if (!context) {
    throw new Error("useSignInModal must be used within SignInModalProvider");
  }
  return context;
}
