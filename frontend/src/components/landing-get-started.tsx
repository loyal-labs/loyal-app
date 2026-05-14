"use client";

import Image from "next/image";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";

type Segment = "Extension" | "Mobile" | "Web";

const appUrl = "https://app.askloyal.com";
const chromeWebStoreUrl =
  "https://chromewebstore.google.com/detail/loyal-%E2%80%94-private-solana-wa/cdienfadefhlaknmedckgifkjdbioack?authuser=1&hl=en";
const telegramMiniAppUrl =
  "https://t.me/askloyal_tgbot/app?startapp=askloyalcom";
const seekerDappStoreUrl = "solanadappstore://details?id=com.loyal.app";

const browserCards = [
  {
    href: chromeWebStoreUrl,
    icon: "/landing/figma/get-started-chrome.svg",
    label: "Chrome",
    shape: "rounded-[24px]",
  },
  {
    href: chromeWebStoreUrl,
    icon: "/landing/figma/get-started-brave.svg",
    label: "Brave",
    shape: "rounded-[400px]",
  },
  {
    href: chromeWebStoreUrl,
    icon: "/landing/figma/get-started-edge.svg",
    label: "Edge",
    shape: "rounded-[400px]",
  },
  {
    disabled: true,
    icon: "/landing/figma/get-started-firefox.svg",
    label: "Firefox",
    note: "Coming soon",
    shape: "rounded-[24px]",
  },
];

const mobileCards = [
  {
    icon: "/landing/figma/get-started-seeker.svg",
    label: "Seeker",
    shape: "rounded-[400px]",
  },
  {
    href: telegramMiniAppUrl,
    icon: "/landing/figma/get-started-telegram-mini-app.svg",
    label: "Telegram Mini App",
    shape: "rounded-[400px]",
  },
  {
    disabled: true,
    icon: "/landing/figma/get-started-android.svg",
    label: "Android",
    note: "Coming soon",
    shape: "rounded-[24px]",
  },
];

const segments: Segment[] = ["Extension", "Mobile", "Web"];
const segmentByHash: Record<string, Segment> = {
  "#get-started-extension": "Extension",
  "#get-started-mobile": "Mobile",
  "#get-started-web": "Web",
};

const previewBySegment: Record<Segment, { alt: string; src: string }> = {
  Extension: {
    alt: "Loyal browser extension wallet preview",
    src: "/landing/figma/get-started-extension-wallet.png",
  },
  Mobile: {
    alt: "Loyal mobile app wallet preview",
    src: "/landing/figma/get-started-mobile-wallet.png",
  },
  Web: {
    alt: "Loyal web app wallet preview",
    src: "/landing/figma/get-started-web-wallet.png",
  },
};

