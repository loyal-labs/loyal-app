import { beforeAll, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/flags", () => ({
  getFlagsManifestUrl: () => undefined,
}));

mock.module("@/contexts/auth-session-context", () => ({
  useAuthSession: () => ({
    user: null,
  }),
}));

mock.module("@/contexts/public-env-context", () => ({
  usePublicEnv: () => ({
    appEnvironment: "development",
  }),
}));

let FeatureFlagsProvider: typeof import("./feature-flags-provider").FeatureFlagsProvider;
let useFeatureFlags: typeof import("./feature-flags-provider").useFeatureFlags;

function Probe() {
  const { isEnabled } = useFeatureFlags();

  return <div>{String(isEnabled("wallet_new_send_flow"))}</div>;
}

describe("FeatureFlagsProvider", () => {
  beforeAll(async () => {
    ({ FeatureFlagsProvider, useFeatureFlags } = await import(
      "./feature-flags-provider"
    ));
  });

  test("defaults unknown flags to false", () => {
    const markup = renderToStaticMarkup(
      <FeatureFlagsProvider>
        <Probe />
      </FeatureFlagsProvider>
    );

    expect(markup).toContain("false");
  });
});
