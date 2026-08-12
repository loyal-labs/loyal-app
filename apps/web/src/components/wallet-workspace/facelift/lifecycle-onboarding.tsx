"use client";

import {
  ArrowDownToLine,
  CircleCheck,
  DollarSign,
  type LucideIcon,
  RefreshCw,
  Settings2,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  EarnModal,
  type EarnModalStep,
} from "@/components/wallet-workspace/facelift/earn-modal";
import { usePublicEnv } from "@/contexts/public-env-context";
import {
  FRONTEND_ANALYTICS_EVENTS,
  getFlagVariant,
  trackFrontendAnalyticsEvent,
} from "@/lib/core/analytics";

// ASK-1972 — one-time lifecycle onboarding pop-ups rendered through
// EarnModal (desktop bottom-right card, mobile bottom sheet). Three
// milestones, each shown once per wallet:
//   welcome     — first signed-in visit, explains Earn, CTA to deposit
//   deposit     — a deposit reached its confirmed state, CTA to Autodeposit
//   autodeposit — Autodeposit was created, explains how it behaves
//
// use-earn-actions.ts reports the deposit/autodeposit milestones through
// the `lifecycleOnboarding` emitter (same module-listener pattern as
// earnToast); the host mounted in shell.tsx decides what to show. A
// milestone is stored as "pending" until the user is back on the Earn root
// — pop-ups never cover an in-progress action screen — and flips to "done"
// the moment its modal is shown, so reloads and reconnects never repeat it.

type OnboardingStepId = "welcome" | "deposit" | "autodeposit";

// Funnel order. When several steps are pending at once only the furthest
// one shows; the earlier ones are remembered as completed.
const STEP_ORDER: OnboardingStepId[] = ["welcome", "deposit", "autodeposit"];

type StepStatus = "done" | "pending";
type OnboardingState = Partial<Record<OnboardingStepId, StepStatus>>;

// ponytail: per-wallet localStorage, not backend — a device switch may
// re-show a step once. Move to user settings if that ever matters.
const STORAGE_PREFIX = "loyal:lifecycle-onboarding:";

function readState(walletAddress: string): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + walletAddress);
    return raw ? (JSON.parse(raw) as OnboardingState) : {};
  } catch {
    return {};
  }
}

function writeState(walletAddress: string, state: OnboardingState): void {
  localStorage.setItem(STORAGE_PREFIX + walletAddress, JSON.stringify(state));
}

type LifecycleListener = {
  autodepositCreated: () => void;
  depositConfirmed: () => void;
};

let listener: LifecycleListener | null = null;

export const lifecycleOnboarding = {
  // Call only when a brand-new Autodeposit is confirmed active (not on
  // updates to an existing one).
  autodepositCreated() {
    listener?.autodepositCreated();
  },
  // Call only from the canonical confirmed deposit state — never on
  // submission or optimistic UI.
  depositConfirmed() {
    listener?.depositConfirmed();
  },
};

type StepContent = {
  buttonLabel: string;
  description: string;
  icon: LucideIcon;
  steps: EarnModalStep[];
  title: string;
};

// Mixpanel dynamic-config flags serving each step's copy (ASK-1972 A/B
// plumbing). The variant payload overrides the STEP_CONTENT text below;
// icons and layout stay in code. Copy is editable in Mixpanel without a
// deploy once the flag is enabled; a disabled/missing flag (or no network)
// falls back to STEP_CONTENT with variant "fallback".
const STEP_FLAG_KEYS: Record<OnboardingStepId, string> = {
  autodeposit: "onboarding_popup_autodeposit",
  deposit: "onboarding_popup_deposit",
  welcome: "onboarding_popup_welcome",
};

// The flags SDK resolves its fallback on fetch errors; this bound only
// covers a hung fetch so a popup can't be silently swallowed.
const FLAG_TIMEOUT_MS = 2000;

type StepContentOverride = {
  buttonLabel?: unknown;
  description?: unknown;
  steps?: unknown;
  title?: unknown;
};

