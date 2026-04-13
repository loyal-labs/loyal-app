import * as SecureStore from "expo-secure-store";

import {
  forgetConnectedOrigin,
  listConnectedOrigins,
  rememberConnectedOrigin,
} from "../storage/connected-origins";
import { listRecentHistory, recordRecentHistory } from "../storage/recent-history";

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

  it("caps recent history at twenty entries and moves the latest origin to the front", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(
      JSON.stringify(
        Array.from({ length: 20 }, (_, index) => ({
          origin: `https://site-${index}.example`,
          url: `https://site-${index}.example/page`,
          title: `Site ${index}`,
          lastVisitedAt: index,
        })),
      ),
    );

    await recordRecentHistory({
      origin: "https://site-5.example",
      url: "https://site-5.example/updated",
      title: "Updated site 5",
      lastVisitedAt: 999,
    });

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "loyal.dappBrowser.recentHistory",
      JSON.stringify([
        {
          origin: "https://site-5.example",
          url: "https://site-5.example/updated",
          title: "Updated site 5",
          lastVisitedAt: 999,
        },
        ...Array.from({ length: 19 }, (_, index) => ({
          origin: `https://site-${index < 5 ? index : index + 1}.example`,
          url: `https://site-${index < 5 ? index : index + 1}.example/page`,
          title: `Site ${index < 5 ? index : index + 1}`,
          lastVisitedAt: index < 5 ? index : index + 1,
        })),
      ]),
    );
  });

  it("returns an empty recent history list when nothing is stored", async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(null);

    await expect(listRecentHistory()).resolves.toEqual([]);
  });
});
