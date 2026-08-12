import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type CardsThreeVariant = "bare" | "muted" | "bold";
export type CardTone = "dark" | "light" | "red";

export type CardsThreeCard = {
  icon?: ReactNode;
  title: string;
  body: ReactNode;
  tone?: CardTone;
};

export type CardsThreeProps = {
  title: string;
  description?: ReactNode;
  variant: CardsThreeVariant;
  cards: CardsThreeCard[];
};

const TONE_STYLES: Record<
  CardTone,
  { bg: string; title: string; body: string }
> = {
  dark: { bg: "bg-black", title: "text-white", body: "text-white/60" },
  light: { bg: "bg-[#f5f5f5]", title: "text-black", body: "text-black/60" },
  red: { bg: "bg-[#f9363c]", title: "text-white", body: "text-white/80" },
};

const DEFAULT_BOLD_TONES: readonly CardTone[] = ["dark", "light", "red"];

const VARIANT_GAP_Y: Record<CardsThreeVariant, string> = {
  bare: "md:gap-y-12",
  muted: "md:gap-y-6",
  bold: "md:gap-y-6",
};

export function CardsThree({
  title,
  description,
  variant,
  cards,
}: CardsThreeProps) {
  return (
    <section
      className="flex w-full justify-center bg-white"
      data-marketing-block="cards-three"
      data-variant={variant}
    >
      <div className="flex w-full max-w-[1560px] flex-col px-6 py-20 lg:px-6 lg:py-[128px]">
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
            "grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-x-6",
            VARIANT_GAP_Y[variant]
          )}
        >
          {cards.map((card, i) => (
            <CardView
              card={card}
              index={i}
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

function CardView({
  card,
  variant,
  index,
}: {
  card: CardsThreeCard;
  variant: CardsThreeVariant;
  index: number;
}) {
  if (variant === "bare") {
    return (
      <CardInner
        bodyClassName="text-black/60"
        body={card.body}
        icon={card.icon}
        titleClassName="text-black"
        title={card.title}
      />
    );
  }

  if (variant === "muted") {
    return (
      <div className="flex flex-col gap-6 rounded-3xl bg-[#f5f5f5] p-8">
        <CardInner
          bodyClassName="text-black/60"
          body={card.body}
          icon={card.icon}
          titleClassName="text-black"
          title={card.title}
        />
      </div>
    );
  }

  const tone = card.tone ?? DEFAULT_BOLD_TONES[index] ?? "dark";
  const styles = TONE_STYLES[tone];
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-6 rounded-3xl p-8 lg:h-[500px]",
        styles.bg
      )}
    >
      <CardInner
        bodyClassName={styles.body}
        body={card.body}
        icon={card.icon}
        titleClassName={styles.title}
        title={card.title}
      />
    </div>
  );
}

function CardInner({
  icon,
  title,
  body,
  titleClassName,
  bodyClassName,
}: {
  icon?: ReactNode;
  title: string;
  body: ReactNode;
  titleClassName: string;
  bodyClassName: string;
}) {
  return (
    <>
      {icon ? (
        <div
          aria-hidden="true"
          className="flex size-[64px] items-center justify-center"
        >
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col gap-4 md:pr-8">
        <h3
          className={cn(
            "max-w-[400px] text-[24px] font-semibold leading-[1.2] tracking-[-0.02em] md:text-[28px] md:tracking-[-0.56px] lg:text-[32px] lg:tracking-[-0.64px]",
            titleClassName
          )}
        >
          {title}
        </h3>
        <div
          className={cn(
            "max-w-[400px] text-[16px] leading-[1.2] tracking-[-0.02em] md:text-[20px] md:tracking-[-0.4px] lg:text-[24px] lg:tracking-[-0.48px]",
            bodyClassName
          )}
        >
          {body}
        </div>
      </div>
    </>
  );
}