function mergeStepContent(base: StepContent, payload: unknown): StepContent {
  if (typeof payload !== "object" || payload === null) {
    return base;
  }
  const override = payload as StepContentOverride;
  const overrideSteps = Array.isArray(override.steps) ? override.steps : [];
  return {
    ...base,
    buttonLabel:
      typeof override.buttonLabel === "string"
        ? override.buttonLabel
        : base.buttonLabel,
    description:
      typeof override.description === "string"
        ? override.description
        : base.description,
    title: typeof override.title === "string" ? override.title : base.title,
    steps: base.steps.map((step, index) => {
      const stepOverride = overrideSteps[index] as
        | { description?: unknown; title?: unknown }
        | undefined;
      return {
        ...step,
        description:
          typeof stepOverride?.description === "string"
            ? stepOverride.description
            : step.description,
        title:
          typeof stepOverride?.title === "string"
            ? stepOverride.title
            : step.title,
      };
    }),
  };
}

const STEP_CONTENT: Record<OnboardingStepId, StepContent> = {
  autodeposit: {
    buttonLabel: "Got it",
    description:
      "Whenever your wallet holds more USDC than your threshold, the extra moves into Earn automatically.",
    icon: Zap,
    steps: [
      {
        description: "USDC up to the amount you set never leaves your wallet.",
        icon: Wallet,
        title: "Your threshold stays put",
      },
      {
        description:
          "Deposits happen for you — check the next run in Autodeposit.",
        icon: RefreshCw,
        title: "Runs on a schedule",
      },
      {
        description: "Review, change, run now, or delete it anytime.",
        icon: Settings2,
        title: "You stay in control",
      },
    ],
    title: "Autodeposit is on",
  },
  deposit: {
    buttonLabel: "Set up Autodeposit",
    description:
      "That's it — yield is accruing. Set up Autodeposit and every new dollar starts earning on its own.",
    icon: CircleCheck,
    steps: [
      {
        description: "USDC above your threshold moves into Earn for you.",
        icon: Zap,
        title: "Fully automatic",
      },
      {
        description: "Set the amount that always stays in your wallet.",
        icon: Wallet,
        title: "You choose what stays",
      },
      {
        description: "Delete it whenever to revoke its permissions.",
        icon: X,
        title: "Cancel anytime",
      },
    ],
    title: "Your deposit is earning",
  },
  welcome: {
    buttonLabel: "Make your first deposit",
    description:
      "Your dollars shouldn't sit still. Deposit USDC into Earn and it starts working right away.",
    icon: Sparkles,
    steps: [
      {
        description: "Move idle dollars into Earn in a couple of clicks.",
        icon: DollarSign,
        title: "Deposit USDC",
      },
      {
        description: "Yield accrues continuously and compounds on its own.",
        icon: TrendingUp,
        title: "Watch it grow",
      },
      {
        description: "No lockups and no waiting periods.",
        icon: ArrowDownToLine,
        title: "Withdraw anytime",
      },
    ],
    title: "Welcome to Loyal",
  },
};

