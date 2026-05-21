import Image from "next/image";
import type { ReactNode } from "react";

import type { CardsTwoCard } from "@/features/marketing/blocks/cards-two";

export type BannerCardsTwoProps = {
  title: string;
  description: ReactNode;
  banner: { src: string; alt: string; bg?: string };
  cards: [CardsTwoCard, CardsTwoCard];
};

export function BannerCardsTwo({
  title,
  description,
  banner,
  cards,
}: BannerCardsTwoProps) {
  return (
    <section
      className="flex w-full justify-center bg-white"
      data-marketing-block="banner-cards-two"
    >
      <div className="flex w-full max-w-[1560px] flex-col gap-16 px-6 py-20 lg:gap-[96px] lg:px-6 lg:py-[128px]">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-x-6">
          <div className="flex flex-col gap-8 lg:col-span-5 lg:pr-10">
            <h2 className="text-[48px] font-semibold leading-none tracking-[-0.02em] text-black lg:text-[72px] lg:tracking-[-1.44px]">
              {title}
            </h2>
            <div className="text-[18px] leading-[1.2] tracking-[-0.02em] text-black/60 lg:text-[24px] lg:tracking-[-0.48px]">
              {description}
            </div>
          </div>
          <div
            className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl lg:col-span-6 lg:col-start-7"
            style={banner.bg ? { background: banner.bg } : undefined}
          >
            <Image
              alt={banner.alt}
              className="object-cover"
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              src={banner.src}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-x-6 lg:gap-y-12">
          {cards.map((card, i) => (
            <div
              className="flex flex-col gap-6"
              // biome-ignore lint/suspicious/noArrayIndexKey: cards are positionally meaningful
              key={i}
            >
              {card.icon ? (
                <div
                  aria-hidden="true"
                  className="flex size-[64px] items-center justify-center"
                >
                  {card.icon}
                </div>
              ) : null}
              <div className="flex flex-col gap-4 lg:pr-8">
                <h3 className="max-w-[400px] text-[24px] font-semibold leading-[1.2] tracking-[-0.02em] text-black lg:text-[32px] lg:tracking-[-0.64px]">
                  {card.title}
                </h3>
                <div className="max-w-[500px] text-[16px] leading-[1.2] tracking-[-0.02em] text-black/60 lg:text-[24px] lg:tracking-[-0.48px]">
                  {card.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
