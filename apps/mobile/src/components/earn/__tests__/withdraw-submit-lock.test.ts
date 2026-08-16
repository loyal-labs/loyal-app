import { acquireWithdrawSubmitLock } from "../withdraw-submit-lock";

describe("withdraw submit lock", () => {
  it("prevents an overlapping submit and permits the next one after release", async () => {
    const lock = { current: false };
    const effects: string[] = [];
    let finishFirst: (() => void) | undefined;

    const submit = async (
      effect: () => void | Promise<void>,
    ): Promise<boolean> => {
      const release = acquireWithdrawSubmitLock(lock);
      if (!release) {
        return false;
      }
      try {
        await effect();
        return true;
      } finally {
        release();
      }
    };

    const first = submit(
      () =>
        new Promise<void>((resolve) => {
          effects.push("first");
          finishFirst = resolve;
        }),
    );
    const overlapping = await submit(() => {
      effects.push("overlapping");
    });

    expect(overlapping).toBe(false);
    expect(effects).toEqual(["first"]);

    finishFirst?.();
    await first;

    const next = await submit(() => {
      effects.push("next");
    });
    expect(next).toBe(true);
    expect(effects).toEqual(["first", "next"]);
  });

  it("makes release idempotent and allows reacquisition", async () => {
    const lock = { current: false };
    const release = acquireWithdrawSubmitLock(lock);

    expect(release).not.toBeNull();
    release?.();
    release?.();

    expect(acquireWithdrawSubmitLock(lock)).not.toBeNull();
  });
});