export function LandingGetStarted() {
  const [activeSegment, setActiveSegment] = useState<Segment>("Extension");
  const [showSeekerQr, setShowSeekerQr] = useState(false);
  const activePreview = previewBySegment[activeSegment];

  useEffect(() => {
    const syncTabFromHash = () => {
      const nextSegment = segmentByHash[window.location.hash];
      if (nextSegment) {
        setActiveSegment(nextSegment);
      }
    };

    const handleTabAnchorClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest<HTMLAnchorElement>(
        'a[href^="#get-started-"]'
      );
      const nextSegment = anchor
        ? segmentByHash[anchor.getAttribute("href") ?? ""]
        : undefined;

      if (nextSegment) {
        setActiveSegment(nextSegment);
      }
    };

    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    document.addEventListener("click", handleTabAnchorClick);

    return () => {
      window.removeEventListener("hashchange", syncTabFromHash);
      document.removeEventListener("click", handleTabAnchorClick);
    };
  }, []);

  useEffect(() => {
    if (activeSegment !== "Mobile") {
      setShowSeekerQr(false);
    }
  }, [activeSegment]);

  return (
    <section
      className="relative flex w-full justify-center bg-white px-4 pb-6 pt-12 lg:px-6 lg:py-24"
      id="get-started"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-px w-px scroll-mt-24"
        id="get-started-extension"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-px w-px scroll-mt-24"
        id="get-started-mobile"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-px w-px scroll-mt-24"
        id="get-started-web"
      />
      <div className="flex w-full max-w-[560px] flex-col items-start lg:max-w-[1560px]">
        <div
          className="mx-auto flex w-full max-w-[530px] flex-col items-start justify-center pb-8 lg:max-w-none lg:pb-12"
          data-reveal="left"
        >
          <div className="flex w-full flex-col items-start justify-center gap-6">
            <h2 className="whitespace-nowrap text-[48px] font-semibold leading-none tracking-[-0.02em] text-black">
              Get started{" "}
            </h2>

            <div
              aria-label="Get started platform"
              className="flex h-11 w-full items-center justify-center rounded-[60px] bg-[#f5f5f5] p-1 lg:w-auto"
              role="tablist"
            >
              {segments.map((segment) => {
                const isActive = activeSegment === segment;

                return (
                  <button
                    aria-controls={`get-started-${segment.toLowerCase()}-panel`}
                    aria-selected={isActive}
                    className={`flex h-9 flex-1 items-center justify-center rounded-full px-4 py-2 text-center text-[16px] font-normal leading-5 transition duration-150 ease-out lg:flex-none ${
                      isActive
                        ? "bg-black text-white"
                        : "text-[#3c3c43]/60 hover:bg-white hover:text-black"
                    }`}
                    key={segment}
                    onClick={() => setActiveSegment(segment)}
                    role="tab"
                    type="button"
                  >
                    {segment}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          className="mx-auto grid w-full max-w-[530px] gap-4 lg:max-w-none lg:grid-cols-2 lg:gap-12"
          id={`get-started-${activeSegment.toLowerCase()}-panel`}
          role="tabpanel"
        >
          {activeSegment === "Mobile" ? (
            <div className="grid aspect-square min-w-0 grid-rows-2 gap-2 overflow-hidden lg:aspect-auto lg:h-[600px] lg:gap-6">
              <SeekerCard
                className="h-full"
                dataRevealDelay={1}
                iconClassName="h-16 w-16 lg:h-24 lg:w-24"
                isQrVisible={showSeekerQr}
                onShowQr={() => setShowSeekerQr(true)}
                preserveAspect={false}
              />
              <div className="grid min-h-0 grid-cols-2 gap-2 lg:gap-6">
                {mobileCards.slice(1).map((platform, index) => (
                  <PlatformCard
                    className="h-full"
                    dataRevealDelay={index + 2}
                    iconClassName="h-16 w-16 lg:h-24 lg:w-24"
                    key={platform.label}
                    platform={platform}
                    preserveAspect={false}
                  />
                ))}
              </div>
            </div>
          ) : activeSegment === "Web" ? (
            <ActionCard dataRevealDelay={1} href={appUrl} label="Open web app" />
          ) : (
            <div className="grid min-w-0 grid-cols-2 gap-2 overflow-hidden lg:h-[600px] lg:grid-rows-2 lg:gap-6">
              {browserCards.map((browser, index) => (
                <PlatformCard
                  iconClassName="h-16 w-16 lg:h-24 lg:w-24"
                  key={browser.label}
                  platform={browser}
                  dataRevealDelay={index + 1}
                />
              ))}
            </div>
          )}

          <GetStartedPreview preview={activePreview} />
        </div>
      </div>
    </section>
  );
}

function GetStartedPreview({
  preview,
}: {
  preview: { alt: string; src: string };
}) {
  const [currentPreview, setCurrentPreview] = useState(preview);
  const [previousPreview, setPreviousPreview] = useState<typeof preview | null>(
    null
  );
  const currentPreviewRef = useRef(preview);

  useEffect(() => {
    if (preview.src === currentPreviewRef.current.src) {
      return;
    }

    setPreviousPreview(currentPreviewRef.current);
    currentPreviewRef.current = preview;
    setCurrentPreview(preview);

    const timer = window.setTimeout(() => setPreviousPreview(null), 520);

    return () => window.clearTimeout(timer);
  }, [preview]);

  return (
    <div
      className="relative aspect-square min-w-0 overflow-hidden rounded-[24px] bg-[#f9363c] lg:aspect-auto lg:h-[600px]"
      data-reveal="right"
      data-reveal-delay="2"
    >
      {previousPreview ? (
        <Image
          alt=""
          aria-hidden="true"
          className="get-started-preview-image-exit object-cover"
          fill
          key={`previous-${previousPreview.src}`}
          sizes="(min-width: 1560px) 732px, (min-width: 1024px) calc((100vw - 96px) / 2), calc(100vw - 48px)"
          src={previousPreview.src}
        />
      ) : null}
      <Image
        alt={currentPreview.alt}
        className={
          previousPreview
            ? "get-started-preview-image-enter object-cover"
            : "object-cover"
        }
        fill
        key={`current-${currentPreview.src}`}
        sizes="(min-width: 1560px) 732px, (min-width: 1024px) calc((100vw - 96px) / 2), calc(100vw - 48px)"
        src={currentPreview.src}
      />
    </div>
  );
}

function ActionCard({
  dataRevealDelay,
  href,
  label,
}: {
  dataRevealDelay: number;
  href: string;
  label: string;
}) {
  return (
    <Link
      className="group relative flex aspect-square min-h-0 items-center justify-center overflow-hidden bg-transparent transition duration-200 ease-out hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black active:translate-y-0 lg:aspect-auto lg:h-[600px]"
      data-reveal="scale"
      data-reveal-delay={dataRevealDelay}
      href={href}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-[400px] bg-[#f5f5f5] transition-all duration-300 ease-out group-hover:scale-90 group-hover:rounded-none group-hover:bg-[#eeeeee] group-hover:[clip-path:polygon(50%_0%,61%_35%,98%_35%,68%_57%,79%_91%,50%_70%,21%_91%,32%_57%,2%_35%,39%_35%)]"
      />
      <span className="relative z-10 text-[32px] font-normal leading-8 text-[#f9363c]">
        {label}
      </span>
    </Link>
  );
}

function SeekerCard({
  className = "",
  dataRevealDelay,
  iconClassName,
  isQrVisible,
  onShowQr,
  preserveAspect = true,
}: {
  className?: string;
  dataRevealDelay: number;
  iconClassName: string;
  isQrVisible: boolean;
  onShowQr: () => void;
  preserveAspect?: boolean;
}) {
  const classNames = `group relative flex min-h-0 items-center justify-center overflow-hidden bg-transparent transition duration-200 ease-out hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black active:translate-y-0 ${preserveAspect ? "aspect-square lg:aspect-auto" : ""} ${className}`;

  return (
    <button
      aria-label={
        isQrVisible
          ? "Seeker dApp Store QR code"
          : "Show Seeker dApp Store QR code"
      }
      className={classNames}
      data-reveal="scale"
      data-reveal-delay={dataRevealDelay}
      onClick={onShowQr}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-[400px] bg-[#f5f5f5] transition-all duration-300 ease-out ${
          isQrVisible
            ? ""
            : "group-hover:scale-90 group-hover:rounded-none group-hover:bg-[#eeeeee] group-hover:[clip-path:polygon(50%_0%,61%_35%,98%_35%,68%_57%,79%_91%,50%_70%,21%_91%,32%_57%,2%_35%,39%_35%)]"
        } ${
          preserveAspect || isQrVisible
            ? ""
            : "left-1/2 right-auto h-full w-full -translate-x-1/2 group-hover:aspect-square group-hover:w-auto"
        }`}
      />
      <span className="relative z-10 flex w-full flex-col items-center justify-center gap-3 px-4 py-4">
        {isQrVisible ? (
          <>
            <span className="flex rounded-[24px] bg-white p-3 shadow-[0_12px_32px_rgba(0,0,0,0.06)] lg:p-4">
              <QRCodeSVG
                className="h-28 w-28 lg:h-36 lg:w-36"
                level="M"
                marginSize={1}
                title="Loyal Seeker dApp Store listing QR code"
                value={seekerDappStoreUrl}
              />
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-center text-[13px] font-normal leading-5 text-[#3c3c43]/60">
              Only available on Seeker
            </span>
          </>
        ) : (
          <>
            <Image
              alt=""
              aria-hidden="true"
              className={iconClassName}
              height={96}
              src="/landing/figma/get-started-seeker.svg"
              width={96}
            />
            <span className="flex items-center justify-center whitespace-nowrap rounded-[100px] bg-white px-3 py-1 text-[14px] font-normal leading-5 text-[#f9363c] transition duration-200 ease-out group-hover:scale-105">
              Seeker
            </span>
          </>
        )}
      </span>
    </button>
  );
}

function PlatformCard({
  className = "",
  dataRevealDelay,
  iconClassName,
  platform,
  preserveAspect = true,
}: {
  className?: string;
  dataRevealDelay: number;
  iconClassName: string;
  platform: {
    disabled?: boolean;
    href?: string;
    icon: string;
    label: string;
    note?: string;
    shape: string;
  };
  preserveAspect?: boolean;
}) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className={`absolute inset-0 bg-[#f5f5f5] transition-all duration-300 ease-out ${
          platform.disabled
            ? ""
            : "group-hover:scale-90 group-hover:rounded-none group-hover:bg-[#eeeeee] group-hover:[clip-path:polygon(50%_0%,61%_35%,98%_35%,68%_57%,79%_91%,50%_70%,21%_91%,32%_57%,2%_35%,39%_35%)]"
        } ${
          preserveAspect || platform.disabled
            ? ""
            : "left-1/2 right-auto h-full w-full -translate-x-1/2 group-hover:aspect-square group-hover:w-auto"
        } ${platform.shape}`}
      />
      <span className="relative z-10 flex w-24 flex-col items-center gap-4 pt-4">
        <Image
          alt=""
          aria-hidden="true"
          className={`${iconClassName} ${platform.disabled ? "grayscale" : ""}`}
          height={96}
          src={platform.icon}
          width={96}
        />
        <span className="flex flex-col items-center gap-1">
          <span className="flex items-center justify-center whitespace-nowrap rounded-[100px] bg-white px-3 py-1 text-[14px] font-normal leading-5 text-[#f9363c] transition duration-200 ease-out group-hover:scale-105">
            {platform.label}
          </span>
          {platform.note ? (
            <span className="whitespace-nowrap text-[11px] font-normal leading-3 text-[#3c3c43]/45">
              {platform.note}
            </span>
          ) : null}
        </span>
      </span>
    </>
  );
  const classNames = `group relative flex min-h-0 items-center justify-center overflow-hidden bg-transparent transition duration-200 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${platform.disabled ? "cursor-default" : "hover:-translate-y-1 active:translate-y-0"} ${preserveAspect ? "aspect-square lg:aspect-auto" : ""} ${className}`;

  if (platform.disabled) {
    return (
      <div
        aria-disabled="true"
        className={classNames}
        data-reveal="scale"
        data-reveal-delay={dataRevealDelay}
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      className={classNames}
      data-reveal="scale"
      data-reveal-delay={dataRevealDelay}
      href={platform.href ?? appUrl}
    >
      {content}
    </Link>
  );
}
