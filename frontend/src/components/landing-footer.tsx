"use client";

import Image from "next/image";
import Link from "next/link";

import { TrackedExternalLink } from "@/components/analytics/tracked-external-link";

const footerColumns = [
  {
    links: [
      {
        href: "https://docs.askloyal.com/sdk/private-transactions/quick-start",
        label: "Quick Start",
      },
      {
        href: "https://docs.askloyal.com/smart-accounts/overview",
        label: "Smart Accounts",
      },
      {
        href: "https://docs.askloyal.com/sdk/private-transactions/how-it-works",
        label: "Private Transactions",
      },
      {
        href: "https://docs.askloyal.com/sdk/private-transactions/reference",
        label: "API Reference",
      },
    ],
    title: "Documentation",
  },
  {
    links: [
      { href: "/privacy-policy", label: "Privacy Policy" },
      {
        href: "https://docs.askloyal.com/transparency/q1-2026",
        label: "Transparency",
      },
    ],
    title: "Legal",
  },
  {
    links: [
      { href: "mailto:hello@askloyal.com", label: "hello@askloyal.com" },
      { href: "https://discord.askloyal.com", label: "Discord" },
      { href: "https://t.me/loyal_tgchat", label: "Telegram" },
    ],
    title: "Contact",
  },
];

const socialLinks = [
  {
    href: "https://x.com/loyal_hq",
    icon: "/landing/figma/footer-social-x.svg",
    label: "X",
  },
  {
    href: "mailto:hello@askloyal.com",
    icon: "/landing/figma/footer-social-email.svg",
    label: "Email",
  },
  {
    href: "https://t.me/loyal_tgchat",
    icon: "/landing/figma/footer-social-telegram.svg",
    label: "Telegram",
  },
  {
    href: "https://discord.askloyal.com",
    icon: "/landing/figma/footer-social-discord.svg",
    label: "Discord",
  },
  {
    href: "https://github.com/loyal-labs",
    icon: "/landing/figma/footer-social-github.svg",
    label: "GitHub",
  },
];

function isInternalHref(href: string) {
  return href.startsWith("/") || href.startsWith("#");
}

function isMailHref(href: string) {
  return href.startsWith("mailto:");
}

function FooterTextLink({
  href,
  label,
  source,
}: {
  href: string;
  label: string;
  source: string;
}) {
  const className =
    "text-[18px] font-normal leading-8 tracking-[-0.02em] text-[#3c3c43]/60 transition duration-150 ease-out hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black";

  if (isInternalHref(href)) {
    return (
      <Link className={className} href={href}>
        {label}
      </Link>
    );
  }

  return (
    <TrackedExternalLink
      className={className}
      href={href}
      linkText={label}
      source={source}
      target={isMailHref(href) ? undefined : "_blank"}
    >
      {label}
    </TrackedExternalLink>
  );
}

export function LandingFooter() {
  return (
    <footer
      className="flex w-full justify-center bg-white px-6 pt-12"
      id="footer"
    >
      <div className="flex w-full max-w-[560px] flex-col gap-12 lg:max-w-[1560px]">
        <div className="grid w-full grid-cols-1 gap-12 pb-20 lg:grid-cols-12 lg:gap-6 lg:pb-32">
          <div className="lg:col-span-2" data-reveal="scale">
            <Link
              aria-label="Loyal home"
              className="block h-16 w-20 transition duration-150 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
              href="/"
            >
              <Image
                alt=""
                aria-hidden="true"
                height={64}
                priority
                src="/landing/figma/footer-logomark.svg"
                width={80}
              />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-3 lg:col-span-6 lg:col-start-7 lg:gap-6">
            {footerColumns.map((column, index) => (
              <div
                className="flex flex-col items-start"
                data-reveal="lift"
                data-reveal-delay={index + 1}
                key={column.title}
              >
                <h3 className="text-[20px] font-medium leading-[1.1] tracking-[-0.02em] text-black">
                  {column.title}
                </h3>
                <div className="mt-6 flex flex-col items-start">
                  {column.links.map((link) => (
                    <FooterTextLink
                      href={link.href}
                      key={`${column.title}-${link.label}`}
                      label={link.label}
                      source={`landing_footer_${column.title.toLowerCase()}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="flex min-h-24 flex-col gap-8 pt-12 lg:flex-row lg:items-start lg:justify-between"
          data-reveal="fade"
        >
          <div className="flex flex-col gap-4 text-[16px] leading-5 tracking-[-0.02em] text-[#3c3c43]/40 sm:flex-row sm:items-center sm:gap-8">
            <p>© 2026 Loyal. All rights reserved.</p>
            <iframe
              className="h-[30px] w-[250px] border-0 [color-scheme:normal]"
              height="30"
              scrolling="no"
              src="https://status.askloyal.com/badge?theme=light"
              title="Loyal status badge"
              width="250"
            />
          </div>

          <div className="flex items-center gap-3">
            {socialLinks.map((link) => (
              <TrackedExternalLink
                aria-label={link.label}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f5f5f5] transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#ececec] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black active:translate-y-0"
                href={link.href}
                key={link.label}
                linkText={link.label}
                source="landing_footer_social"
                target={isMailHref(link.href) ? undefined : "_blank"}
              >
                <Image
                  alt=""
                  aria-hidden="true"
                  height={20}
                  src={link.icon}
                  width={20}
                />
              </TrackedExternalLink>
            ))}
          </div>
        </div>

        <div className="relative w-full overflow-hidden" data-reveal="lift">
          <Image
            alt="Loyal"
            className="h-auto w-full"
            height={565}
            priority
            src="/landing/figma/footer-wordmark.svg"
            width={1512}
          />
        </div>
      </div>
    </footer>
  );
}
