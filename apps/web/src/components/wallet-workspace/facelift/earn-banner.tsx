"use client";

import { useEffect, useState, type ReactNode } from "react";

import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { BannerTitleChars } from "@/components/wallet-workspace/facelift/wallet-home-banners";
import { LOYAL_TOKEN_MINT } from "@/lib/market/loyal-token-ticker.shared";

const ASSET_BASE = "/wallet-workspace/facelift";
// Banner art remounts on every carousel rotation, so it is served immutable
// (see the cache rule in next.config.ts). The commit hash is what invalidates
// it: a deploy changes the URL, so a rotation never re-hits the network but a
// release never serves stale artwork.
const ASSET_VERSION = process.env.NEXT_PUBLIC_GIT_COMMIT_HASH ?? "dev";

function bannerAsset(file: string): string {
  return `${ASSET_BASE}/${file}?v=${ASSET_VERSION}`;
}

// Same autoplay clock as the mobile home carousel; the story pill fill reads
// it too, so the bar always lands exactly when the banner rolls.
const ROLL_INTERVAL_MS = 4000;

// A collapse is remembered as the generation it happened in. Bump the
// generation and deploy to force-expand the banners for every user (new
// campaign, changed banner set); collapsing again stores the new value.
const COLLAPSE_GENERATION = "1";
const COLLAPSE_STORAGE_KEY = "loyal:earn-banner-collapsed";

const BUTTON_COLOR_CLASSES = {
  black: "bg-black text-white hover:bg-[#171717]",
  red: "bg-[#f9363c] text-white hover:bg-[#e42f35]",
  white: "bg-white text-black hover:bg-[#f0f0f0]",
} as const;

// Verbatim gradient stops from Figma (4965:66256 / 4970:72785): the texture
// fades into the banner's solid brand color toward the CTA.
const FADE_RED =
  "linear-gradient(180deg, rgba(249, 54, 60, 0) 0%, rgba(249, 54, 60, 0.008) 11.79%, rgba(249, 54, 60, 0.032) 21.384%, rgba(249, 54, 60, 0.07) 29.12%, rgba(249, 54, 60, 0.121) 35.336%, rgba(249, 54, 60, 0.181) 40.37%, rgba(249, 54, 60, 0.251) 44.56%, rgba(249, 54, 60, 0.328) 48.243%, rgba(249, 54, 60, 0.411) 51.757%, rgba(249, 54, 60, 0.497) 55.44%, rgba(249, 54, 60, 0.585) 59.63%, rgba(249, 54, 60, 0.674) 64.664%, rgba(249, 54, 60, 0.762) 70.88%, rgba(249, 54, 60, 0.846) 78.616%, rgba(249, 54, 60, 0.926) 88.21%, rgb(249, 54, 60) 100%)";
const FADE_MAROON =
  "linear-gradient(180deg, rgba(95, 0, 25, 0) 0%, rgba(95, 0, 25, 0.008) 11.79%, rgba(95, 0, 25, 0.032) 21.384%, rgba(95, 0, 25, 0.07) 29.12%, rgba(95, 0, 25, 0.121) 35.336%, rgba(95, 0, 25, 0.181) 40.37%, rgba(95, 0, 25, 0.251) 44.56%, rgba(95, 0, 25, 0.328) 48.243%, rgba(95, 0, 25, 0.411) 51.757%, rgba(95, 0, 25, 0.497) 55.44%, rgba(95, 0, 25, 0.585) 59.63%, rgba(95, 0, 25, 0.674) 64.664%, rgba(95, 0, 25, 0.762) 70.88%, rgba(95, 0, 25, 0.846) 78.616%, rgba(95, 0, 25, 0.926) 88.21%, rgb(95, 0, 25) 100%)";

