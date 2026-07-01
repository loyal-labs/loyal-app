"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { usePublicEnv } from "@/contexts/public-env-context";

// White spreads from the clicked button to cover the screen.
const COVER_MS = 420;
// Manual-fallback fade (browsers without View Transitions).
const REVEAL_MS = 360;
// The clicked button lingers on top of the white, then fades out.
const BUTTON_FADE_MS = 320;
// Poll cadence for app readiness.
const POLL_MS = 80;
// Minimum logo-splash hold, so the white+logo is always perceptible even when
// the app is ready instantly (e.g. signed-out / warm cache).
const MIN_HOLD_MS = 600;
// Hard ceiling: reveal even if the app never settles, so we never trap the user.
const SAFETY_REVEAL_MS = 3000;

// Progress ring around the logo. We can't read a real %, so it eases toward 90%
// while loading, then snaps to 100% the instant the app is content-ready.
const RING_SIZE = 300;
const RING_STROKE = 14;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_CENTER = RING_SIZE / 2;
const RING_TARGET = 0.9;
const RING_EASE_MS = 2000;
// Time to let the ring snap to 100% (and show it) before the reveal fires.
const RING_COMPLETE_MS = 340;
const RING_EASE = "cubic-bezier(0.2, 0.6, 0.2, 1)";

type Phase = "idle" | "covering" | "holding" | "revealing";

type ViewTransition = {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition: () => void;
};

type DocumentWithViewTransition = Document & {
  startViewTransition?: (
    callback: () => Promise<void> | void
  ) => ViewTransition;
};

// The white hold lasts until the workspace has painted real content instead of
// its loading skeleton. We key off the rendered result (skeleton / auth-pending
// markers gone) rather than the route commit, because `/app` commits a skeleton
// synchronously and only fills in wallet/auth data afterwards.
const APP_ROOT_SELECTOR = ".wallet-workspace";
const APP_LOADING_SELECTOR =
  ".wallet-workspace-auth-pending, [class*='wallet-workspace-loading'], [class*='wallet-workspace-skeleton']";

function isAppContentReady() {
  return (
    document.querySelector(APP_ROOT_SELECTOR) !== null &&
    document.querySelector(APP_LOADING_SELECTOR) === null
  );
}

/**
 * Landing -> app transition. Lives in the root layout so it survives the
 * (same-origin) client navigation.
 *
 * Choreography (the point is to reveal a *loaded* app via the View Transitions
 * API, never the skeleton):
 *   1. Click — a white circle spreads from the button to cover the page; the
 *      clicked button fades out.
 *   2. Navigate to `/app` *behind* the white and hold (logo splash, with a
 *      progress ring filling around the logo) until the workspace has painted
 *      real content (not its skeleton).
 *   3. Reveal — `document.startViewTransition()` removes the white, so VT
 *      captures old = white + logo / new = the loaded app; the CSS in
 *      globals.css fades the white off and flies the logo at the viewer. Because
 *      the app is already loaded when the snapshot is taken, there's no skeleton.
 *
 * Browsers without View Transitions (Firefox) fall back to fading the white away
 * to reveal the same loaded app. `/app` is prefetched on mount so the hold is
 * short. CTAs keep their canonical `app.askloyal.com` href (right-click /
 * new-tab / no-JS still work); left-clicks are upgraded to a same-origin nav.
 */
