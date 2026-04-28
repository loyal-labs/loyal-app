import Image from "next/image";
import Link from "next/link";

import { LandingAnalyticsBootstrap } from "@/components/analytics/LandingAnalyticsBootstrap";
import { LandingBlog } from "@/components/landing-blog";
import { LandingFaq } from "@/components/landing-faq";
import { LandingFooter } from "@/components/landing-footer";
import { LandingGetStarted } from "@/components/landing-get-started";
import { LandingHeader } from "@/components/landing-header";
import { LandingHero } from "@/components/landing-hero";
import { LandingRoadmap } from "@/components/landing-roadmap";
import { LandingScrollAnimations } from "@/components/landing-scroll-animations";

const featureCards = [
  {
    images: ["/landing/figma/feature-yield-card.png"],
    text: "Earn in the background without locking up your funds or giving up control",
    tone: "black",
  },
  {
    images: [
      "/landing/figma/feature-phone-bg.png",
      "/landing/figma/feature-phone-overlay.png",
    ],
    text: "Keep your finds private, execute secure transactions and make money on shielded assets",
    tone: "light",
  },
  {
    images: ["/landing/figma/feature-agent-card.png"],
    text: "Define guardrails and rulesets for your financial workflows: assign granular permissions to every agent",
    tone: "red",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-x-clip bg-white text-black">
      <LandingAnalyticsBootstrap />
      <LandingScrollAnimations />
      <LandingHeader />
      <LandingHero />

      <section
        className="flex w-full justify-center bg-white px-4 pb-[72px] pt-20 lg:px-6 lg:pb-24 lg:pt-32"
        id="features"
      >
        <div className="grid w-full max-w-[528px] gap-14 lg:max-w-[1560px] lg:grid-cols-3 lg:gap-6">
          {featureCards.map((feature, index) => (
            <article
              className="flex min-w-0 flex-col gap-5 lg:gap-8"
              data-reveal="scale"
              data-reveal-delay={index + 1}
              key={feature.text}
            >
              <div
                className={`relative aspect-square w-full overflow-hidden rounded-[24px] ${
                  feature.tone === "black"
                    ? "bg-black"
                    : feature.tone === "red"
                    ? "bg-[#f9363c]"
                    : "bg-[#f2f2f2]"
                }`}
              >
                {feature.images.map((src) => (
                  <Image
                    alt=""
                    aria-hidden="true"
                    className="object-cover"
                    fill
                    key={src}
                    loading="eager"
                    sizes="(min-width: 1560px) 496px, (min-width: 768px) calc((100vw - 96px) / 3), calc(100vw - 48px)"
                    src={src}
                    unoptimized
                  />
                ))}
              </div>
              <p className="max-w-[400px] pr-4 text-[20px] font-normal leading-[1.2] text-black lg:text-[24px]">
                {feature.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="flex w-full justify-center bg-white px-4 py-12 lg:px-6 lg:py-32">
        <div className="grid w-full max-w-[528px] gap-6 lg:max-w-[1560px] lg:grid-cols-12 lg:gap-6">
          <div
            className="order-1 flex items-center lg:col-span-4 lg:order-none lg:pr-1"
            data-reveal="left"
          >
            <h2 className="max-w-[420px] text-[48px] font-semibold leading-none text-black lg:text-[56px]">
              Multiple wallets, one smart account
            </h2>
          </div>

          <div
            className="order-3 flex items-start justify-center lg:col-span-4 lg:col-start-5 lg:order-none lg:row-start-1"
            data-reveal="scale"
            data-reveal-delay="1"
          >
            <div className="relative mt-6 aspect-[400/600] w-full overflow-hidden rounded-[24px] border border-black/10 lg:mt-0">
              <Image
                alt=""
                aria-hidden="true"
                className="object-cover"
                fill
                sizes="(min-width: 1560px) 496px, (min-width: 768px) calc((100vw - 96px) / 3), calc(100vw - 48px)"
                src="/landing/figma/multiple-wallets-content.png"
              />
            </div>
          </div>

          <div
            className="order-2 flex flex-col items-start justify-center gap-6 lg:col-span-3 lg:col-start-10 lg:order-none lg:row-start-1 lg:gap-8"
            data-reveal="right"
            data-reveal-delay="2"
          >
            <p className="max-w-[280px] text-[20px] font-normal leading-[1.1] text-black lg:max-w-[300px] lg:text-[24px]">
              Schedule payments, run strategies, and let never sleeping AI work
              for you
            </p>
            <Link
              className="inline-flex items-center justify-center rounded-full bg-black px-5 py-3 text-center text-[16px] font-normal leading-5 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black active:translate-y-0"
              href="#get-started"
            >
              Get started
            </Link>
          </div>
        </div>
      </section>

      <section
        className="flex w-full justify-center bg-white px-4 py-12 lg:px-6 lg:py-24"
        id="developers"
      >
        <div className="grid w-full max-w-[528px] gap-4 lg:max-w-[1560px] lg:grid-cols-2 lg:gap-6">
          <article
            className="group relative flex h-[518px] min-w-0 flex-col overflow-hidden rounded-[24px] bg-[#f5f5f5] lg:h-[600px]"
            data-reveal="left"
          >
            <div className="flex w-full flex-col items-start gap-6 px-6 py-6 pr-8 lg:gap-8 lg:px-8 lg:py-8 lg:pr-16">
              <h2 className="max-w-[600px] text-[24px] font-medium leading-[1.1] text-black lg:text-[32px]">
                Access trusted agentic workflows built into the wallet app and
                browser extension, or build on&nbsp;top with permissionless
                access
              </h2>
              <Link
                className="inline-flex h-[52px] items-center justify-center rounded-full bg-black px-5 py-3 text-center text-[20px] font-normal leading-5 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black active:translate-y-0 lg:h-auto lg:text-[16px]"
                href="https://docs.askloyal.com/sdk/private-transactions/how-it-works"
              >
                How it works
              </Link>
            </div>
            <div className="relative flex h-[264px] shrink-0 items-end justify-end overflow-hidden pl-16 pt-6 lg:h-auto lg:min-h-0 lg:flex-1 lg:pl-8 lg:pt-8">
              <WorkflowMascot />
            </div>
          </article>

          <article
            className="group relative flex h-[610.5px] min-w-0 flex-col overflow-hidden rounded-[24px] bg-black lg:h-[600px]"
            data-reveal="right"
            data-reveal-delay="1"
          >
            <div className="flex w-full flex-col items-start gap-6 px-6 py-6 pr-8 lg:gap-8 lg:px-8 lg:py-8 lg:pr-16">
              <h2 className="max-w-[600px] text-[24px] font-medium leading-[1.1] text-white lg:text-[32px]">
                Access agentic workflows available for the mobile app and
                browser extension, or build on top with permissionless access
                using our SDK — all code is open source
              </h2>
              <Link
                className="inline-flex h-[52px] items-center justify-center rounded-full bg-white px-5 py-3 text-center text-[20px] font-normal leading-5 text-black transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#f5f5f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0 lg:h-auto lg:text-[16px]"
                href="https://docs.askloyal.com/"
              >
                Explore SDK
              </Link>
            </div>
            <div className="relative flex h-[304.5px] shrink-0 items-end justify-center overflow-hidden px-6 pb-6 pt-12 lg:h-auto lg:min-h-0 lg:flex-1 lg:justify-end lg:p-8">
              <WorkflowDocsIllustration />
            </div>
          </article>
        </div>
      </section>

      <LandingRoadmap />

      <LandingFaq />

      <LandingBlog />

      <LandingGetStarted />

      <LandingFooter />
    </main>
  );
}

function WorkflowMascot() {
  return (
    <svg
      aria-hidden="true"
      className="h-full max-h-[240px] max-w-[240px] shrink-0 lg:max-h-[320px] lg:max-w-[320px]"
      fill="none"
      viewBox="0 0 288 288"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M56.57 274.477L0 135.57H154.888V15.1016L223.727 135.57L240.937 15.1016L349.136 308.897L56.57 274.477Z"
        fill="#F9363C"
      />
      <path
        d="M208.7 225.213L221.524 267.374L47.5022 252.261L28.3477 205.227L208.7 225.213Z"
        fill="white"
      />
      <mask
        height="63"
        id="workflow-mascot-mouth-mask"
        maskUnits="userSpaceOnUse"
        style={{ maskType: "alpha" }}
        width="194"
        x="28"
        y="205"
      >
        <path
          d="M208.7 225.213L221.524 267.374L47.5022 252.261L28.3477 205.227L208.7 225.213Z"
          fill="white"
        />
      </mask>
      <g mask="url(#workflow-mascot-mouth-mask)">
        <path
          d="M39.995 236.791L69.7419 223.964L106.272 245.221L132.882 232.211L179.563 252.874L218.628 237.204"
          stroke="black"
          strokeWidth="11.4773"
        />
      </g>
      <path
        d="M192.61 153.837C221.085 155.329 243.12 176.545 241.827 201.223L138.71 195.819C140.003 171.14 164.135 152.345 192.61 153.837Z"
        fill="white"
      />
      <mask
        height="49"
        id="workflow-mascot-eye-mask"
        maskUnits="userSpaceOnUse"
        style={{ maskType: "alpha" }}
        width="104"
        x="138"
        y="153"
      >
        <path
          d="M192.61 153.837C221.085 155.329 243.12 176.545 241.827 201.223L138.71 195.819C140.003 171.14 164.135 152.345 192.61 153.837Z"
          fill="white"
        />
      </mask>
      <g mask="url(#workflow-mascot-eye-mask)">
        <circle
          className="developer-mascot-eye"
          cx="198.974"
          cy="193.001"
          fill="black"
          r="23.2332"
          transform="rotate(3 198.974 193.001)"
        />
      </g>
    </svg>
  );
}

function WorkflowDocsIllustration() {
  return (
    <svg
      aria-hidden="true"
      className="h-full max-h-[240px] max-w-[320px] shrink-0"
      fill="none"
      viewBox="0 0 321 240"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0 41.1871C0 26.7703 0 19.5618 2.8057 14.0553C5.27367 9.21168 9.21168 5.27367 14.0553 2.8057C19.5618 0 26.7703 0 41.1871 0H99.2461C105.12 0 108.058 0 110.843 0.62533C113.313 1.17992 115.687 2.09582 117.89 3.34346C120.374 4.75023 122.55 6.72253 126.903 10.6671L143.229 25.4613C147.582 29.4058 149.758 31.3781 152.242 32.7849C154.444 34.0325 156.819 34.9484 159.289 35.503C162.074 36.1284 165.011 36.1284 170.886 36.1284H278.892C293.316 36.1284 300.527 36.1284 306.035 38.9358C310.88 41.4052 314.818 45.3455 317.285 50.1916C320.09 55.7008 320.087 62.9124 320.079 77.3356L320.02 198.833C320.013 213.243 320.01 220.449 317.203 225.952C314.734 230.794 310.796 234.73 305.954 237.196C300.449 240 293.244 240 278.833 240H41.1871C26.7703 240 19.5618 240 14.0553 237.194C9.21168 234.726 5.27367 230.788 2.8057 225.945C0 220.438 0 213.23 0 198.813L0 41.1871Z"
        fill="#E53237"
      />
      <path
        d="M44.6055 196.091C31.137 172.598 39.2636 142.634 62.7566 129.166L170.52 67.3858C194.013 53.9173 223.976 62.0438 237.444 85.5369C250.913 109.03 242.786 138.993 219.293 152.462L111.53 214.242C88.0372 227.71 58.074 219.584 44.6055 196.091Z"
        fill="white"
      />
      <path
        d="M93.1041 146.623C103.177 140.848 112.178 143.404 118.109 153.75C124.014 164.049 121.782 172.985 111.845 178.682L101.228 184.769L82.7589 152.554L93.1041 146.623ZM103.553 177.468L108.998 174.346C116.167 170.236 117.521 164.396 113.073 156.637C108.573 148.787 102.848 147.005 95.6794 151.115L90.2345 154.236L103.553 177.468Z"
        fill="black"
      />
      <path
        d="M141.424 162.448C134.482 166.428 127.135 164.129 122.739 156.461C118.343 148.793 120.071 141.291 127.013 137.311C133.91 133.357 141.257 135.656 145.653 143.325C150.049 150.993 148.321 158.494 141.424 162.448ZM127.73 153.6C130.747 158.863 134.947 160.615 139.031 158.274C143.114 155.933 143.679 151.449 140.662 146.186C137.644 140.923 133.49 139.144 129.406 141.486C125.323 143.827 124.713 148.336 127.73 153.6Z"
        fill="black"
      />
      <path
        d="M162.826 128.717C160.584 125.963 157.21 125.546 154.488 127.107C150.404 129.448 149.794 133.957 152.811 139.221C155.829 144.484 160.029 146.236 164.112 143.895C166.971 142.256 168.264 139.043 166.838 135.399L172.031 132.784C174.53 138.827 172.041 144.896 166.505 148.069C159.518 152.075 152.19 149.705 147.82 142.082C143.45 134.459 145.107 126.938 152.094 122.932C157.449 119.863 163.93 120.548 167.661 125.583L162.826 128.717Z"
        fill="black"
      />
      <path
        d="M184.716 115.022C182.734 112.721 179.445 112.557 176.95 113.988C174.499 115.393 173.231 117.808 174.454 119.94C175.748 122.092 179.01 121.368 181.837 120.41C188.451 118.065 193.173 117.468 195.878 122.187C198.583 126.906 195.061 131.699 189.934 134.638C183.808 138.15 177.638 137.588 174.388 132.759L179.151 129.606C181.211 132.042 184.287 132.57 187.599 130.671C189.777 129.423 192.057 127.09 190.757 124.822C189.229 122.261 186.006 123.687 183.082 124.58C177.33 126.43 172.168 127.521 169.541 122.938C166.862 118.264 169.034 113.221 175.023 109.787C180.241 106.796 185.977 107.547 189.506 111.914L184.716 115.022Z"
        fill="black"
      />
      <path
        d="M242.314 168.852C271.997 168.852 296.061 189.707 296.061 215.432H188.566C188.566 189.707 212.63 168.852 242.314 168.852Z"
        fill="white"
      />
      <mask
        height="48"
        id="workflow-docs-eye-mask"
        maskUnits="userSpaceOnUse"
        style={{ maskType: "alpha" }}
        width="109"
        x="188"
        y="168"
      >
        <path
          d="M242.314 168.852C271.997 168.852 296.061 189.707 296.061 215.432H188.566C188.566 189.707 212.63 168.852 242.314 168.852Z"
          fill="white"
        />
      </mask>
      <g mask="url(#workflow-docs-eye-mask)">
        <ellipse
          className="developer-docs-eye"
          cx="242.366"
          cy="203.731"
          fill="black"
          rx="24.1862"
          ry="24.1862"
        />
      </g>
      <path
        d="M73.017 17.5341C73.4501 15.4686 75.4753 14.1452 77.5408 14.5781C79.6064 15.0112 80.9297 17.0363 80.4968 19.1019L64.4465 95.6656C64.0135 97.7312 61.9877 99.0546 59.922 98.6216C57.8567 98.1885 56.5332 96.1633 56.966 94.0979L73.017 17.5341ZM19.0539 58.9101C18.8587 55.376 20.2926 52.4224 22.3884 49.6299C24.4187 46.9246 27.4445 43.8935 31.0978 40.2228L39.2969 31.9834C40.7856 30.4874 43.2057 30.4816 44.7018 31.9703C46.1975 33.459 46.2034 35.8785 44.7148 37.3745L36.5151 45.6145C32.7036 49.4442 30.1358 52.0396 28.5014 54.2174C26.9325 56.3079 26.6307 57.495 26.6856 58.4886C26.7404 59.481 27.1714 60.6269 28.9619 62.5317C30.5939 64.268 32.9706 66.2427 36.3582 68.9767L37.8728 70.1965L37.8742 70.1971L46.9311 77.4895C48.575 78.813 48.8347 81.2184 47.5112 82.8623C46.1877 84.5062 43.7822 84.7659 42.1383 83.4425L33.0808 76.1508C29.0494 72.9081 25.7087 70.2304 23.3928 67.7665C21.0021 65.2232 19.2492 62.4454 19.0539 58.9101ZM110.73 53.8468C110.675 52.8512 110.243 51.705 108.454 49.8003C106.589 47.8158 103.753 45.5209 99.5481 42.1339L90.4861 34.8472C88.8414 33.5247 88.5802 31.1193 89.9026 29.4745C91.2251 27.8297 93.6305 27.5685 95.2753 28.891L104.337 36.1777L104.34 36.1796C108.369 39.4246 111.709 42.1031 114.024 44.5668C116.414 47.1105 118.166 49.8881 118.361 53.4253C118.556 56.9606 117.12 59.9145 115.024 62.7057C112.993 65.4097 109.967 68.4382 106.318 72.1052L98.1195 80.3506C96.6313 81.8471 94.2112 81.8539 92.7147 80.3657C91.2184 78.8776 91.2117 76.4582 92.6996 74.9617L100.899 66.7162L100.9 66.7155C104.71 62.8881 107.278 60.2936 108.913 58.116C110.483 56.0256 110.785 54.8391 110.73 53.8468Z"
        fill="white"
      />
    </svg>
  );
}
