import Image from "next/image";
import Link from "next/link";

const browserCards = [
  {
    href: "/app",
    icon: "/landing/figma/get-started-chrome.svg",
    label: "Chrome",
    shape: "rounded-[24px]",
  },
  {
    href: "/app",
    icon: "/landing/figma/get-started-firefox.svg",
    label: "Firefox",
    shape: "rounded-[400px]",
  },
  {
    href: "/app",
    icon: "/landing/figma/get-started-edge.svg",
    label: "Edge",
    shape: "rounded-[400px]",
  },
  {
    href: "/app",
    icon: "/landing/figma/get-started-brave.svg",
    label: "Brave",
    shape: "rounded-[24px]",
  },
];

const segments = ["Extension", "Mobile", "Web"];

export function LandingGetStarted() {
  return (
    <section
      className="flex w-full justify-center bg-white px-6 py-24"
      id="get-started"
    >
      <div className="flex w-full max-w-[1560px] flex-col items-start">
        <div
          className="flex w-full flex-col items-start justify-center pb-12"
          data-reveal="left"
        >
          <div className="flex w-full flex-col items-start justify-center gap-6">
            <h2 className="whitespace-nowrap text-[48px] font-semibold leading-none tracking-[-0.02em] text-black">
              Get started{" "}
            </h2>

            <div
              aria-label="Get started platform"
              className="flex h-11 items-center justify-center rounded-[60px] bg-[#f5f5f5] p-1"
              role="tablist"
            >
              {segments.map((segment, index) => {
                const isActive = index === 0;

                return (
                  <button
                    aria-selected={isActive}
                    className={`flex h-9 items-center justify-center rounded-full px-4 py-2 text-center text-[16px] font-normal leading-5 transition duration-150 ease-out ${
                      isActive
                        ? "bg-black text-white"
                        : "text-[#3c3c43]/60 hover:bg-white hover:text-black"
                    }`}
                    key={segment}
                    role="tab"
                    type="button"
                  >
                    {segment}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid w-full gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="grid min-h-[600px] min-w-0 grid-cols-2 gap-6 overflow-hidden">
            {browserCards.map((browser, index) => (
              <Link
                className="group relative flex min-h-[210px] items-center justify-center overflow-hidden bg-transparent transition duration-200 ease-out hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black active:translate-y-0 md:min-h-[288px]"
                data-reveal="scale"
                data-reveal-delay={index + 1}
                href={browser.href}
                key={browser.label}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 bg-[#f5f5f5] transition-all duration-300 ease-out group-hover:scale-90 group-hover:rounded-none group-hover:bg-[#eeeeee] group-hover:[clip-path:polygon(50%_0%,61%_35%,98%_35%,68%_57%,79%_91%,50%_70%,21%_91%,32%_57%,2%_35%,39%_35%)] ${browser.shape}`}
                />
                <span className="relative z-10 flex w-24 flex-col items-center gap-4 pt-4">
                  <Image
                    alt=""
                    aria-hidden="true"
                    height={96}
                    src={browser.icon}
                    width={96}
                  />
                  <span className="flex items-center justify-center rounded-[100px] bg-white px-3 py-1 text-[14px] font-normal leading-5 text-[#f9363c] transition duration-200 ease-out group-hover:scale-105">
                    {browser.label}
                  </span>
                </span>
              </Link>
            ))}
          </div>

          <div
            className="relative min-h-[420px] min-w-0 overflow-hidden rounded-[24px] bg-[#f9363c] lg:h-[600px]"
            data-reveal="right"
            data-reveal-delay="2"
          >
            <Image
              alt="Loyal browser extension wallet preview"
              className="object-cover"
              fill
              sizes="(min-width: 1560px) 732px, (min-width: 1024px) calc((100vw - 96px) / 2), calc(100vw - 48px)"
              src="/landing/figma/get-started-extension-wallet.png"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
