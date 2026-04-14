export type OnboardingSlidePlaybackState = {
  currentIndex: number;
  autoAdvanceEnabled: boolean;
};

type OnboardingMomentumEndEvent = {
  nativeEvent: {
    contentOffset: {
      x: number;
    };
  };
};

type SyncOnboardingSlidePlaybackIndexOptions = {
  offsetX: number;
  width: number;
  slideCount: number;
};

export function createOnboardingSlidePlaybackState(): OnboardingSlidePlaybackState {
  return {
    currentIndex: 0,
    autoAdvanceEnabled: true,
  };
}

export function advanceOnboardingSlidePlayback(
  state: OnboardingSlidePlaybackState,
  slideCount: number,
): OnboardingSlidePlaybackState {
  if (!state.autoAdvanceEnabled || slideCount <= 1) {
    return state;
  }

  return {
    ...state,
    currentIndex: (state.currentIndex + 1) % slideCount,
  };
}

export function disableOnboardingSlidePlayback(
  state: OnboardingSlidePlaybackState,
): OnboardingSlidePlaybackState {
  if (!state.autoAdvanceEnabled) {
    return state;
  }

  return {
    ...state,
    autoAdvanceEnabled: false,
  };
}

export function syncOnboardingSlidePlaybackIndex(
  state: OnboardingSlidePlaybackState,
  {
    offsetX,
    width,
    slideCount,
  }: SyncOnboardingSlidePlaybackIndexOptions,
): OnboardingSlidePlaybackState {
  if (slideCount <= 0 || width <= 0) {
    return state;
  }

  const nextIndex = Math.max(
    0,
    Math.min(Math.round(offsetX / width), slideCount - 1),
  );

  if (nextIndex === state.currentIndex) {
    return state;
  }

  return {
    ...state,
    currentIndex: nextIndex,
  };
}

export function createOnboardingMomentumEndUpdater(
  event: OnboardingMomentumEndEvent,
  width: number,
  slideCount: number,
): (state: OnboardingSlidePlaybackState) => OnboardingSlidePlaybackState {
  const offsetX = event.nativeEvent.contentOffset.x;

  return (state) =>
    syncOnboardingSlidePlaybackIndex(state, {
      offsetX,
      width,
      slideCount,
    });
}
