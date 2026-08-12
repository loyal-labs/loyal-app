"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PublicEnv } from "@/lib/core/config/public";

import {
  COOKIE_CONSENT_STORAGE_KEY,
  persistCookieConsent,
  readStoredCookieConsent,
} from "./cookie-consent-state";

const COOKIE_PREFERENCES_EVENT = "loyal:open-cookie-preferences";

export type ConsentCategoryId = "analytics" | "marketing" | "personalization";

export type ConsentChoices = Record<ConsentCategoryId, boolean>;

export type ConsentService = {
  categorySlug: string;
  consent: {
    status: boolean;
  };
  description: string;
  id: string;
  isEssential: boolean;
  isHidden: boolean;
  name: string;
};

type UsercentricsClient = {
  acceptAllServices(): Promise<void>;
  denyAllServices(): Promise<void>;
  getServicesBaseInfo(): ConsentService[];
  init(): Promise<{
    initialLayer: unknown;
    variant: unknown;
  }>;
  updateLayer(layer: unknown): Promise<void>;
  updateServices(
    decisions: { serviceId: string; status: boolean }[]
  ): Promise<void>;
};

type UsercentricsModule = {
  default: new (settingsId: string) => UsercentricsClient;
  UI_LAYER: {
    FIRST_LAYER: unknown;
    NONE: unknown;
    PRIVACY_BUTTON: unknown;
    SECOND_LAYER: unknown;
  };
  UI_VARIANT: {
    DEFAULT: unknown;
  };
};

type LandingCookieConsentProps = {
  onAnalyticsConsentChange: (hasConsent: boolean) => void;
  publicEnv: PublicEnv;
};

type ConsentView = "banner" | "preferences" | null;
type PreferencesSource = "banner" | "settings" | null;

const DEFAULT_CHOICES: ConsentChoices = {
  analytics: false,
  marketing: false,
  personalization: false,
};

const categoryCopy: Record<
  "essential" | ConsentCategoryId,
  { description: string; label: string }
> = {
  essential: {
    label: "Essential",
    description: "These items are necessary for the website to work.",
  },
  analytics: {
    label: "Analytics",
    description:
      "These items help us understand visitor interactions, measure website performance, and spot potential technical issues.",
  },
  marketing: {
    label: "Marketing",
    description:
      "These items help us measure campaign performance and improve how we introduce Loyal to new users.",
  },
  personalization: {
    label: "Personalization",
    description:
      "These items help us remember preferences and tailor website content when available.",
  },
};

const consentCategories: ConsentCategoryId[] = [
  "analytics",
  "marketing",
  "personalization",
];

export function openCookiePreferences() {
  window.dispatchEvent(
    new CustomEvent(COOKIE_PREFERENCES_EVENT, {
      detail: { source: "settings" satisfies PreferencesSource },
    })
  );
}

function getNormalizedText(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, " ");
}

export function getServiceConsentCategory(
  service: Pick<ConsentService, "categorySlug" | "name">
): ConsentCategoryId | null {
  const categorySlug = getNormalizedText(service.categorySlug);
  const serviceName = getNormalizedText(service.name);
  const haystack = `${categorySlug} ${serviceName}`;

  if (
    haystack.includes("analytics") ||
    haystack.includes("statistics") ||
    haystack.includes("mixpanel")
  ) {
    return "analytics";
  }

  if (
    haystack.includes("marketing") ||
    haystack.includes("advertising") ||
    haystack.includes("ads")
  ) {
    return "marketing";
  }

  if (
    haystack.includes("personalization") ||
    haystack.includes("preferences")
  ) {
    return "personalization";
  }

  return null;
}

export function getAnalyticsConsentFromServices(services: ConsentService[]) {
  return services.some(
    (service) =>
      !service.isHidden &&
      service.consent.status &&
      getServiceConsentCategory(service) === "analytics"
  );
}

