import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";

let xPixel: typeof import("../x-pixel");

type CreatedScript = { async: boolean; src: string };
const createdScripts: CreatedScript[] = [];

type Twq = ((...args: unknown[]) => void) & {
  exe?: (...args: unknown[]) => void;
  queue?: unknown[][];
  version?: string;
};

function getTwq(): Twq | undefined {
  return (globalThis as unknown as { window: { twq?: Twq } }).window.twq;
}

function setupFakeDom() {
  const headChildren: unknown[] = [];

  const fakeDocument = {
    createElement: () => {
      const script: Record<string, unknown> = {};
      Object.defineProperty(script, "async", {
        get: () => script._async,
        set: (value: boolean) => {
          script._async = value;
        },
      });
      Object.defineProperty(script, "src", {
        get: () => script._src,
        set: (value: string) => {
          script._src = value;
          createdScripts.push({
            async: script._async as boolean,
            src: value,
          });
        },
      });
      return script;
    },
    getElementsByTagName: () => [],
    head: {
      appendChild: (child: unknown) => {
        headChildren.push(child);
      },
    },
  };

  (globalThis as { window?: unknown }).window = {};
  (globalThis as { document?: unknown }).document = fakeDocument;
}

describe("x-pixel module", () => {
  beforeAll(async () => {
    xPixel = await import("../x-pixel");
  });

  beforeEach(() => {
    createdScripts.length = 0;
    setupFakeDom();
    xPixel.__resetXPixelForTests();
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  test("loadXPixel injects uwt.js, sets up twq stub, and calls config", () => {
    xPixel.loadXPixel();

    expect(createdScripts).toHaveLength(1);
    expect(createdScripts[0]).toEqual({
      async: true,
      src: xPixel.X_PIXEL_SCRIPT_SRC,
    });

    const twq = getTwq();
    expect(twq).toBeDefined();
    expect(typeof twq).toBe("function");
    expect(twq?.version).toBe("1.1");
    expect(twq?.queue).toEqual([["config", xPixel.X_PIXEL_ID]]);

    expect(xPixel.isXPixelLoaded()).toBe(true);
  });

  test("loadXPixel is idempotent", () => {
    xPixel.loadXPixel();
    xPixel.loadXPixel();
    xPixel.loadXPixel();

    expect(createdScripts).toHaveLength(1);
    expect(getTwq()?.queue).toEqual([["config", xPixel.X_PIXEL_ID]]);
  });

  test("xPixelEvent queues events after load (before uwt.js executes)", () => {
    xPixel.loadXPixel();
    xPixel.xPixelEvent(xPixel.X_PIXEL_EVENTS.signup);
    xPixel.xPixelEvent(xPixel.X_PIXEL_EVENTS.installExtension, { browser: "Chrome" });

    expect(getTwq()?.queue).toEqual([
      ["config", xPixel.X_PIXEL_ID],
      ["event", xPixel.X_PIXEL_EVENTS.signup, {}],
      [
        "event",
        xPixel.X_PIXEL_EVENTS.installExtension,
        { browser: "Chrome" },
      ],
    ]);
  });

  test("xPixelEvent routes through twq.exe once uwt.js executes", () => {
    xPixel.loadXPixel();
    const twq = getTwq();
    if (!twq) {
      throw new Error("twq stub should exist after loadXPixel");
    }
    const exeCalls: unknown[][] = [];
    twq.exe = (...args: unknown[]) => {
      exeCalls.push(args);
    };

    xPixel.xPixelEvent(xPixel.X_PIXEL_EVENTS.signup);
    expect(exeCalls).toEqual([
      ["event", xPixel.X_PIXEL_EVENTS.signup, {}],
    ]);
  });

  test("xPixelEvent no-ops when pixel has not been loaded", () => {
    xPixel.xPixelEvent(xPixel.X_PIXEL_EVENTS.installExtension);

    expect(getTwq()).toBeUndefined();
    expect(createdScripts).toHaveLength(0);
  });
});
