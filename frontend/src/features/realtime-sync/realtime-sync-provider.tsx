"use client";

import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";

import {
  ResourceRefreshCoordinator,
  type RealtimeResourceKey,
  type RealtimeResourceRefresh,
  type RealtimeResourceRegistrationOptions,
} from "./resource-refresh-coordinator";

type RealtimeSyncContextValue = {
  invalidate: (resources: readonly RealtimeResourceKey[]) => Promise<void>;
  register: (
    resource: RealtimeResourceKey,
    refresh: RealtimeResourceRefresh,
    options?: RealtimeResourceRegistrationOptions
  ) => () => void;
  setScope: (scope: string | null) => void;
};

const RealtimeSyncContext = createContext<RealtimeSyncContextValue | null>(
  null
);

export function RealtimeSyncProvider({ children }: PropsWithChildren) {
  const coordinatorRef = useRef<ResourceRefreshCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new ResourceRefreshCoordinator();
  }

  const invalidate = useCallback(
    (resources: readonly RealtimeResourceKey[]) =>
      coordinatorRef.current?.invalidate(resources) ?? Promise.resolve(),
    []
  );
  const register = useCallback(
    (
      resource: RealtimeResourceKey,
      refresh: RealtimeResourceRefresh,
      options?: RealtimeResourceRegistrationOptions
    ) =>
      coordinatorRef.current?.register(resource, refresh, options) ??
      (() => undefined),
    []
  );
  const setScope = useCallback((scope: string | null) => {
    coordinatorRef.current?.setScope(scope);
  }, []);
  useEffect(
    () => () => {
      coordinatorRef.current?.dispose();
    },
    []
  );

  return (
    <RealtimeSyncContext.Provider value={{ invalidate, register, setScope }}>
      {children}
    </RealtimeSyncContext.Provider>
  );
}

export function useRealtimeSync() {
  const context = useContext(RealtimeSyncContext);
  if (!context) {
    throw new Error(
      "useRealtimeSync must be used within RealtimeSyncProvider."
    );
  }
  return context;
}

export function useRealtimeResource(
  resource: RealtimeResourceKey,
  refresh: RealtimeResourceRefresh,
  options?: RealtimeResourceRegistrationOptions
): void {
  const { register } = useRealtimeSync();
  const handlesInFlightInvalidation =
    options?.handlesInFlightInvalidation ?? false;
  useEffect(
    () => register(resource, refresh, { handlesInFlightInvalidation }),
    [handlesInFlightInvalidation, refresh, register, resource]
  );
}

export function useRealtimeSyncScope(scope: string | null): void {
  const { setScope } = useRealtimeSync();
  useEffect(() => {
    setScope(scope);
    return () => setScope(null);
  }, [scope, setScope]);
}
