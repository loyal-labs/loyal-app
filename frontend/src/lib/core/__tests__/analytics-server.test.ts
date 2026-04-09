import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const track = mock();
const updateWorkspaceProfile = mock();
const createMixpanelServerClient = mock(() => ({
  track,
  updateWorkspaceProfile,
}));

mock.module("@loyal-labs/shared/analytics-server", () => ({
  createMixpanelServerClient,
}));

let analyticsServer: typeof import("../analytics-server");

describe("frontend server analytics wrapper", () => {
  beforeAll(async () => {
    process.env.PHALA_API_KEY = "test-key";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.NEXT_PUBLIC_MIXPANEL_TOKEN = "frontend-server-token";
    analyticsServer = await import("../analytics-server");
  });

  beforeEach(() => {
    createMixpanelServerClient.mockClear();
    track.mockClear();
    updateWorkspaceProfile.mockClear();
  });

  test("configures website workspace and refreshes workspace adoption for distinct ids", () => {
    analyticsServer.trackServerAnalyticsEvent("chat_thread_created", {
      distinct_id: "wallet:wallet-address",
      chat_id: "chat-123",
      source: "main_chat_input",
    });

    expect(createMixpanelServerClient).toHaveBeenCalledWith({
      token: "frontend-server-token",
      workspace: "website",
    });
    expect(track).toHaveBeenCalledWith("chat_thread_created", {
      distinct_id: "wallet:wallet-address",
      chat_id: "chat-123",
      source: "main_chat_input",
    });
    expect(updateWorkspaceProfile).toHaveBeenCalledWith(
      "wallet:wallet-address"
    );
  });
});
