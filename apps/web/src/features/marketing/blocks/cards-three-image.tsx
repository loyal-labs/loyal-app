import Image from "next/image";
import type { ReactNode } from "react";

export type CardsThreeImageCard = {
  image: { src: string; alt: string; bg?: string };
  title: string;
  body: ReactNode;
};

export type CardsThreeImageProps = {
  title: string;
  description?: ReactNode;
  cards: [CardsThreeImageCard, CardsThreeImageCard, CardsThreeImageCard];
};

export function CardsThreeImage({
  title,
  description,
  cards,
}: CardsThreeImageProps) {
  return (
    <section
      className="flex w-full justify-center bg-white"
      data-marketing-block="cards-three-image"
    >
      <div className="flex w-full max-w-[1560px] flex-col px-6 py-20 lg:px-6 lg:py-[96px]">
        <div className="flex flex-col gap-5 pb-12 lg:flex-row lg:items-start lg:gap-5 lg:pb-16">
          <h2 className="max-w-[600px] text-[40px] font-semibold leading-none tracking-[-0.02em] text-black lg:flex-1 lg:text-[64px] lg:leading-[64px] lg:tracking-[-1.28px]">
            {title}
          </h2>
          {description ? (
            <div className="text-[20px] leading-[1.2] tracking-[-0.02em] text-black lg:max-w-[700px] lg:flex-1 lg:pr-10 lg:text-[32px] lg:tracking-[-0.64px]">
              {description}
            </div>
          ) : (
            <div aria-hidden="true" className="hidden lg:block lg:flex-1" />
          )}
        </div>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-3 lg:gap-x-6 lg:gap-y-12">
          {cards.map((card, i) => (
            <div
              className="flex flex-col gap-6"
              // biome-ignore lint/suspicious/noArrayIndexKey: cards are positionally meaningful
              key={i}
            >
              <div
                className="relative aspect-square w-full overflow-hidden rounded-3xl"
                style={card.image.bg ? { background: card.image.bg } : undefined}
              >
                <Image
                  alt={card.image.alt}
                  className="object-cover"
                  fill
                  sizes="(min-width: 1024px) 33vw, 100vw"
                  src={card.image.src}
                />
              </div>
              <div className="flex flex-col gap-4 lg:pr-8">
                <h3 className="max-w-[400px] text-[24px] font-semibold leading-[1.2] tracking-[-0.02em] text-black lg:text-[32px] lg:tracking-[-0.64px]">
                  {card.title}
                </h3>
                <div className="max-w-[600px] text-[16px] leading-[1.2] tracking-[-0.02em] text-black/60 lg:text-[24px] lg:tracking-[-0.48px]">
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
