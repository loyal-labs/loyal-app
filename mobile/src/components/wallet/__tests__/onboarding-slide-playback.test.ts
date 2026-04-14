import {
  advanceOnboardingSlidePlayback,
  createOnboardingMomentumEndUpdater,
  createOnboardingSlidePlaybackState,
  disableOnboardingSlidePlayback,
  syncOnboardingSlidePlaybackIndex,
} from "../onboarding-slide-playback";

describe("advanceOnboardingSlidePlayback", () => {
  it("advances to the next slide and loops back to the first slide", () => {
    const firstTick = advanceOnboardingSlidePlayback(
      createOnboardingSlidePlaybackState(),
      3,
    );
    expect(firstTick).toMatchObject({
      currentIndex: 1,
      autoAdvanceEnabled: true,
    });

    const looped = advanceOnboardingSlidePlayback(
      {
        currentIndex: 2,
        autoAdvanceEnabled: true,
      },
      3,
    );
    expect(looped).toMatchObject({
      currentIndex: 0,
      autoAdvanceEnabled: true,
    });
  });

  it("stops advancing after a user swipe disables autoplay", () => {
    const disabled = disableOnboardingSlidePlayback({
      currentIndex: 1,
      autoAdvanceEnabled: true,
    });

    expect(disabled).toMatchObject({
      currentIndex: 1,
      autoAdvanceEnabled: false,
    });
    expect(advanceOnboardingSlidePlayback(disabled, 3)).toEqual(disabled);
  });
});

describe("syncOnboardingSlidePlaybackIndex", () => {
  it("maps scroll offsets to a bounded slide index", () => {
    const state = syncOnboardingSlidePlaybackIndex(
      createOnboardingSlidePlaybackState(),
      {
        offsetX: 750,
        width: 375,
        slideCount: 3,
      },
    );
    expect(state.currentIndex).toBe(2);

    const bounded = syncOnboardingSlidePlaybackIndex(state, {
      offsetX: 9999,
      width: 375,
      slideCount: 3,
    });
    expect(bounded.currentIndex).toBe(2);
  });
});

describe("createOnboardingMomentumEndUpdater", () => {
  it("captures the scroll offset before the synthetic event is released", () => {
    const event = {
      nativeEvent: {
        contentOffset: { x: 750 },
      },
    } as const;

    const updater = createOnboardingMomentumEndUpdater(event, 375, 3);
    (event as { nativeEvent: null | { contentOffset: { x: number } } }).nativeEvent =
      null;

    const nextState = updater(createOnboardingSlidePlaybackState());
    expect(nextState.currentIndex).toBe(2);
  });
});
