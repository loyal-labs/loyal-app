import Image from "next/image";
import Link from "next/link";

export function LandingTrust() {
  return (
    <section
      className="flex w-full justify-center bg-white px-4 py-12 lg:px-6 lg:py-24"
      id="trust"
    >
      <div className="w-full max-w-[528px] lg:max-w-[1560px]">
        <article
          className="relative flex min-w-0 flex-col overflow-hidden rounded-[24px] bg-[#f5f5f5]"
          data-reveal="scale"
        >
          <div className="flex w-full flex-col items-start gap-6 px-6 pb-8 pt-10 lg:gap-8 lg:px-16 lg:py-20 lg:pr-[420px]">
            <h2 className="max-w-[820px] text-[36px] font-semibold leading-none tracking-[-0.02em] text-black lg:text-[56px] lg:tracking-[-1.12px]">
              Your funds are secured by Squads
            </h2>

            <p className="max-w-[620px] text-[18px] leading-[1.2] tracking-[-0.02em] text-black/60 lg:text-[24px] lg:tracking-[-0.48px]">
              The smart account standard on Solana, trusted by 450+ teams to
              secure over $15 billion. Loyal never holds your keys.
            </p>

            <Link
              className="inline-flex h-[52px] items-center justify-center rounded-full bg-black px-5 text-center text-[20px] font-medium leading-6 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black active:translate-y-0"
              href="/trust"
            >
              How your funds are secured
            </Link>
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none flex justify-center pb-10 lg:absolute lg:bottom-12 lg:right-16 lg:p-0"
          >
            <Image
              alt=""
              className="h-[140px] w-[140px] lg:h-[280px] lg:w-[280px]"
              height={288}
              src="/Shield.svg"
              width={288}
            />
          </div>
        </article>
      </div>
    </section>
  );
}
