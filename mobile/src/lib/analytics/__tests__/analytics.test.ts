import { getWorkspaceEventName } from "../analytics";

jest.mock("@/config/env", () => ({
  env: {
    mixpanelToken: null,
  },
}));

jest.mock("@/lib/datadog/datadog", () => ({
  clearDatadogUser: jest.fn(),
  identifyDatadogUser: jest.fn(),
}));

jest.mock("mixpanel-react-native", () => ({
  Mixpanel: jest.fn(),
}));

describe("getWorkspaceEventName", () => {
  it("prefixes mobile events with the workspace", () => {
    expect(getWorkspaceEventName("Send Funds")).toBe("[mobile] Send Funds");
  });

  it("does not duplicate an existing workspace prefix", () => {
    expect(getWorkspaceEventName("[mobile] Send Funds")).toBe(
      "[mobile] Send Funds",
    );
  });
});
