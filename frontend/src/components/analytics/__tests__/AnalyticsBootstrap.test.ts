import { describe, expect, test } from "bun:test";

import {
  shouldTrackAuthSignInSuccess,
  shouldTrackFrontendPageView,
} from "../AnalyticsBootstrap";
import {
  buildUsercentricsDecisions,
  getAnalyticsConsentFromServices,
  getChoicesFromServices,
  getServiceConsentCategory,
  type ConsentService,
} from "../landing-cookie-consent";
import { getLandingAnchorClickProperties } from "../LandingAnalyticsBootstrap";
import { getFrontendPageViewEventName } from "@/lib/core/analytics";

describe("frontend analytics bootstrap helpers", () => {
  test("formats page view event names", () => {
    expect(getFrontendPageViewEventName("/")).toBe("View /");
    expect(getFrontendPageViewEventName("/wallet")).toBe("View /wallet");
  });

  test("tracks the first pathname", () => {
    expect(
      shouldTrackFrontendPageView({
        pathname: "/",
        lastTrackedPath: null,
      })
    ).toBe(true);
  });

  test("does not retrack the same pathname", () => {
    expect(
      shouldTrackFrontendPageView({
        pathname: "/wallet",
        lastTrackedPath: "/wallet",
      })
    ).toBe(false);
  });

  test("tracks a pathname transition without auth or hydration inputs", () => {
    expect(
      shouldTrackFrontendPageView({
        pathname: "/chat",
        lastTrackedPath: "/wallet",
      })
    ).toBe(true);
  });

  test("tracks auth success only for anonymous to authenticated transitions", () => {
    expect(
      shouldTrackAuthSignInSuccess({
        previousUser: null,
        nextUser: {
          authMethod: "wallet",
          subjectAddress: "subject-address",
          displayAddress: "display-address",
          walletAddress: "wallet-address",
        },
      })
    ).toBe(true);
  });

  test("does not retrack auth success once a user already exists", () => {
    expect(
      shouldTrackAuthSignInSuccess({
        previousUser: {
          authMethod: "wallet",
          subjectAddress: "subject-address",
          displayAddress: "display-address",
          walletAddress: "wallet-address",
        },
        nextUser: {
          authMethod: "wallet",
          subjectAddress: "subject-address",
          displayAddress: "display-address",
          walletAddress: "wallet-address",
        },
      })
    ).toBe(false);
  });

  test("builds tracked landing anchor click properties", () => {
    expect(
      getLandingAnchorClickProperties({
        currentOrigin: "https://askloyal.com",
        currentPathname: "/",
        href: "#get-started",
        linkText: "Get started",
      })
    ).toEqual({
      anchor: "#get-started",
      hostname: "askloyal.com",
      link_text: "Get started",
      path: "/",
      source: "anchor_link",
      url: "https://askloyal.com/#get-started",
    });
  });

  test("ignores non-anchor landing links", () => {
    expect(
      getLandingAnchorClickProperties({
        currentOrigin: "https://askloyal.com",
        currentPathname: "/",
        href: "https://docs.askloyal.com",
        linkText: "Docs",
      })
    ).toBeNull();
  });

  test("maps Usercentrics services into landing consent categories", () => {
    expect(
      getServiceConsentCategory({
        categorySlug: "analytics",
        name: "Mixpanel",
      })
    ).toBe("analytics");

    expect(
      getServiceConsentCategory({
        categorySlug: "marketing",
        name: "Ads",
      })
    ).toBe("marketing");
  });

  test("reads analytics consent from Usercentrics services", () => {
    const services: ConsentService[] = [
      {
        categorySlug: "essential",
        consent: { status: true },
        description: "",
        id: "essential-service",
        isEssential: true,
        isHidden: false,
        name: "Essential",
      },
      {
        categorySlug: "analytics",
        consent: { status: true },
        description: "",
        id: "analytics-service",
        isEssential: false,
        isHidden: false,
        name: "Mixpanel",
      },
    ];

    expect(getAnalyticsConsentFromServices(services)).toBe(true);
    expect(getChoicesFromServices(services)).toEqual({
      analytics: true,
      marketing: false,
      personalization: false,
    });
  });

  test("keeps essential services accepted when building Usercentrics decisions", () => {
    const services: ConsentService[] = [
      {
        categorySlug: "essential",
        consent: { status: true },
        description: "",
        id: "essential-service",
        isEssential: true,
        isHidden: false,
        name: "Essential",
      },
      {
        categorySlug: "analytics",
        consent: { status: false },
        description: "",
        id: "analytics-service",
        isEssential: false,
        isHidden: false,
        name: "Mixpanel",
      },
    ];

    expect(
      buildUsercentricsDecisions(services, {
        analytics: false,
        marketing: false,
        personalization: false,
      })
    ).toEqual([
      { serviceId: "essential-service", status: true },
      { serviceId: "analytics-service", status: false },
    ]);
  });
});
