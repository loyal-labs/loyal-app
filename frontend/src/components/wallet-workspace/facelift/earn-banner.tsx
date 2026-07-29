"use client";

const ASSET_BASE = "/wallet-workspace/facelift";

export type EarnBannerButtonColor = "black" | "red" | "white";

const BUTTON_COLOR_CLASSES: Record<EarnBannerButtonColor, string> = {
  black: "bg-black text-white hover:bg-[#171717]",
  red: "bg-[#f9363c] text-white hover:bg-[#e42f35]",
  white: "bg-white text-black hover:bg-[#f0f0f0]",
};

// Figma 4906:43141 (title L) / 4906:43887 (title M) / 4906:44421 (no title)
// with button colors 4906:51193 (white) / 4906:51205 (red) / 4906:51183
// (black): square promo card for the Earn-root right pane — full-bleed
// image, optional overlaid title, dismiss button, and a bottom action pill.
export function EarnBanner({
  buttonColor = "white",
  buttonLabel,
  imageAlt = "",
  imageSrc,
  onAction,
  onDismiss,
  title,
  titleSize = "l",
}: {
  buttonColor?: EarnBannerButtonColor;
  buttonLabel: string;
  imageAlt?: string;
  imageSrc: string;
  onAction: () => void;
  onDismiss?: () => void;
  title?: string;
  titleSize?: "l" | "m";
}) {
  return (
    <section className="relative aspect-square w-full shrink-0 overflow-clip rounded-3xl bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={imageAlt}
        className="pointer-events-none absolute inset-0 size-full rounded-3xl object-cover"
        src={imageSrc}
      />
      <div className="absolute inset-x-0 top-0 flex items-start p-2">
        <div className="flex min-w-0 flex-1 items-start pt-4 pr-5 pl-4">
          {title ? (
            <h2
              className={`min-w-0 flex-1 font-semibold leading-none text-white ${
                titleSize === "l"
                  ? "text-[40px] tracking-[-0.8px]"
                  : "text-[28px] tracking-[-0.56px]"
              }`}
            >
              {title}
            </h2>
          ) : null}
        </div>
        {onDismiss ? (
          <div className="flex shrink-0 items-start pl-3">
            <button
              aria-label="Dismiss banner"
              className="t-hover flex size-11 items-center justify-center rounded-3xl bg-black/[0.04] backdrop-blur-[2px] hover:bg-black/[0.12]"
              onClick={onDismiss}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                className="size-6"
                src={`${ASSET_BASE}/icon-cross-white.svg`}
              />
            </button>
          </div>
        ) : null}
      </div>
      <div className="absolute inset-x-0 bottom-0 px-4 pt-2 pb-4">
        <button
          className={`t-hover flex h-12 w-full items-center justify-center rounded-full font-medium text-[16px] leading-5 hover:-translate-y-0.5 active:translate-y-0 ${BUTTON_COLOR_CLASSES[buttonColor]}`}
          onClick={onAction}
          type="button"
        >
          {buttonLabel}
        </button>
      </div>
    </section>
  );
}
