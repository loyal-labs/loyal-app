import * as SecureStore from "expo-secure-store";

import {
  forgetConnectedOrigin,
  listConnectedOrigins,
  rememberConnectedOrigin,
} from "../storage/connected-origins";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const secureStore = jest.mocked(SecureStore);

describe("dapp browser storage", () => {
  beforeEach(() => {
    secureStore.getItemAsync.mockReset();
    secureStore.setItemAsync.mockReset();
  });

  it("returns an empty connected origin list when nothing is stored", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(null);

    await expect(listConnectedOrigins()).resolves.toEqual([]);
  });

  it("stores connected origins without duplicates", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(JSON.stringify(["https://jup.ag"]));

    await rememberConnectedOrigin("https://jup.ag");

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "loyal.dappBrowser.connectedOrigins",
      JSON.stringify(["https://jup.ag"]),
    );
  });

  it("removes a connected origin from storage", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(
      JSON.stringify(["https://jup.ag", "https://example.com"]),
    );

    await forgetConnectedOrigin("https://jup.ag");

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "loyal.dappBrowser.connectedOrigins",
      JSON.stringify(["https://example.com"]),
    );
  });

});