export function getChoicesFromServices(
  services: ConsentService[]
): ConsentChoices {
  return services.reduce<ConsentChoices>(
    (choices, service) => {
      const category = getServiceConsentCategory(service);
      if (!category) {
        return choices;
      }

      return {
        ...choices,
        [category]: choices[category] || service.consent.status,
      };
    },
    { ...DEFAULT_CHOICES }
  );
}

export function buildUsercentricsDecisions(
  services: ConsentService[],
  choices: ConsentChoices
) {
  return services
    .filter((service) => !service.isHidden)
    .map((service) => {
      const category = getServiceConsentCategory(service);

      return {
        serviceId: service.id,
        status: service.isEssential || (category ? choices[category] : false),
      };
    });
}

function getStoredLocalChoices(): ConsentChoices | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) === null) {
    return null;
  }
  return readStoredCookieConsent();
}

function CookieSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      className={[
        "relative mt-0.5 h-8 w-[52px] shrink-0 rounded-full transition-colors duration-200",
        checked ? "bg-[#F9363C]" : "bg-white/20",
        disabled ? "cursor-default opacity-40" : "cursor-pointer",
      ].join(" ")}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={[
          "absolute left-0 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-white transition-transform duration-200",
          checked ? "translate-x-[24px]" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}

function CookiePreferences({
  choices,
  onAcceptAll,
  onClose,
  onConfirm,
  onRejectAll,
  onToggle,
}: {
  choices: ConsentChoices;
  onAcceptAll: () => void;
  onClose: () => void;
  onConfirm: () => void;
  onRejectAll: () => void;
  onToggle: (category: ConsentCategoryId, value: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/35 px-4 py-4 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[calc(100vh-32px)] w-full max-w-[600px] flex-col overflow-hidden rounded-[20px] bg-black text-white shadow-2xl">
        <div className="flex items-start p-2">
          <div className="flex min-w-0 flex-1 items-center py-3 pl-3">
            <h2 className="min-w-0 flex-1 truncate font-semibold text-2xl leading-7">
              Cookie Preferences
            </h2>
          </div>
          <button
            aria-label="Close cookie preferences"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={24} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <p className="px-3 py-2 text-base leading-5 text-white/60">
            This website uses cookies, pixel tags, and local storage for
            performance and marketing purposes. We use our own cookies and some
            from third parties. You can change or customize your selection at
            any time. To learn more, please see our{" "}
            <a
              className="text-white underline decoration-white/40 underline-offset-4 transition-colors hover:decoration-white"
              href="/privacy-policy"
            >
              Privacy Policy
            </a>
            .
          </p>
          <div className="flex flex-col py-2">
            <div className="flex px-3">
              <div className="self-stretch py-3 pr-5">
                <CookieSwitch checked disabled />
              </div>
              <div className="min-w-0 flex-1 py-2.5">
                <div className="font-semibold text-base leading-5">
                  {categoryCopy.essential.label}
                </div>
                <p className="mt-0.5 text-[13px] leading-4 text-white/60">
                  {categoryCopy.essential.description}
                </p>
              </div>
            </div>
            {consentCategories.map((category) => (
              <div className="flex px-3" key={category}>
                <div className="self-stretch py-3 pr-5">
                  <CookieSwitch
                    checked={choices[category]}
                    onChange={(checked) => onToggle(category, checked)}
                  />
                </div>
                <div className="min-w-0 flex-1 py-2.5">
                  <div className="font-semibold text-base leading-5">
                    {categoryCopy[category].label}
                  </div>
                  <p className="mt-0.5 text-[13px] leading-4 text-white/60">
                    {categoryCopy[category].description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            className="rounded-full bg-white/14 px-4 py-3 text-center text-base leading-5 text-white transition-colors hover:bg-white/20"
            onClick={onRejectAll}
            type="button"
          >
            Reject all
          </button>
          <button
            className="rounded-full bg-white/14 px-4 py-3 text-center text-base leading-5 text-white transition-colors hover:bg-white/20"
            onClick={onAcceptAll}
            type="button"
          >
            Accept all
          </button>
          <button
            className="rounded-full bg-white px-4 py-3 text-center text-base leading-5 text-black transition-colors hover:bg-white/90"
            onClick={onConfirm}
            type="button"
          >
            Confirm my choices
          </button>
        </div>
      </div>
    </div>
  );
}

function CookieBanner({
  onAcceptAll,
  onPreferences,
  onRejectAll,
}: {
  onAcceptAll: () => void;
  onPreferences: () => void;
  onRejectAll: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[110] flex justify-center px-3 pb-3 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:block sm:px-0 sm:pb-0">
      <div className="w-full max-w-[420px] overflow-hidden rounded-[20px] bg-black text-white shadow-2xl">
        <div className="flex flex-col p-2">
          <div className="flex flex-col gap-2 p-3">
            <h2 className="font-semibold text-xl leading-6">
              We value your privacy
            </h2>
            <p className="text-base leading-5 text-white/60">
              This website uses cookies, pixel tags, and local storage for
              performance, personalization, and marketing purposes. We use our
              own cookies and some from third parties.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            className="rounded-full bg-white/14 px-4 py-3 text-center text-base leading-5 transition-colors hover:bg-white/20"
            onClick={onPreferences}
            type="button"
          >
            Preferences
          </button>
          <button
            className="rounded-full bg-white px-4 py-3 text-center text-base leading-5 text-black transition-colors hover:bg-white/90"
            onClick={onRejectAll}
            type="button"
          >
            Reject all
          </button>
          <button
            className="rounded-full bg-white px-4 py-3 text-center text-base leading-5 text-black transition-colors hover:bg-white/90"
            onClick={onAcceptAll}
            type="button"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}

export function LandingCookieConsent({
  onAnalyticsConsentChange,
  publicEnv,
}: LandingCookieConsentProps) {
  const [choices, setChoices] = useState<ConsentChoices>(DEFAULT_CHOICES);
  const [view, setView] = useState<ConsentView>(null);
  const [preferencesSource, setPreferencesSource] =
    useState<PreferencesSource>(null);
  const [sdkModule, setSdkModule] = useState<UsercentricsModule | null>(null);
  const usercentricsRef = useRef<UsercentricsClient | null>(null);
  const servicesRef = useRef<ConsentService[]>([]);

  const applyChoices = useCallback(
    (nextChoices: ConsentChoices) => {
      setChoices(nextChoices);
      onAnalyticsConsentChange(nextChoices.analytics);
    },
    [onAnalyticsConsentChange]
  );

  const syncChoicesFromServices = useCallback((): ConsentChoices => {
    const services = usercentricsRef.current?.getServicesBaseInfo() ?? [];
    servicesRef.current = services;
    const nextChoices = getChoicesFromServices(services);
    setChoices(nextChoices);
    onAnalyticsConsentChange(getAnalyticsConsentFromServices(services));
    return nextChoices;
  }, [onAnalyticsConsentChange]);

  useEffect(() => {
    const openPreferences = (event: Event) => {
      const source =
        event instanceof CustomEvent ? event.detail?.source : "settings";
      setPreferencesSource(source === "banner" ? "banner" : "settings");
      setView("preferences");
    };
    window.addEventListener(COOKIE_PREFERENCES_EVENT, openPreferences);

    return () => {
      window.removeEventListener(COOKIE_PREFERENCES_EVENT, openPreferences);
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    if (!publicEnv.usercentricsSettingsId) {
      const storedChoices = getStoredLocalChoices();
      if (storedChoices) {
        applyChoices(storedChoices);
        return;
      }

      setView("banner");
      onAnalyticsConsentChange(false);
      return;
    }

    const initializeUsercentrics = async () => {
      try {
        const importedModule = (await import(
          "@usercentrics/cmp-browser-sdk"
        )) as UsercentricsModule;

        if (!isActive) {
          return;
        }

        const usercentrics = new importedModule.default(
          publicEnv.usercentricsSettingsId!
        );
        const initialValues = await usercentrics.init();

        if (!isActive) {
          return;
        }

        usercentricsRef.current = usercentrics;
        setSdkModule(importedModule);
        const initialChoices = syncChoicesFromServices();
        persistCookieConsent(initialChoices);

        if (
          initialValues.variant === importedModule.UI_VARIANT.DEFAULT &&
          initialValues.initialLayer === importedModule.UI_LAYER.FIRST_LAYER
        ) {
          setView("banner");
        }
      } catch {
        const storedChoices = getStoredLocalChoices();
        if (storedChoices) {
          applyChoices(storedChoices);
        } else {
          setView("banner");
          onAnalyticsConsentChange(false);
        }
      }
    };

    void initializeUsercentrics();

    return () => {
      isActive = false;
    };
  }, [
    applyChoices,
    onAnalyticsConsentChange,
    publicEnv.usercentricsSettingsId,
    syncChoicesFromServices,
  ]);

  const confirmChoices = useCallback(
    async (nextChoices: ConsentChoices) => {
      let persistedChoices = nextChoices;
      if (usercentricsRef.current) {
        await usercentricsRef.current.updateServices(
          buildUsercentricsDecisions(servicesRef.current, nextChoices)
        );
        persistedChoices = syncChoicesFromServices();
      } else {
        applyChoices(nextChoices);
      }
      persistCookieConsent(persistedChoices);

      setPreferencesSource(null);
      setView(null);
    },
    [applyChoices, syncChoicesFromServices]
  );

  const acceptAll = useCallback(async () => {
    const allAccepted: ConsentChoices = {
      analytics: true,
      marketing: true,
      personalization: true,
    };

    let persistedChoices = allAccepted;
    if (usercentricsRef.current) {
      await usercentricsRef.current.acceptAllServices();
      persistedChoices = syncChoicesFromServices();
    } else {
      applyChoices(allAccepted);
    }
    persistCookieConsent(persistedChoices);

    setPreferencesSource(null);
    setView(null);
  }, [applyChoices, syncChoicesFromServices]);

  const rejectAll = useCallback(async () => {
    let persistedChoices: ConsentChoices = DEFAULT_CHOICES;
    if (usercentricsRef.current) {
      await usercentricsRef.current.denyAllServices();
      persistedChoices = syncChoicesFromServices();
    } else {
      applyChoices(DEFAULT_CHOICES);
    }
    persistCookieConsent(persistedChoices);

    setPreferencesSource(null);
    setView(null);
  }, [applyChoices, syncChoicesFromServices]);

  const openPreferencesPanel = useCallback(async () => {
    setPreferencesSource("banner");
    setView("preferences");
    if (usercentricsRef.current && sdkModule) {
      await usercentricsRef.current.updateLayer(sdkModule.UI_LAYER.SECOND_LAYER);
    }
  }, [sdkModule]);

  const closePreferencesPanel = useCallback(async () => {
    setView(preferencesSource === "banner" ? "banner" : null);
    setPreferencesSource(null);
    if (usercentricsRef.current && sdkModule) {
      await usercentricsRef.current.updateLayer(
        preferencesSource === "banner"
          ? sdkModule.UI_LAYER.FIRST_LAYER
          : sdkModule.UI_LAYER.NONE
      );
    }
  }, [preferencesSource, sdkModule]);

  if (!view) {
    return null;
  }

  return (
    <>
      {view === "banner" ? (
        <CookieBanner
          onAcceptAll={acceptAll}
          onPreferences={openPreferencesPanel}
          onRejectAll={rejectAll}
        />
      ) : null}
      {view === "preferences" ? (
        <CookiePreferences
          choices={choices}
          onAcceptAll={acceptAll}
          onClose={closePreferencesPanel}
          onConfirm={() => {
            void confirmChoices(choices);
          }}
          onRejectAll={rejectAll}
          onToggle={(category, value) => {
            setChoices((currentChoices) => ({
              ...currentChoices,
              [category]: value,
            }));
          }}
        />
      ) : null}
    </>
  );
}