export function LifecycleOnboardingHost({
  hasAutodeposit,
  hasPosition,
  isAtEarnRoot,
  isReady,
  onOpenAutodeposit,
  onOpenDeposit,
  walletAddress,
}: {
  hasAutodeposit: boolean;
  hasPosition: boolean;
  isAtEarnRoot: boolean;
  // Auth session established and the position/overview fetches resolved —
  // milestones are judged against settled data, never mid-hydration.
  isReady: boolean;
  onOpenAutodeposit: () => void;
  onOpenDeposit: () => void;
  walletAddress: string | null;
}) {
  const publicEnv = usePublicEnv();
  const [presented, setPresented] = useState<{
    content: StepContent;
    step: OnboardingStepId;
    variant: string;
  } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  // Bumped whenever a signal writes storage so the presenter effect re-runs.
  const [stateVersion, setStateVersion] = useState(0);

  const walletRef = useRef(walletAddress);
  walletRef.current = walletAddress;
  const hasAutodepositRef = useRef(hasAutodeposit);
  hasAutodepositRef.current = hasAutodeposit;

  useEffect(() => {
    listener = {
      autodepositCreated: () => {
        const wallet = walletRef.current;
        if (!wallet) {
          return;
        }
        const state = readState(wallet);
        if (state.autodeposit === "done") {
          return;
        }
        state.autodeposit = "pending";
        // Enabling Autodeposit completes the post-deposit CTA milestone.
        state.deposit = "done";
        writeState(wallet, state);
        setStateVersion((version) => version + 1);
      },
      depositConfirmed: () => {
        const wallet = walletRef.current;
        // Already running Autodeposit — nothing left to pitch.
        if (!wallet || hasAutodepositRef.current) {
          return;
        }
        const state = readState(wallet);
        if (state.deposit === "done") {
          return;
        }
        state.deposit = "pending";
        writeState(wallet, state);
        setStateVersion((version) => version + 1);
      },
    };
    return () => {
      listener = null;
    };
  }, []);

  // A wallet switch mid-display closes the modal; the new wallet's own
  // state decides what (if anything) shows next.
  useEffect(() => {
    setIsOpen(false);
  }, [walletAddress]);

  // Backfill for established users: an active Autodeposit means every
  // lesson is already learned; an existing position covers the welcome.
  // New signed-in wallets get the welcome armed here.
  useEffect(() => {
    if (!(isReady && walletAddress)) {
      return;
    }
    const state = readState(walletAddress);
    if (hasAutodeposit) {
      // Everything before the autodeposit lesson is learned — but a
      // pending autodeposit step is the just-enabled modal waiting for the
      // Earn root, so only backfill it when it was never reached.
      state.welcome = "done";
      state.deposit = "done";
      if (state.autodeposit === undefined) {
        state.autodeposit = "done";
      }
    } else if (hasPosition && state.welcome !== "done") {
      state.welcome = "done";
    }
    if (state.welcome === undefined) {
      state.welcome = "pending";
    }
    writeState(walletAddress, state);
    setStateVersion((version) => version + 1);
  }, [hasAutodeposit, hasPosition, isReady, walletAddress]);

  // Presenter: on the Earn root with nothing open, show the furthest
  // pending step, remember it (and everything before it) as done. The
  // Mixpanel flag variant is resolved first so the modal renders its copy
  // in one pass; storage only flips to "done" once the popup really shows.
  useEffect(() => {
    if (!(isReady && walletAddress && isAtEarnRoot) || isOpen) {
      return;
    }
    const state = readState(walletAddress);
    const step = [...STEP_ORDER]
      .reverse()
      .find((id) => state[id] === "pending");
    if (!step) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const flagVariant = await Promise.race([
        getFlagVariant(publicEnv, STEP_FLAG_KEYS[step], null),
        new Promise<{ key: string; value: unknown }>((resolve) =>
          setTimeout(
            () => resolve({ key: "fallback", value: null }),
            FLAG_TIMEOUT_MS
          )
        ),
      ]);
      if (cancelled) {
        return;
      }
      for (const id of STEP_ORDER) {
        if (state[id] === "pending") {
          state[id] = "done";
        }
        if (id === step) {
          break;
        }
      }
      writeState(walletAddress, state);
      trackFrontendAnalyticsEvent(
        publicEnv,
        FRONTEND_ANALYTICS_EVENTS.onboardingPopupShown,
        { step, variant: flagVariant.key }
      );
      setPresented({
        content: mergeStepContent(STEP_CONTENT[step], flagVariant.value),
        step,
        variant: flagVariant.key,
      });
      setIsOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAtEarnRoot, isOpen, isReady, publicEnv, stateVersion, walletAddress]);

  if (presented === null) {
    return null;
  }
  const { content, step, variant } = presented;
  return (
    <EarnModal
      buttonLabel={content.buttonLabel}
      description={content.description}
      icon={content.icon}
      isOpen={isOpen}
      onAction={() => {
        trackFrontendAnalyticsEvent(
          publicEnv,
          FRONTEND_ANALYTICS_EVENTS.onboardingPopupCtaClicked,
          { step, variant }
        );
        setIsOpen(false);
        if (step === "welcome") {
          onOpenDeposit();
        } else if (step === "deposit") {
          onOpenAutodeposit();
        }
      }}
      onClose={() => {
        trackFrontendAnalyticsEvent(
          publicEnv,
          FRONTEND_ANALYTICS_EVENTS.onboardingPopupDismissed,
          { step, variant }
        );
        setIsOpen(false);
      }}
      steps={content.steps}
      title={content.title}
    />
  );
}
