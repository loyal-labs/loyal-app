import {
  CREATE_WALLET_CONFIRM_DELAY_MS,
  getCreateWalletBackTarget,
  scheduleCreateWalletDeferredAction,
  scheduleCreateWalletConfirmTransition,
} from "../create-wallet-transition";

describe("getCreateWalletBackTarget", () => {
  it("returns to the chooser from the initial pin step and to pin from confirm", () => {
    expect(getCreateWalletBackTarget("pin")).toBe("chooser");
    expect(getCreateWalletBackTarget("confirm")).toBe("pin");
  });
});

describe("scheduleCreateWalletConfirmTransition", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("waits 500ms before advancing to confirm", () => {
    const onTransition = jest.fn();

    scheduleCreateWalletConfirmTransition("1234", onTransition);

    jest.advanceTimersByTime(CREATE_WALLET_CONFIRM_DELAY_MS - 1);
    expect(onTransition).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onTransition).toHaveBeenCalledWith("1234");
  });

  it("can be canceled before the confirm transition fires", () => {
    const onTransition = jest.fn();

    const cancel = scheduleCreateWalletConfirmTransition("1234", onTransition);
    cancel();

    jest.advanceTimersByTime(CREATE_WALLET_CONFIRM_DELAY_MS);
    expect(onTransition).not.toHaveBeenCalled();
  });
});

describe("scheduleCreateWalletDeferredAction", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("waits 500ms before running confirm-step work", () => {
    const onDeferred = jest.fn();

    scheduleCreateWalletDeferredAction(onDeferred);

    jest.advanceTimersByTime(CREATE_WALLET_CONFIRM_DELAY_MS - 1);
    expect(onDeferred).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onDeferred).toHaveBeenCalledTimes(1);
  });

  it("can cancel confirm-step work before it runs", () => {
    const onDeferred = jest.fn();

    const cancel = scheduleCreateWalletDeferredAction(onDeferred);
    cancel();

    jest.advanceTimersByTime(CREATE_WALLET_CONFIRM_DELAY_MS);
    expect(onDeferred).not.toHaveBeenCalled();
  });
});
