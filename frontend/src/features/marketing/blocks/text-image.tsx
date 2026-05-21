import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type TextImageLayout = "text-left" | "text-right";

export type TextImageMedia = {
  src: string;
  alt: string;
  bg?: string;
};

export type TextImageHeroProps = {
  layout?: TextImageLayout;
  title: string;
  body: ReactNode;
  cta: { label: string; href: string };
  image: TextImageMedia;
};

export function TextImageHero({
  layout = "text-left",
  title,
  body,
  cta,
  image,
}: TextImageHeroProps) {
  const isReverse = layout === "text-right";
  const imageStyle: CSSProperties = {
    background: image.bg ?? "#f5f5f5",
  };
  return (
    <section
      className="flex w-full justify-center bg-white"
      data-layout={layout}
      data-marketing-block="text-image-hero"
    >
      <div className="flex w-full max-w-[1560px] flex-col px-6 py-20 lg:px-6 lg:py-[128px]">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-x-6">
          <div
            className={cn(
              "flex flex-col gap-12 lg:col-span-4 lg:row-start-1 lg:pr-10",
              isReverse ? "lg:col-start-9" : "lg:col-start-1"
            )}
          >
            <div className="flex flex-col gap-8">
              <h2 className="text-[48px] font-semibold leading-none tracking-[-0.02em] text-black lg:text-[72px] lg:tracking-[-1.44px]">
                {title}
              </h2>
              <p className="text-[18px] leading-[1.2] tracking-[-0.02em] text-black/60 lg:text-[24px] lg:tracking-[-0.48px]">
                {body}
              </p>
            </div>
            <Link
              className="inline-flex h-[52px] w-fit items-center justify-center rounded-full bg-black px-6 text-[20px] font-medium leading-5 text-white transition-transform duration-150 ease-out hover:-translate-y-0.5 active:translate-y-0 lg:text-[24px]"
              href={cta.href}
            >
              {cta.label}
            </Link>
          </div>
          <div
            className={cn(
              "relative aspect-[4/3] w-full overflow-hidden rounded-3xl lg:col-span-7 lg:row-start-1",
              isReverse ? "lg:col-start-1" : "lg:col-start-6"
            )}
            style={imageStyle}
          >
            <Image
              alt={image.alt}
              className="object-cover"
              fill
              sizes="(min-width: 1024px) 58vw, 100vw"
              src={image.src}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export type TextImageStatementProps = {
  layout?: TextImageLayout;
  eyebrow: string;
  statement: ReactNode;
  image: TextImageMedia;
};

export function TextImageStatement({
  layout = "text-left",
  eyebrow,
  statement,
  image,
}: TextImageStatementProps) {
  const isReverse = layout === "text-right";
  const imageStyle: CSSProperties = {
    background: image.bg ?? "#f5f5f5",
  };
  return (
    <section
      className="flex w-full justify-center bg-white"
      data-layout={layout}
      data-marketing-block="text-image-statement"
    >
      <div className="flex w-full max-w-[1560px] flex-col px-6 py-20 lg:px-6 lg:py-[128px]">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-x-6">
          <div
            className={cn(
              "flex flex-col gap-4 lg:col-span-4 lg:row-start-1 lg:pr-10",
              isReverse ? "lg:col-start-9" : "lg:col-start-1"
            )}
          >
            <p className="text-[18px] leading-[1.1] tracking-[-0.02em] text-black/60 lg:text-[24px] lg:tracking-[-0.48px]">
              {eyebrow}
            </p>
            <p className="text-[24px] font-medium leading-[1.1] tracking-[-0.02em] text-black lg:text-[32px] lg:tracking-[-0.64px]">
              {statement}
            </p>
          </div>
          <div
            className={cn(
              "relative aspect-[4/3] w-full overflow-hidden rounded-3xl lg:col-span-7 lg:row-start-1",
              isReverse ? "lg:col-start-1" : "lg:col-start-6"
            )}
            style={imageStyle}
          >
            <Image
              alt={image.alt}
              className="object-cover"
              fill
              sizes="(min-width: 1024px) 58vw, 100vw"
              src={image.src}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
