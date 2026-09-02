"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

type SignInModalContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** Open the modal itself, bypassing any registered sign-in handler. */
  openAccount: () => void;
  /**
   * Register a sign-in handler. When set, `open()` calls it instead of
   * showing the modal (Privy opens its own modal). Return false to fall
   * through to the modal.
   */
  registerHandler: (handler: (() => boolean) | null) => void;
};

const SignInModalContext = createContext<SignInModalContextValue | null>(null);

export function SignInModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const handlerRef = useRef<(() => boolean) | null>(null);

  const open = useCallback(() => {
    if (handlerRef.current?.()) return;
    setIsOpen(true);
  }, []);
  const openAccount = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const registerHandler = useCallback((handler: (() => boolean) | null) => {
    handlerRef.current = handler;
  }, []);

  const value = useMemo(
    () => ({ isOpen, open, close, openAccount, registerHandler }),
    [isOpen, open, close, openAccount, registerHandler]
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
