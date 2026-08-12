import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type CardsTwoVariant = "bare" | "muted";
export type CardsTwoLayout = "stacked" | "inline";
export type CardsTwoTitlePosition = "left" | "right";

export type CardsTwoCard = {
  icon?: ReactNode;
  title: string;
  body: ReactNode;
};

export type CardsTwoProps = {
  title: string;
  description?: ReactNode;
  layout?: CardsTwoLayout;
  titlePosition?: CardsTwoTitlePosition;
  variant: CardsTwoVariant;
  cards: [CardsTwoCard, CardsTwoCard];
};

export function CardsTwo({
  title,
  description,
  layout = "stacked",
  titlePosition = "left",
  variant,
  cards,
}: CardsTwoProps) {
  if (layout === "inline") {
    return (
      <InlineCardsTwo
        cards={cards}
        description={description}
        title={title}
        variant={variant}
      />
    );
  }
  return (
    <StackedCardsTwo
      cards={cards}
      description={description}
      title={title}
      titlePosition={titlePosition}
      variant={variant}
    />
  );
}

function StackedCardsTwo({
  title,
  description,
  titlePosition,
  variant,
  cards,
}: {
  title: string;
  description?: ReactNode;
  titlePosition: CardsTwoTitlePosition;
  variant: CardsTwoVariant;
  cards: [CardsTwoCard, CardsTwoCard];
}) {
  const heading = (
    <h2 className="text-[40px] font-semibold leading-none tracking-[-0.02em] text-black md:max-w-[600px] md:text-[56px] md:leading-[0.95] md:tracking-[-1.12px] lg:text-[64px] lg:leading-[64px] lg:tracking-[-1.28px]">
      {title}
    </h2>
  );
  const descriptionBlock = description ? (
    <div className="text-[20px] leading-[1.2] tracking-[-0.02em] text-black md:max-w-[700px] md:pr-10 md:text-[24px] md:tracking-[-0.48px] lg:text-[32px] lg:tracking-[-0.64px]">
      {description}
    </div>
  ) : (
    <div aria-hidden="true" className="hidden md:block" />
  );

  return (
    <section
      className="flex w-full justify-center bg-white"
      data-layout="stacked"
      data-marketing-block="cards-two"
      data-variant={variant}
    >
      <div className="flex w-full max-w-[1560px] flex-col px-6 py-20 lg:px-6 lg:py-[128px]">
        <div className="grid grid-cols-1 gap-5 pb-12 md:grid-cols-2 md:items-start md:gap-x-6 md:pb-16">
          {titlePosition === "right" ? (
            <>
              {descriptionBlock}
              {heading}
            </>
          ) : (
            <>
              {heading}
              {descriptionBlock}
            </>
          )}
        </div>
        <div
          className={cn(
            "grid grid-cols-1 md:grid-cols-2 md:gap-x-6",
            variant === "bare" ? "gap-10 md:gap-y-12" : "gap-6"
          )}
        >
          {cards.map((card, i) => (
            <CardView
              card={card}
              // biome-ignore lint/suspicious/noArrayIndexKey: cards are positionally meaningful
              key={i}
              variant={variant}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function InlineCardsTwo({
  title,
  description,
  variant,
  cards,
}: {
  title: string;
  description?: ReactNode;
  variant: CardsTwoVariant;
  cards: [CardsTwoCard, CardsTwoCard];
}) {
  return (
    <section
      className="flex w-full justify-center bg-white"
      data-layout="inline"
      data-marketing-block="cards-two"
      data-variant={variant}
    >
      <div className="flex w-full max-w-[1560px] flex-col gap-10 px-6 py-20 md:grid md:grid-cols-3 md:items-stretch md:gap-6 lg:px-6 lg:py-[128px]">
        <div className="flex flex-col gap-6 md:justify-center md:pr-10">
          <h2 className="text-[40px] font-semibold leading-none tracking-[-0.02em] text-black md:max-w-[600px] md:text-[48px] md:leading-[0.95] md:tracking-[-0.96px] lg:text-[64px] lg:leading-[64px] lg:tracking-[-1.28px]">
            {title}
          </h2>
          {description ? (
            <div className="text-[18px] leading-[1.2] tracking-[-0.02em] text-black/60 md:text-[20px] md:tracking-[-0.4px] lg:text-[24px] lg:tracking-[-0.48px]">
              {description}
            </div>
          ) : null}
        </div>
        {cards.map((card, i) => (
          <CardView
            card={card}
            // biome-ignore lint/suspicious/noArrayIndexKey: cards are positionally meaningful
            key={i}
            stretch
            variant={variant}
          />
        ))}
      </div>
    </section>
  );
}

function CardView({
  card,
  variant,
  stretch,
}: {
  card: CardsTwoCard;
  variant: CardsTwoVariant;
  stretch?: boolean;
}) {
  const wrapperClass =
    variant === "muted"
      ? cn(
          "flex flex-col gap-6 rounded-3xl bg-[#f5f5f5] p-8",
          stretch ? "lg:flex-1" : ""
        )
      : cn("flex flex-col gap-6", stretch ? "lg:flex-1" : "");

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
      <div className="flex flex-col gap-4 lg:pr-8">
        <h3 className="max-w-[400px] text-[24px] font-semibold leading-[1.2] tracking-[-0.02em] text-black lg:text-[32px] lg:tracking-[-0.64px]">
          {card.title}
        </h3>
        <div className="max-w-[500px] text-[16px] leading-[1.2] tracking-[-0.02em] text-black/60 lg:text-[24px] lg:tracking-[-0.48px]">
          {card.body}
        </div>
      </div>
    </div>
  );
}
