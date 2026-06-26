"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import {
  MARKETING_PAGES,
  type MarketingPage,
} from "@/features/marketing/registry";

type FeaturesNavItem = { kind: "dropdown"; label: "Features" };
type AnchorNavItem = { kind: "anchor"; label: string; href: string };
type NavItem = FeaturesNavItem | AnchorNavItem;

const navLinks: NavItem[] = [
  { kind: "dropdown", label: "Features" },
  { kind: "anchor", href: "/#developers", label: "Developers" },
  { kind: "anchor", href: "/#roadmap", label: "Roadmap" },
  { kind: "anchor", href: "/blog", label: "Blog" },
  { kind: "anchor", href: "/#footer", label: "Links" },
];

const neutralPupilOffset = 49 - 61.3298;
const randomBlinkDelay = () => 2600 + Math.random() * 5200;
const stickyRevealOffset = 68;

export function LandingHeader() {
  const { loyalAppUrl } = usePublicEnv();
  const [eyeOffset, setEyeOffset] = useState(0);
  const [isIntroEyeOpen, setIsIntroEyeOpen] = useState(false);
  const [isBlinking, setIsBlinking] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isStickyVisible, setIsStickyVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsIntroEyeOpen(true), 1350);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let animationFrame = 0;

    const handlePointerMove = (event: PointerEvent) => {
      cancelAnimationFrame(animationFrame);

      animationFrame = requestAnimationFrame(() => {
        const viewportCenter = window.innerWidth / 2;
        const distanceFromCenter = event.clientX - viewportCenter;
        const normalizedDistance = distanceFromCenter / viewportCenter;
        const clampedDistance = Math.max(-1, Math.min(1, normalizedDistance));

        setEyeOffset(clampedDistance * 14);
      });
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

  useEffect(() => {
    let blinkTimer = 0;
    let openTimer = 0;
    let doubleBlinkTimer = 0;
    let doubleBlinkOpenTimer = 0;

    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        setIsBlinking(true);

        openTimer = window.setTimeout(() => {
          setIsBlinking(false);

          if (Math.random() > 0.82) {
            doubleBlinkTimer = window.setTimeout(() => {
              setIsBlinking(true);

              doubleBlinkOpenTimer = window.setTimeout(() => {
                setIsBlinking(false);
                scheduleBlink();
              }, 95);
            }, 160);

            return;
          }

          scheduleBlink();
        }, 115);
      }, randomBlinkDelay());
    };

    scheduleBlink();

    return () => {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(openTimer);
      window.clearTimeout(doubleBlinkTimer);
      window.clearTimeout(doubleBlinkOpenTimer);
    };
  }, []);

  useEffect(() => {
    const heroSection = document.getElementById("hero");
    if (!heroSection) {
      return;
    }

    const updateStickyVisibility = () => {
      setIsStickyVisible(
        heroSection.getBoundingClientRect().bottom <= stickyRevealOffset
      );
    };

    updateStickyVisibility();
    window.addEventListener("scroll", updateStickyVisibility, {
      passive: true,
    });
    window.addEventListener("resize", updateStickyVisibility);

    return () => {
      window.removeEventListener("scroll", updateStickyVisibility);
      window.removeEventListener("resize", updateStickyVisibility);
    };
  }, []);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [isMenuOpen]);

  return (
    <>
      <header className="relative z-50 flex w-full justify-center bg-[#f9363c]">
        <HeaderContent
          eyeOffset={eyeOffset}
          isEyeOpen={isIntroEyeOpen}
          isMenuOpen={isMenuOpen}
          isBlinking={isBlinking}
          loyalAppUrl={loyalAppUrl}
          maskId="landing-header-eye-mask-static"
          menuId="landing-mobile-menu-static"
          onMenuOpenChange={setIsMenuOpen}
          shouldAnimateIn
        />
      </header>

      <header
        aria-hidden={!isStickyVisible}
        className={`fixed left-0 top-0 z-50 flex w-full justify-center bg-[#f9363c] shadow-[0_12px_36px_rgba(0,0,0,0.08)] transition duration-200 ease-out ${
          isStickyVisible
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-full opacity-0"
        }`}
      >
        <HeaderContent
          eyeOffset={eyeOffset}
          interactive={isStickyVisible}
          isEyeOpen
          isMenuOpen={isMenuOpen}
          isBlinking={isBlinking}
          loyalAppUrl={loyalAppUrl}
          maskId="landing-header-eye-mask-sticky"
          menuId="landing-mobile-menu-sticky"
          onMenuOpenChange={setIsMenuOpen}
        />
      </header>
    </>
  );
}