// Dog + partner logo pair shared by the X and Telegram banners (rotation is
// baked into the exported art, so placement is plain absolute coords).
function TiltedIconPair({ rightArt }: { rightArt: string }) {
  return (
    <>
      <div className="-translate-x-1/2 -translate-y-1/2 absolute left-[calc(50%-62.96px)] top-[calc(50%+45.04px)] size-[169.82px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          className="size-full"
          src={bannerAsset("earn-banner-art-dog.svg")}
        />
      </div>
      <div className="absolute left-[179.23px] top-[241.23px] size-[169.82px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" aria-hidden="true" className="size-full" src={rightArt} />
      </div>
    </>
  );
}

type EarnBannerConfig = {
  accent: string;
  art: ReactNode;
  buttonColor: keyof typeof BUTTON_COLOR_CLASSES;
  buttonLabel: string;
  fade: string;
  // null → the button runs onSetUpAutodeposit instead of opening a link.
  href: string | null;
  icon: string;
  key: string;
  texture: ReactNode;
  title: string;
  titleClassName: string;
};

function CollapsedPillBody({ banner }: { banner: EarnBannerConfig }) {
  return (
    <>
      <div className="pr-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          className="size-11"
          key={banner.key}
          src={banner.icon}
        />
      </div>
      <TextSwap
        className="min-w-0 flex-1 font-medium text-[16px] text-white leading-5 tracking-[-0.176px]"
        text={banner.title}
      />
    </>
  );
}

function Texture({ src }: { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full object-cover"
      src={src}
    />
  );
}

// Figma 4965:66254 (X) / 4970:72783 (Jupiter) / 4965:65660 (Telegram) /
// 4973:74493 (Autodeposit) with collapsed twins 5079:139154 / 5079:139191 /
// 5095:49186 / 5095:49875.
const BANNERS: EarnBannerConfig[] = [
  {
    accent: "#f9363c",
    art: <TiltedIconPair rightArt={bannerAsset("earn-banner-art-x.svg")} />,
    buttonColor: "black",
    buttonLabel: "Follow",
    fade: FADE_RED,
    href: "https://x.com/loyal_hq",
    icon: bannerAsset("earn-banner-icon-x.svg"),
    key: "x",
    texture: <Texture src={bannerAsset("earn-banner-tex-red.png")} />,
    title: "Follow Loyal on X",
    titleClassName: "w-[244px] text-white",
  },
  {
    accent: "#5f0019",
    // The mascot's chin (bottom ~463 of 500) tucks behind the white CTA
    // (Figma 5079:139084) — the art is drawn before the button on purpose.
    art: (
      <div className="absolute inset-[48%_15.13%_7.36%_15.13%]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          className="size-full"
          src={bannerAsset("earn-banner-art-mascot.svg")}
        />
      </div>
    ),
    buttonColor: "white",
    buttonLabel: "Go to Jupiter",
    fade: FADE_MAROON,
    href: `https://jup.ag/tokens/${LOYAL_TOKEN_MINT}`,
    icon: bannerAsset("earn-banner-icon-jupiter.svg"),
    key: "jupiter",
    texture: <Texture src={bannerAsset("earn-banner-tex-dark.png")} />,
    title: "Buy $LOYAL on Jupiter",
    titleClassName: "w-[270px] text-white",
  },
  {
    accent: "#f9363c",
    art: (
      <TiltedIconPair rightArt={bannerAsset("earn-banner-art-telegram.svg")} />
    ),
    buttonColor: "black",
    buttonLabel: "Join",
    fade: FADE_RED,
    href: "https://t.me/loyal_tgchat",
    icon: bannerAsset("earn-banner-icon-telegram.svg"),
    key: "telegram",
    // The zigzag is a single oversized vector (Figma 4965:65661), placed with
    // its design offsets rather than covered like the raster textures.
    texture: (
      <div className="absolute left-[-106px] top-[-64px] h-[497.33px] w-[590px]">
        <div className="absolute inset-[-2.5%_-3.07%_-3.54%_-2.24%]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="block size-full max-w-none"
            src={bannerAsset("earn-banner-tex-zigzag.svg")}
          />
        </div>
      </div>
    ),
    title: "Join Telegram Community",
    titleClassName: "w-[316px] text-white",
  },
  {
    accent: "#5f0019",
    art: (
      <div className="absolute left-[127.79px] top-[209.21px] h-[255px] w-[144px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          className="size-full"
          src={bannerAsset("earn-banner-art-coins.svg")}
        />
      </div>
    ),
    buttonColor: "red",
    buttonLabel: "Set up Autodeposit",
    fade: FADE_MAROON,
    href: null,
    icon: bannerAsset("earn-banner-icon-autodeposit.svg"),
    key: "autodeposit",
    texture: <Texture src={bannerAsset("earn-banner-tex-dark.png")} />,
    title: "Earn more without manual deposits",
    titleClassName: "w-[352px] text-[#f9363c]",
  },
];

