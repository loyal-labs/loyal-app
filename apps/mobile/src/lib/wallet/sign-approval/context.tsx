import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { SignApprovalSheet } from "./SignApprovalSheet";
import type {
  SignApprovalContextValue,
  SignApprovalRequest,
} from "./types";

type PendingEntry = {
  id: string;
  request: SignApprovalRequest;
  resolve: (approved: boolean) => void;
};

const SignApprovalContext = createContext<SignApprovalContextValue | null>(null);

export function useSignApproval(): SignApprovalContextValue {
  const ctx = useContext(SignApprovalContext);
  if (!ctx) {
    throw new Error(
      "useSignApproval must be used inside a <SignApprovalProvider>.",
    );
  }
  return ctx;
}

export function SignApprovalProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingEntry | null>(null);
  const idCounter = useRef(0);

  const requestApproval = useCallback(
    (request: SignApprovalRequest) =>
      new Promise<boolean>((resolve) => {
        idCounter.current += 1;
        setPending({
          id: `sign-approval-${idCounter.current}`,
          request,
          resolve,
        });
      }),
    [],
  );

  const settle = useCallback((approved: boolean) => {
    setPending((current) => {
      current?.resolve(approved);
      return null;
    });
  }, []);

  const value = useMemo<SignApprovalContextValue>(
    () => ({ requestApproval }),
    [requestApproval],
  );

  return (
    <SignApprovalContext.Provider value={value}>
      {children}
      <SignApprovalSheet
        pending={pending?.request ?? null}
        onApprove={() => settle(true)}
        onReject={() => settle(false)}
      />
    </SignApprovalContext.Provider>
  );
}
