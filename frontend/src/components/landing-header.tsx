"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#developers", label: "Developers" },
  { href: "#roadmap", label: "Roadmap" },
  { href: "#blog", label: "Blog" },
  { href: "#footer", label: "Links" },
];

const neutralPupilOffset = 49 - 61.3298;
const randomBlinkDelay = () => 2600 + Math.random() * 5200;

export function LandingHeader() {
  const [eyeOffset, setEyeOffset] = useState(0);
  const [isBlinking, setIsBlinking] = useState(false);
  const [isStickyVisible, setIsStickyVisible] = useState(false);

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
      setIsStickyVisible(heroSection.getBoundingClientRect().bottom <= 0);
    };

    const observer = new IntersectionObserver(([entry]) => {
      setIsStickyVisible(
        !entry.isIntersecting && entry.boundingClientRect.bottom <= 0
      );
    });

    updateStickyVisibility();
    observer.observe(heroSection);
    window.addEventListener("scroll", updateStickyVisibility, {
      passive: true,
    });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", updateStickyVisibility);
    };
  }, []);

  return (
    <>
      <header className="flex w-full justify-center bg-[#f9363c]">
        <HeaderContent
          eyeOffset={eyeOffset}
          isBlinking={isBlinking}
          maskId="landing-header-eye-mask-static"
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
          isBlinking={isBlinking}
          maskId="landing-header-eye-mask-sticky"
        />
      </header>
    </>
  );
}

function HeaderContent({
  eyeOffset,
  interactive = true,
  isBlinking,
  maskId,
}: {
  eyeOffset: number;
  interactive?: boolean;
  isBlinking: boolean;
  maskId: string;
}) {
  const linkTabIndex = interactive ? undefined : -1;

  return (
    <div className="relative flex w-full max-w-[1560px] items-end justify-between px-6 py-3">
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
          className="hidden max-w-[800px] items-end p-1 md:flex"
        >
          <div className="flex items-center">
            {navLinks.map((link) => (
              <Link
                className="flex items-center justify-center rounded-full px-4 py-2 text-center text-[16px] font-normal leading-5 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-white hover:text-[#f9363c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
                href={link.href}
                key={link.label}
                tabIndex={linkTabIndex}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      </div>

      <svg
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 hidden h-11 w-[98px] -translate-x-1/2 -translate-y-1/2 overflow-visible md:block"
        fill="none"
        height="44"
        viewBox="0 0 98 44"
        width="98"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>Loyal eye</title>
        <g
          className="transition-transform duration-100 ease-in-out"
          style={{
            transform: isBlinking ? "scaleY(0.08)" : "scaleY(1)",
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

      <Link
        className="flex shrink-0 items-center justify-center rounded-full bg-black px-4 py-3 text-center text-[16px] font-normal leading-5 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
        href="#get-started"
        tabIndex={linkTabIndex}
      >
        Get started
      </Link>
    </div>
  );
}
