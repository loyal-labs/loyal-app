import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type HeroTone = "dark" | "light" | "white" | "red";

export type HeroProps = {
  tone: HeroTone;
  title: string;
  body: string;
  cta: { label: string; href: string };
  image: { src: string; alt: string };
};

const TONE_STYLES: Record<
  HeroTone,
  {
    section: string;
    title: string;
    body: string;
    button: string;
    imageBg: string;
  }
> = {
  dark: {
    section: "bg-black",
    title: "text-white",
    body: "text-white/60",
    button: "bg-white text-black",
    imageBg: "bg-[#f5f5f5]",
  },
  light: {
    section: "bg-[#f5f5f5]",
    title: "text-black",
    body: "text-black/60",
    button: "bg-black text-white",
    imageBg: "bg-white",
  },
  white: {
    section: "bg-white",
    title: "text-black",
    body: "text-black/60",
    button: "bg-black text-white",
    imageBg: "bg-[#f5f5f5]",
  },
  red: {
    section: "bg-[#f9363c]",
    title: "text-white",
    body: "text-white",
    button: "bg-black text-white",
    imageBg: "bg-white/10",
  },
};

export function Hero(props: HeroProps) {
  if (props.tone === "red") {
    return <HeroSplit {...props} />;
  }
  return <HeroDefault {...props} />;
}

function HeroDefault({ tone, title, body, cta, image }: HeroProps) {
  const styles = TONE_STYLES[tone];
  return (
    <section
      className={cn("flex w-full justify-center", styles.section)}
      data-marketing-block="hero"
      data-tone={tone}
    >
      <div className="grid w-full max-w-[1560px] grid-cols-1 items-center gap-y-12 px-6 py-16 lg:grid-cols-12 lg:gap-x-6 lg:py-[120px]">
        <div className="flex flex-col gap-12 lg:col-span-5">
          <div className="flex flex-col gap-8">
            <h1
              className={cn(
                "text-[48px] font-semibold leading-none tracking-[-0.02em] lg:text-[72px] lg:tracking-[-1.44px]",
                styles.title
              )}
            >
              {title}
            </h1>
            <p
              className={cn(
                "text-[18px] leading-[1.2] tracking-[-0.02em] lg:max-w-[517px] lg:text-[24px] lg:tracking-[-0.48px]",
                styles.body
              )}
            >
              {body}
            </p>
          </div>
          <Link
            className={cn(
              "inline-flex h-[52px] w-fit items-center justify-center rounded-full px-6 text-[20px] font-medium leading-5 transition-transform duration-150 ease-out hover:-translate-y-0.5 active:translate-y-0 lg:text-[24px]",
              styles.button
            )}
            href={cta.href}
          >
            {cta.label}
          </Link>
        </div>
        <div
          className={cn(
            "relative aspect-square w-full overflow-hidden rounded-3xl lg:col-span-6 lg:col-start-7 lg:aspect-auto lg:h-[732px]",
            styles.imageBg
          )}
        >
          <Image
            alt={image.alt}
            className="object-cover"
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            src={image.src}
          />
        </div>
      </div>
    </section>
  );
}

function HeroSplit({ title, body, cta, image }: HeroProps) {
  const styles = TONE_STYLES.red;
  return (
    <section
      className={cn("flex w-full justify-center", styles.section)}
      data-marketing-block="hero"
      data-tone="red"
    >
      <div className="grid w-full max-w-[1560px] grid-cols-1 items-center gap-y-12 px-6 py-16 lg:grid-cols-12 lg:gap-x-6 lg:py-[120px]">
        <div className="flex flex-col justify-center lg:col-span-4">
          <h1
            className={cn(
              "max-w-[420px] text-[44px] font-semibold leading-none tracking-[-0.02em] lg:text-[64px] lg:tracking-[-1.28px]",
              styles.title
            )}
          >
            {title}
          </h1>
        </div>
        <div
          className={cn(
            "relative aspect-[3/4] w-full overflow-hidden rounded-3xl lg:col-span-4 lg:col-start-5 lg:aspect-auto lg:h-[600px]",
            styles.imageBg
          )}
        >
          <Image
            alt={image.alt}
            className="object-cover"
            fill
            sizes="(min-width: 1024px) 33vw, 100vw"
            src={image.src}
          />
        </div>
        <div className="flex flex-col gap-8 lg:col-span-3 lg:col-start-10">
          <p
            className={cn(
              "text-[18px] leading-[1.1] tracking-[-0.02em] lg:max-w-[300px] lg:text-[20px] lg:tracking-[-0.4px]",
              styles.body
            )}
          >
            {body}
          </p>
          <Link
            className={cn(
              "inline-flex w-fit items-center justify-center rounded-full px-5 py-3 text-[16px] font-normal leading-5 transition-transform duration-150 ease-out hover:-translate-y-0.5 active:translate-y-0",
              styles.button
            )}
            href={cta.href}
          >
            {cta.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