// Figma 4965:65685 (expanded in context) / 5095:49265 (collapsed in context):
// the desktop Earn promo banner pinned over the bottom of the right pane. The
// four fixed banners auto-roll on the mobile carousel's clock — also while
// collapsed — and each roll replays the mobile entrance (soft-blur-in title
// chars, then art + button on the texts-reveal stagger). The minimize button
// folds the card into the 60px pill instead of dismissing it; the fold is
// remembered in localStorage per COLLAPSE_GENERATION.
export function EarnBanners({
  onSetUpAutodeposit,
}: {
  onSetUpAutodeposit: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Restore the persisted fold after hydration (SSR can't read storage);
  // the morph/crossfade transitions only arm on the next frame so a
  // remembered collapse renders folded instead of animating shut on load.
  const [hasRestoredCollapse, setHasRestoredCollapse] = useState(false);
  useEffect(() => {
    setIsCollapsed(
      localStorage.getItem(COLLAPSE_STORAGE_KEY) === COLLAPSE_GENERATION
    );
    const frame = requestAnimationFrame(() => setHasRestoredCollapse(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const setCollapsed = (next: boolean) => {
    setIsCollapsed(next);
    if (next) {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, COLLAPSE_GENERATION);
    } else {
      localStorage.removeItem(COLLAPSE_STORAGE_KEY);
    }
  };

  // is-shown lands a frame after each roll remounts the slide, so the
  // entrance transitions instead of rendering pre-revealed (mobile pattern).
  const [shownIndex, setShownIndex] = useState(-1);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => setShownIndex(activeIndex))
    );
    return () => cancelAnimationFrame(frame);
  }, [activeIndex]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = setInterval(
      () => setActiveIndex((index) => (index + 1) % BANNERS.length),
      ROLL_INTERVAL_MS
    );
    return () => clearInterval(timer);
  }, []);

  const banner = BANNERS[activeIndex];
  const cta = (
    <div className="absolute inset-x-0 bottom-0 px-4 pt-2 pb-4">
      <div
        className="t-stagger-line"
        style={{ transitionDelay: "calc(var(--stagger-stagger) * 3)" }}
      >
        {banner.href !== null ? (
          <a
            className={`t-hover flex h-12 w-full items-center justify-center rounded-full font-medium text-[16px] leading-5 ${
              BUTTON_COLOR_CLASSES[banner.buttonColor]
            }`}
            href={banner.href}
            rel="noreferrer"
            target="_blank"
          >
            {banner.buttonLabel}
          </a>
        ) : (
          <button
            className={`t-hover flex h-12 w-full items-center justify-center rounded-full font-medium text-[16px] leading-5 ${
              BUTTON_COLOR_CLASSES[banner.buttonColor]
            }`}
            onClick={onSetUpAutodeposit}
            type="button"
          >
            {banner.buttonLabel}
          </button>
        )}
      </div>
    </div>
  );

  const faceFade = hasRestoredCollapse ? "transition-opacity duration-200" : "";
  return (
    <section
      className={`sticky bottom-0 z-10 mt-auto w-full shrink-0 overflow-clip ${
        hasRestoredCollapse ? "t-earn-banner" : ""
      }`}
      style={{
        backgroundColor: banner.accent,
        borderRadius: isCollapsed ? 30 : 24,
        height: isCollapsed ? 60 : 500,
      }}
    >
      {/* Expanded face — bottom-anchored so the pill morph clips the top. */}
      <div
        className={`absolute inset-x-0 bottom-0 h-[500px] ${faceFade} ${
          isCollapsed ? "pointer-events-none opacity-0" : ""
        }`}
        inert={isCollapsed}
      >
        <div
          className={`t-stagger t-home-banner absolute inset-0 ${
            shownIndex === activeIndex ? "is-shown" : ""
          }`}
          key={banner.key}
        >
          {banner.texture}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: banner.fade }}
          />
          <div
            className="t-stagger-line absolute inset-0"
            style={{ transitionDelay: "calc(var(--stagger-stagger) * 2)" }}
          >
            {banner.art}
          </div>
          <div className="absolute inset-x-0 top-0 flex justify-center px-6 pt-[90px]">
            <h2
              className={`text-center font-bold text-[36px] uppercase leading-none ${banner.titleClassName}`}
              // 24px+ display copy takes the recipe's large-text blur/stagger
              // (the root vars are tuned for the mobile banner's 20px title).
              style={{
                ["--banner-char-blur" as never]: "12px",
                ["--banner-char-stagger" as never]: "25ms",
              }}
            >
              <BannerTitleChars title={banner.title} />
            </h2>
          </div>
          {cta}
        </div>
        <div className="absolute inset-x-0 top-0 flex items-center p-2">
          <div className="flex h-11 min-w-0 flex-1 items-center gap-2 px-4">
            {BANNERS.map((pill, index) => (
              <span
                className="h-2 min-w-0 flex-1 overflow-clip rounded-[4px] bg-white/25 backdrop-blur-[4px]"
                key={pill.key}
              >
                {index < activeIndex ? (
                  <span className="block h-full w-full rounded-[4px] bg-white" />
                ) : index === activeIndex ? (
                  <span
                    className="t-banner-progress block h-full rounded-[4px] bg-white"
                    style={{ animationDuration: `${ROLL_INTERVAL_MS}ms` }}
                  />
                ) : null}
              </span>
            ))}
          </div>
          <button
            aria-label="Collapse banner"
            className="t-hover ml-3 flex size-11 shrink-0 items-center justify-center rounded-3xl bg-white/25 backdrop-blur-[4px] hover:bg-white/[0.32]"
            onClick={() => setCollapsed(true)}
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              className="size-6"
              src={`${ASSET_BASE}/icon-minimize-white.svg`}
            />
          </button>
        </div>
      </div>

      {/* Collapsed pill (Figma 5079:139154 et al.) — keeps rolling. */}
      <div
        className={`absolute inset-x-0 bottom-0 flex h-[60px] items-center p-2 ${faceFade} ${
          isCollapsed ? "" : "pointer-events-none opacity-0"
        }`}
        inert={!isCollapsed}
      >
        {/* The pill body is the banner's action; only the expand control
            opts out. Interactive elements can't nest, so it sits beside
            the expand button rather than around it. */}
        {banner.href !== null ? (
          <a
            className="flex min-w-0 flex-1 items-center self-stretch"
            href={banner.href}
            rel="noreferrer"
            target="_blank"
          >
            <CollapsedPillBody banner={banner} />
          </a>
        ) : (
          <button
            className="flex min-w-0 flex-1 items-center self-stretch text-left"
            onClick={onSetUpAutodeposit}
            type="button"
          >
            <CollapsedPillBody banner={banner} />
          </button>
        )}
        <button
          aria-label="Expand banner"
          className="t-hover ml-3 flex size-11 shrink-0 items-center justify-center rounded-3xl bg-white/25 backdrop-blur-[4px] hover:bg-white/[0.32]"
          onClick={() => setCollapsed(false)}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={`${ASSET_BASE}/icon-expand-white.svg`}
          />
        </button>
      </div>
    </section>
  );
}
