import Image from "next/image";
import type { ReactNode } from "react";

const supporters = [
  "Solana",
  "Superteam",
  "Squads",
  "Solana Mobile",
  "Webacy",
  "MetaDAO",
] as const;

type Supporter = (typeof supporters)[number];

function SupporterLogo({ name }: { name: Supporter }) {
  let logo: ReactNode;

  switch (name) {
    case "Solana":
      logo = (
        <Image
          alt=""
          aria-hidden="true"
          className="h-[18px] w-[120px] lg:h-6 lg:w-40"
          height={24}
          src="/landing/assets/supporter-solana.svg"
          width={160}
        />
      );
      break;
    case "Superteam":
      logo = (
        <div className="relative h-6 w-[129.374px] lg:h-8 lg:w-[172.499px]">
          <Image
            alt=""
            aria-hidden="true"
            className="absolute left-0 top-0 h-[18.035px] w-[129.376px] lg:h-[24.047px] lg:w-[172.501px]"
            height={25}
            src="/landing/assets/supporter-superteam.svg"
            width={173}
          />
          <Image
            alt=""
            aria-hidden="true"
            className="absolute bottom-0 right-0 h-[6.181px] w-[17.411px] lg:h-[8.241px] lg:w-[23.214px]"
            height={9}
            src="/landing/assets/supporter-superteam-geo.svg"
            width={24}
          />
        </div>
      );
      break;
    case "Squads":
      logo = (
        <Image
          alt=""
          aria-hidden="true"
          className="h-6 w-[127px] lg:h-8 lg:w-[169.333px]"
          height={32}
          src="/landing/assets/supporter-squads.svg"
          width={170}
        />
      );
      break;
    case "Solana Mobile":
      logo = (
        <Image
          alt=""
          aria-hidden="true"
          className="h-[17.012px] w-[202.734px] lg:h-[22.683px] lg:w-[270.312px]"
          height={23}
          src="/landing/assets/supporter-solana-mobile.svg"
          width={271}
        />
      );
      break;
    case "Webacy":
      logo = (
        <Image
          alt=""
          aria-hidden="true"
          className="h-6 w-[88.238px] lg:h-8 lg:w-[117.651px]"
          height={32}
          src="/landing/assets/supporter-webacy.svg"
          width={118}
        />
      );
      break;
    case "MetaDAO":
      logo = (
        <div
          aria-hidden="true"
          className="flex items-center gap-[7.692px] lg:gap-[10.256px]"
        >
          <Image
            alt=""
            aria-hidden="true"
            className="size-5 lg:size-[26.667px]"
            height={27}
            src="/landing/assets/supporter-metadao.svg"
            width={27}
          />
          <span className="whitespace-nowrap font-bold text-[#8a8a8e] text-[18.445px] uppercase leading-[1.1] tracking-[-0.3689px] lg:text-[24.593px] lg:tracking-[-0.4919px]">
            MetaDAO
          </span>
        </div>
      );
      break;
  }

  return (
    <li
      className={`flex h-12 shrink-0 items-center justify-center lg:h-16 ${
        name === "Superteam" ? "pt-1 lg:pt-[5.333px]" : ""
      }`}
    >
      <span className="sr-only">{name}</span>
      {logo}
    </li>
  );
}

function SupporterSet({ duplicate = false }: { duplicate?: boolean }) {
  return (
    <ul
      aria-hidden={duplicate || undefined}
      className={`flex shrink-0 items-center gap-6 pr-9 lg:gap-12 lg:pr-12 ${
        duplicate ? "supporters-marquee-copy" : ""
      }`}
    >
      {supporters.map((supporter) => (
        <SupporterLogo key={supporter} name={supporter} />
      ))}
    </ul>
  );
}

export function LandingSupportedBy() {
  return (
    <section
      aria-labelledby="supported-by-title"
      className="flex w-full flex-col items-center bg-white pt-14 lg:pt-20"
    >
      <h2
        className="w-full text-center text-[#8a8a8e] text-[20px] leading-[1.2] tracking-[-0.4px] lg:text-[24px] lg:tracking-[-0.48px]"
        id="supported-by-title"
      >
        Supported by
      </h2>
      <div className="supporters-marquee-viewport scrollbar-hide w-full px-4 pb-4 pt-2 lg:pb-6 lg:pl-12 lg:pr-6 lg:pt-4">
        <div className="supporters-marquee-track flex w-max items-center">
          <SupporterSet />
          <SupporterSet duplicate />
          <SupporterSet duplicate />
        </div>
      </div>
    </section>
  );
}
