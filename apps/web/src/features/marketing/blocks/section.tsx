import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SectionCardSize = "lg" | "md";

export type SectionCard = {
  size: SectionCardSize;
  body: ReactNode;
};

export type SectionProps = {
  title: string;
  description?: ReactNode;
  cards: [SectionCard, SectionCard];
};

const CARD_STYLES: Record<SectionCardSize, string> = {
  lg: "text-[20px] leading-[1.2] tracking-[-0.02em] text-black md:max-w-[700px] md:text-[24px] md:tracking-[-0.48px] lg:text-[32px] lg:tracking-[-0.64px]",
  md: "text-[16px] leading-[1.2] tracking-[-0.02em] text-black/60 md:max-w-[600px] md:text-[20px] md:tracking-[-0.4px] lg:text-[24px] lg:tracking-[-0.48px]",
};

export function Section({ title, description, cards }: SectionProps) {
  return (
    <section
      className="flex w-full justify-center bg-white"
      data-marketing-block="section"
    >
      <div className="flex w-full max-w-[1560px] flex-col px-6 py-16 lg:px-6 lg:py-[96px]">
        <div className="grid grid-cols-1 gap-5 pb-12 md:grid-cols-2 md:items-start md:gap-x-6 md:pb-16">
          <h2 className="text-[40px] font-semibold leading-none tracking-[-0.02em] text-black md:max-w-[600px] md:text-[56px] md:leading-[0.95] md:tracking-[-1.12px] lg:text-[64px] lg:leading-[64px] lg:tracking-[-1.28px]">
            {title}
          </h2>
          {description ? (
            <div className="text-[20px] leading-[1.2] tracking-[-0.02em] text-black md:max-w-[700px] md:pr-10 md:text-[24px] md:tracking-[-0.48px] lg:text-[32px] lg:tracking-[-0.64px]">
              {description}
            </div>
          ) : (
            <div aria-hidden="true" className="hidden md:block" />
          )}
        </div>
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-x-6">
          {cards.map((card, i) => (
            <div
              className="flex flex-col md:pr-10"
              data-card-size={card.size}
              // biome-ignore lint/suspicious/noArrayIndexKey: cards are positionally meaningful and length-fixed
              key={i}
            >
              <p className={cn("font-normal", CARD_STYLES[card.size])}>
                {card.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