function HeaderContent({
  eyeOffset,
  interactive = true,
  isEyeOpen,
  isMenuOpen,
  isBlinking,
  loyalAppUrl,
  maskId,
  menuId,
  onMenuOpenChange,
  shouldAnimateIn = false,
}: {
  eyeOffset: number;
  interactive?: boolean;
  isEyeOpen: boolean;
  isMenuOpen: boolean;
  isBlinking: boolean;
  loyalAppUrl: string;
  maskId: string;
  menuId: string;
  onMenuOpenChange: (isOpen: boolean) => void;
  shouldAnimateIn?: boolean;
}) {
  const linkTabIndex = interactive ? undefined : -1;
  const closeMenu = () => onMenuOpenChange(false);

  return (
    <div
      className="relative flex w-full max-w-[1560px] items-end justify-between px-4 py-3 lg:px-6"
      data-header-reveal={shouldAnimateIn ? "" : undefined}
    >
      <div className="flex items-center gap-6">
        <Link
          aria-label="Loyal home"
          className="relative h-11 w-14 shrink-0"
          href="/"
          tabIndex={linkTabIndex}
        >
          <Image
            alt="Loyal"
            className="absolute left-0 top-[11px]"
            height={24}
            priority
            src="/landing/figma/header-logotype.svg"
            width={56}
          />
        </Link>

        <nav
          aria-label="Main navigation"
          className="hidden max-w-[800px] items-end p-1 lg:flex"
        >
          <div className="flex items-center">
            {navLinks.map((link) => {
              if (link.kind === "dropdown") {
                return (
                  <FeaturesDesktopMenu
                    interactive={interactive}
                    key={link.label}
                    pages={MARKETING_PAGES}
                  />
                );
              }
              return (
                <Link
                  className="flex items-center justify-center rounded-full px-4 py-2 text-center text-[16px] font-normal leading-5 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-white hover:text-[#f9363c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
                  href={link.href}
                  key={link.label}
                  tabIndex={linkTabIndex}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      <svg
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 hidden h-11 w-[98px] -translate-x-1/2 -translate-y-1/2 overflow-visible lg:block"
        fill="none"
        height="44"
        viewBox="0 0 98 44"
        width="98"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g
          className="transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            opacity: isEyeOpen ? 1 : 0,
            transform:
              !isEyeOpen || isBlinking ? "scaleY(0.08)" : "scaleY(1)",
            transformOrigin: "49px 44px",
          }}
        >
          <path
            d="M49 0C76.062 0 98 19.6995 98 44H0C0 19.6995 21.938 0 49 0Z"
            fill="white"
          />
          <mask
            height="44"
            id={maskId}
            maskUnits="userSpaceOnUse"
            width="98"
            x="0"
            y="0"
          >
            <path
              d="M49 0C76.062 0 98 19.6995 98 44H0C0 19.6995 21.938 0 49 0Z"
              fill="white"
            />
          </mask>
          <g mask={`url(#${maskId})`}>
            <ellipse
              className="transition-transform duration-150 ease-out"
              cx="61.3298"
              cy="34.7092"
              fill="black"
              rx="24.2225"
              ry="25.0971"
              style={{
                transform: `translateX(${neutralPupilOffset + eyeOffset}px)`,
              }}
            />
          </g>
        </g>
      </svg>

      <div className="hidden lg:block">
        <Link
          className="flex shrink-0 items-center justify-center rounded-full bg-black px-4 py-3 text-center text-[16px] font-normal leading-5 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
          href={loyalAppUrl}
          rel="noopener noreferrer"
          tabIndex={linkTabIndex}
        >
          Open
        </Link>
      </div>

      <div className="flex shrink-0 items-center gap-2 lg:hidden">
        <Link
          className="flex h-11 shrink-0 items-center justify-center rounded-full bg-black px-4 text-center text-[16px] font-normal leading-5 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
          href={loyalAppUrl}
          onClick={closeMenu}
          rel="noopener noreferrer"
          tabIndex={linkTabIndex}
        >
          Open
        </Link>

        <button
          aria-controls={menuId}
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
          onClick={() => onMenuOpenChange(!isMenuOpen)}
          tabIndex={linkTabIndex}
          type="button"
        >
          <span
            className={`absolute h-[2px] w-[21px] rounded-full bg-current transition duration-200 ease-out ${
              isMenuOpen ? "translate-y-0 rotate-45" : "-translate-y-1"
            }`}
          />
          <span
            className={`absolute h-[2px] w-[21px] rounded-full bg-current transition duration-200 ease-out ${
              isMenuOpen ? "translate-y-0 -rotate-45" : "translate-y-1"
            }`}
          />
        </button>
      </div>

      <div
        className={`absolute left-4 right-4 top-[calc(100%+8px)] z-50 overflow-hidden rounded-[24px] bg-black text-white shadow-[0_18px_60px_rgba(0,0,0,0.18)] transition duration-200 ease-out lg:hidden ${
          isMenuOpen && interactive
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0"
        }`}
        id={menuId}
      >
        <nav aria-label="Mobile navigation" className="grid p-2">
          {navLinks.map((link) => {
            if (link.kind === "dropdown") {
              return (
                <FeaturesMobileMenu
                  closeMenu={closeMenu}
                  isMenuOpen={isMenuOpen && interactive}
                  key={link.label}
                  pages={MARKETING_PAGES}
                />
              );
            }
            return (
              <Link
                className="flex items-center justify-between rounded-[18px] px-4 py-3 text-[20px] font-normal leading-6 transition duration-150 ease-out hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                href={link.href}
                key={link.label}
                onClick={closeMenu}
                tabIndex={isMenuOpen && interactive ? undefined : -1}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function FeaturesDesktopMenu({
  interactive,
  pages,
}: {
  interactive: boolean;
  pages: readonly MarketingPage[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const open = () => {
    clearCloseTimer();
    setIsOpen(true);
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setIsOpen(false), 140);
  };

  useEffect(() => () => clearCloseTimer(), []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  const hasPages = pages.length > 0;

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node | null)) {
          scheduleClose();
        }
      }}
      onFocus={open}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      ref={containerRef}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex items-center justify-center rounded-full px-4 py-2 text-center text-[16px] font-normal leading-5 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-white hover:text-[#f9363c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
        tabIndex={interactive ? undefined : -1}
        type="button"
      >
        Features
      </button>
      <div
        className={`absolute left-0 top-full z-50 mt-2 w-[320px] overflow-hidden rounded-3xl bg-white p-2 text-black shadow-[0_18px_60px_rgba(0,0,0,0.18)] transition duration-150 ease-out ${
          isOpen && interactive
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0"
        }`}
        role="menu"
      >
        {hasPages ? (
          pages.map((page) => (
            <Link
              className="flex flex-col gap-1 rounded-[18px] px-4 py-3 transition duration-150 ease-out hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f9363c]"
              href={`/${page.slug}`}
              key={page.slug}
              onClick={() => setIsOpen(false)}
              role="menuitem"
              tabIndex={isOpen && interactive ? undefined : -1}
            >
              <span className="text-[16px] font-medium leading-5">
                {page.title}
              </span>
              {page.description ? (
                <span className="text-[14px] leading-[1.3] text-black/60">
                  {page.description}
                </span>
              ) : null}
            </Link>
          ))
        ) : (
          <p className="px-4 py-3 text-[14px] leading-[1.3] text-black/60">
            No marketing pages yet.
          </p>
        )}
      </div>
    </div>
  );
}

function FeaturesMobileMenu({
  isMenuOpen,
  closeMenu,
  pages,
}: {
  isMenuOpen: boolean;
  closeMenu: () => void;
  pages: readonly MarketingPage[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasPages = pages.length > 0;

  useEffect(() => {
    if (!isMenuOpen) {
      setIsExpanded(false);
    }
  }, [isMenuOpen]);

  return (
    <div>
      <button
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between rounded-[18px] px-4 py-3 text-left text-[20px] font-normal leading-6 text-white transition duration-150 ease-out hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        disabled={!hasPages}
        onClick={() => setIsExpanded((prev) => !prev)}
        tabIndex={isMenuOpen ? undefined : -1}
        type="button"
      >
        <span>Features</span>
        <span
          aria-hidden="true"
          className={`text-[20px] leading-none transition-transform duration-150 ${isExpanded ? "rotate-45" : "rotate-0"}`}
        >
          +
        </span>
      </button>
      {hasPages && isExpanded ? (
        <div className="ml-2 grid gap-1 border-l border-white/20 pl-3">
          {pages.map((page) => (
            <Link
              className="flex flex-col gap-1 rounded-[14px] px-3 py-2 text-[16px] font-normal leading-5 transition duration-150 ease-out hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              href={`/${page.slug}`}
              key={page.slug}
              onClick={closeMenu}
              tabIndex={isMenuOpen ? undefined : -1}
            >
              <span>{page.title}</span>
              {page.description ? (
                <span className="text-[14px] leading-[1.3] text-white/60">
                  {page.description}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
