export type RealtimeResourceKey = string;

export type RealtimeResourceRefreshContext = {
  isCurrent: () => boolean;
  scope: string | null;
  signal: AbortSignal;
};

export type RealtimeResourceRefresh = (
  context: RealtimeResourceRefreshContext
) => Promise<unknown> | unknown;

export type RealtimeResourceRegistrationOptions = {
  handlesInFlightInvalidation?: boolean;
};

type ResourceRefreshRegistration = {
  options: RealtimeResourceRegistrationOptions;
  refresh: RealtimeResourceRefresh;
};

type ResourceRefreshState = {
  context: RealtimeResourceRefreshContext;
  dirty: boolean;
  inFlight: Promise<void> | null;
  started: boolean;
};

export class ResourceRefreshCoordinator {
  private disposed = false;
  private generation = 0;
  private readonly registrations = new Map<
    RealtimeResourceKey,
    ResourceRefreshRegistration
  >();
  private scopeController = new AbortController();
  private readonly states = new Map<
    RealtimeResourceKey,
    ResourceRefreshState
  >();
  private scope: string | null = null;

  setScope(scope: string | null): void {
    if (this.disposed || scope === this.scope) {
      return;
    }

    this.scopeController.abort();
    this.scopeController = new AbortController();
    this.scope = scope;
    this.generation += 1;
    this.states.clear();
  }

  register(
    resource: RealtimeResourceKey,
    refresh: RealtimeResourceRefresh,
    options: RealtimeResourceRegistrationOptions = {}
  ): () => void {
    const registration = { options, refresh };
    this.registrations.set(resource, registration);
    return () => {
      if (this.registrations.get(resource) === registration) {
        this.registrations.delete(resource);
      }
    };
  }

  invalidate(resources: readonly RealtimeResourceKey[]): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    const uniqueResources = Array.from(new Set(resources));
    return Promise.all(
      uniqueResources.map((resource) => this.run(resource))
    ).then(() => undefined);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    this.scopeController.abort();
    this.registrations.clear();
    this.states.clear();
  }

  private run(resource: RealtimeResourceKey): Promise<void> {
    const existing = this.states.get(resource);
    if (existing?.inFlight) {
      if (existing.started) {
        const registration = this.registrations.get(resource);
        if (registration?.options.handlesInFlightInvalidation) {
          try {
            void Promise.resolve(registration.refresh(existing.context)).catch(
              () => undefined
            );
          } catch {
            // The active invocation owns error reporting for this resource.
          }
        } else {
          existing.dirty = true;
        }
      }
      return existing.inFlight;
    }

    const generation = this.generation;
    const signal = this.scopeController.signal;
    const context: RealtimeResourceRefreshContext = {
      isCurrent: () =>
        !this.disposed && !signal.aborted && generation === this.generation,
      scope: this.scope,
      signal,
    };
    const state: ResourceRefreshState = existing ?? {
      context,
      dirty: false,
      inFlight: null,
      started: false,
    };
    state.context = context;
    const run = async () => {
      await Promise.resolve();
      state.started = true;
      let lastError: unknown;
      do {
        state.dirty = false;
        lastError = undefined;
        const registration = this.registrations.get(resource);
        if (!registration || !context.isCurrent()) {
          return;
        }
        try {
          await registration.refresh(context);
        } catch (error) {
          lastError = error;
        }
      } while (state.dirty && generation === this.generation);

      if (lastError !== undefined) {
        throw lastError;
      }
    };

    state.inFlight = run().finally(() => {
      if (this.states.get(resource) === state) {
        state.inFlight = null;
        state.started = false;
      }
    });
    this.states.set(resource, state);
    return state.inFlight;
  }
}