export function AppTransitionBridge() {
  const { loyalAppUrl } = usePublicEnv();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [expanded, setExpanded] = useState(false);
  const [buttonOut, setButtonOut] = useState(false);
  const [progress, setProgress] = useState(0);
  const [button, setButton] = useState<{
    html: string;
    top: number;
    left: number;
  } | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const radius = useRef(0);
  const nextPath = useRef("/app");

  const resolveAppTarget = useCallback(() => {
    try {
      return new URL(loyalAppUrl, window.location.origin);
    } catch {
      return null;
    }
  }, [loyalAppUrl]);

  const clearOverlay = useCallback(() => {
    setPhase("idle");
    setExpanded(false);
    setButton(null);
    setButtonOut(false);
    setProgress(0);
  }, []);

  // Reveal the already-loaded app: View Transition circle-reveal, or a manual
  // fade where VT is unavailable.
  const revealApp = useCallback(() => {
    const doc = document as DocumentWithViewTransition;
    if (typeof doc.startViewTransition !== "function") {
      setPhase("revealing");
      return;
    }

    // Removing the white overlay inside the VT callback is the DOM mutation VT
    // animates: old snapshot = white + logo, new snapshot = the loaded app. The
    // CSS in globals.css fades the white off and flies the logo at the viewer.
    doc.startViewTransition(() => {
      flushSync(clearOverlay);
    });
  }, [clearOverlay]);

  // Warm the app route so the client nav is instant.
  useEffect(() => {
    router.prefetch("/app");
  }, [router]);

  useEffect(() => {
    const target = resolveAppTarget();
    if (!target) {
      return;
    }

    const here = window.location;
    // Don't intercept while already inside the app.
    if (
      here.origin === target.origin &&
      here.pathname.startsWith(target.pathname)
    ) {
      return;
    }

    // Map the (possibly cross-origin) app URL onto our same-origin `/app` route.
    const appRoot = target.pathname.replace(/\/$/, "");
    const toLocalPath = (dest: URL) => {
      const rest = dest.pathname.slice(appRoot.length) || "/";
      const base = rest === "/" ? "/app" : `/app${rest}`;
      return base + dest.search + dest.hash;
    };

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor || (anchor.target && anchor.target !== "_self")) {
        return;
      }
      if (anchor.hasAttribute("download")) {
        return;
      }

      let dest: URL;
      try {
        dest = new URL(anchor.href, here.origin);
      } catch {
        return;
      }
      const goesToApp =
        dest.origin === target.origin &&
        dest.pathname.startsWith(target.pathname);
      if (!goesToApp) {
        return;
      }

      // Take over the navigation entirely.
      event.preventDefault();
      event.stopPropagation();

      nextPath.current = toLocalPath(dest);

      if (prefersReducedMotion) {
        router.push(nextPath.current);
        return;
      }

      const x = event.clientX;
      const y = event.clientY;
      origin.current = { x, y };
      radius.current = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );

      // Keep a copy of the clicked button on top of the white so it lingers and
      // fades instead of vanishing the instant the white covers it.
      const rect = anchor.getBoundingClientRect();
      setButton({ html: anchor.outerHTML, left: rect.left, top: rect.top });
      setButtonOut(false);

      setExpanded(false);
      setPhase("covering");
    };

    document.addEventListener("click", onClick, { capture: true });
    return () =>
      document.removeEventListener("click", onClick, { capture: true });
  }, [resolveAppTarget, router]);

  // Spread the white, then navigate once it fully covers the screen.
  useEffect(() => {
    if (phase !== "covering") {
      return;
    }
    const raf = requestAnimationFrame(() => {
      setExpanded(true);
      setButtonOut(true);
    });
    const cover = window.setTimeout(() => {
      setPhase("holding");
      router.push(nextPath.current);
    }, COVER_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(cover);
    };
  }, [phase, router]);

  // Hold the white logo splash until BOTH the minimum hold has elapsed and the
  // app has painted real content, then reveal. The min hold keeps the splash
  // perceptible; the readiness gate avoids revealing a skeleton. The progress
  // ring eases toward 90% meanwhile, then snaps to 100% just before the reveal.
  useEffect(() => {
    if (phase !== "holding") {
      return;
    }

    // Kick the ring off toward 90% (CSS eases it; see the render below).
    setProgress(RING_TARGET);

    let settled = false;
    let minHoldDone = false;
    let contentReady = false;
    let complete = 0;

    const maybeReveal = () => {
      if (settled || !minHoldDone || !contentReady) {
        return;
      }
      settled = true;
      setProgress(1); // snap the ring to 100%
      complete = window.setTimeout(revealApp, RING_COMPLETE_MS);
    };

    const checkReady = () => {
      if (isAppContentReady()) {
        contentReady = true;
        maybeReveal();
        return true;
      }
      return false;
    };

    const minHold = window.setTimeout(() => {
      minHoldDone = true;
      maybeReveal();
    }, MIN_HOLD_MS);

    let poll = 0;
    if (!checkReady()) {
      poll = window.setInterval(() => {
        if (checkReady()) {
          window.clearInterval(poll);
        }
      }, POLL_MS);
    }

    const safety = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      setProgress(1);
      window.clearInterval(poll);
      revealApp();
    }, SAFETY_REVEAL_MS);

    return () => {
      window.clearInterval(poll);
      window.clearTimeout(minHold);
      window.clearTimeout(safety);
      window.clearTimeout(complete);
    };
  }, [phase, revealApp]);

  // Manual fallback only: fade the white away, then unmount.
  useEffect(() => {
    if (phase !== "revealing") {
      return;
    }
    const done = window.setTimeout(clearOverlay, REVEAL_MS);
    return () => window.clearTimeout(done);
  }, [phase, clearOverlay]);

  if (phase === "idle") {
    return null;
  }

  const { x, y } = origin.current;
  const r = expanded ? radius.current : 0;

  return (
    <>
      <div
        aria-hidden="true"
        style={{
          alignItems: "center",
          backgroundColor: "#ffffff",
          clipPath: `circle(${r}px at ${x}px ${y}px)`,
          display: "flex",
          inset: 0,
          justifyContent: "center",
          // Manual-fallback reveal fades the whole cover (logo included). The VT
          // path removes the cover instead and cross-fades the logo via its own
          // view-transition group (see globals.css).
          opacity: phase === "revealing" ? 0 : 1,
          // Sit the logo above dead-center.
          paddingBottom: "16vh",
          pointerEvents: "auto",
          position: "fixed",
          transition: `clip-path ${COVER_MS}ms ease-out, opacity ${REVEAL_MS}ms ease`,
          zIndex: 2_147_483_600,
        }}
      >
        {/* Logo + progress ring share a center. Full opacity so the spreading
            white *uncovers* them (clip is on the parent) rather than fading in
            after full cover. */}
        <div
          style={{
            alignItems: "center",
            display: "flex",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {/* Progress ring: faint track + eased red arc. Clean and flat. */}
          <svg
            aria-hidden="true"
            height={RING_SIZE}
            style={{
              left: "50%",
              pointerEvents: "none",
              position: "absolute",
              top: "50%",
              transform: "translate(-50%, -50%) rotate(-90deg)",
            }}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            width={RING_SIZE}
          >
            <circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              fill="none"
              r={RING_RADIUS}
              stroke="rgba(18, 18, 18, 0.08)"
              strokeWidth={RING_STROKE}
            />
            <circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              fill="none"
              r={RING_RADIUS}
              stroke="#f9363c"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
              strokeWidth={RING_STROKE}
              style={{
                transition: `stroke-dashoffset ${
                  progress >= 1 ? RING_COMPLETE_MS : RING_EASE_MS
                }ms ${RING_EASE}`,
              }}
            />
          </svg>
          <Image
            alt="Loyal"
            className="loyal-splash-logo"
            height={120}
            priority
            src="/logo-web.svg"
            width={150}
          />
        </div>
      </div>
      {button ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted clone of our own clicked CTA, fades out for visual continuity
        <div
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: button.html }}
          style={{
            left: button.left,
            opacity: buttonOut ? 0 : 1,
            pointerEvents: "none",
            position: "fixed",
            top: button.top,
            transition: `opacity ${BUTTON_FADE_MS}ms ease`,
            zIndex: 2_147_483_601,
          }}
        />
      ) : null}
    </>
  );
}
