import { describe, expect, test } from "bun:test";

import { resolveEarnRealtimeEventsUrl } from "./earn-realtime";

describe("Earn realtime events URL", () => {
  test("uses localhost only for an actual local runtime", () => {
    expect(resolveEarnRealtimeEventsUrl({}, "local")).toBe(
      "http://127.0.0.1:10000/events"
    );
  });

  test.each(["preview", "production", "development"])(
    "uses the hosted stream for a Vercel %s deployment mislabelled as local",
    (vercelEnvironment) => {
      expect(
        resolveEarnRealtimeEventsUrl(
          { VERCEL_ENV: vercelEnvironment },
          "local"
        )
      ).toBe("https://loyal-yield-realtime.onrender.com/events");
    }
  );

  test("keeps an explicit stream override", () => {
    expect(
      resolveEarnRealtimeEventsUrl(
        {
          REALTIME_EVENTS_URL: "https://realtime.example.com/events",
          VERCEL_ENV: "preview",
        },
        "local"
      )
    ).toBe("https://realtime.example.com/events");
  });
});
