import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type CardsGridVariant = "bare" | "muted";
export type CardsGridColumns = 2 | 3;

export type CardsGridCard = {
  icon?: ReactNode;
  title: string;
  body: ReactNode;
};

export type CardsGridProps = {
  title: string;
  description?: ReactNode;
  variant: CardsGridVariant;
  cards: CardsGridCard[];
  columns?: CardsGridColumns;
  closingStatement?: ReactNode;
  compactBottom?: boolean;
};

export function CardsGrid({
  title,
  description,
  variant,
  cards,
  columns = 3,
  closingStatement,
  compactBottom = false,
}: CardsGridProps) {
  const hasFiveCards = cards.length === 5;
  const gridColsClass = columns === 2 ? "md:grid-cols-2" : "md:grid-cols-3";
  const verticalPadding = compactBottom
    ? "py-20 lg:pb-[96px] lg:pt-[128px]"
    : "py-20 lg:py-[128px]";
  return (
    <section
      className="flex w-full justify-center bg-white"
      data-columns={columns}
      data-marketing-block="cards-grid"
      data-variant={variant}
    >
      <div
        className={cn(
          "flex w-full max-w-[1560px] flex-col px-6 lg:px-6",
          verticalPadding
        )}
      >
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
        <div
          className={cn(
            "grid grid-cols-1 md:gap-x-6",
            gridColsClass,
            variant === "bare" ? "gap-10 md:gap-y-12" : "gap-6"
          )}
        >
          {cards.map((card, i) => (
            <CardView
              card={card}
              forceCol3={columns === 3 && hasFiveCards && i === 4}
              // biome-ignore lint/suspicious/noArrayIndexKey: cards are positionally meaningful
              key={i}
              variant={variant}
            />
          ))}
          {closingStatement ? (
            <div className="flex items-end pr-10">
              <p className="max-w-[700px] text-[20px] leading-[1.2] tracking-[-0.02em] text-black md:text-[24px] md:tracking-[-0.48px] lg:text-[32px] lg:tracking-[-0.64px]">
                {closingStatement}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CardView({
  card,
  variant,
  forceCol3,
}: {
  card: CardsGridCard;
  variant: CardsGridVariant;
  forceCol3: boolean;
}) {
  const wrapperClass = cn(
    variant === "muted"
      ? "flex flex-col gap-6 rounded-3xl bg-[#f5f5f5] p-8"
      : "flex flex-col gap-6",
    forceCol3 ? "md:col-start-3" : ""
  );

  return (
    <div className={wrapperClass}>
      {card.icon ? (
        <div
          aria-hidden="true"
          className="flex size-[64px] items-center justify-center"
        >
          {card.icon}
        </div>
      ) : null}
      <div className="flex flex-col gap-4 md:pr-8">
        <h3 className="max-w-[400px] text-[24px] font-semibold leading-[1.2] tracking-[-0.02em] text-black md:text-[28px] md:tracking-[-0.56px] lg:text-[32px] lg:tracking-[-0.64px]">
          {card.title}
        </h3>
        <div className="max-w-[500px] text-[16px] leading-[1.2] tracking-[-0.02em] text-black/60 md:text-[20px] md:tracking-[-0.4px] lg:text-[24px] lg:tracking-[-0.48px]">
          {card.body}
        </div>
      </div>
    </div>
  );
}
