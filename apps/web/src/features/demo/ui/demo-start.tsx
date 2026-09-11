"use client";

import {
  getStablecoinMintForCluster,
  resolveLoyalClusterForSolanaEnv,
  Stablecoin,
} from "@loyal-labs/actions";
import NumberFlow from "@number-flow/react";
import { usePrivy } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/solana";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnimationItem } from "lottie-web";
import {
  Check,
  CircleArrowUp,
  Copy,
  LoaderCircle,
  Monitor,
  RefreshCw,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
  EarnToastHost,
  earnToast,
} from "@/components/wallet-workspace/facelift/earn-toast";
import { PopDigits } from "@/components/wallet-workspace/facelift/pop-digits";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { usePublicEnv } from "@/contexts/public-env-context";
import { cn } from "@/lib/utils";

import { WithdrawModal } from "./withdraw-modal";

// transitions.dev house ease (globals.css --stagger-ease / --modal-ease).
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const RISE = {
  initial: { opacity: 0, transform: "translateY(12px)", filter: "blur(3px)" },
  animate: { opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" },
  exit: { opacity: 0, transform: "translateY(0px)", filter: "blur(0px)" },
  transition: { duration: 0.5, ease: EASE },
} as const;
const PRESS =
  "transition-transform duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]";

// Cinematic word-by-word title, after pixel-point/animate-text
// "spring-scale-in" but slowed down: each word lands on a heavy, underdamped
// spring (visible overshoot) with a long pause before the next one, so the
// phrase reads one beat at a time.
const WORD_SPRING = {
  type: "spring",
  stiffness: 260,
  damping: 14,
  mass: 1.1,
} as const;
const WORD_STAGGER_S = 0.32;
function Words({
  text,
  className,
  delay = 0,
  inView = false,
  stagger = WORD_STAGGER_S,
}: {
  text: string;
  className?: string;
  delay?: number;
  inView?: boolean;
  stagger?: number;
}) {
  const reduce = useReducedMotion();
  const target = {
    opacity: 1,
    transform: "translateY(0px) scale(1)",
    filter: "blur(0px)",
  };
  const from = {
    opacity: 0,
    transform: "translateY(0.35em) scale(0.55)",
    filter: "blur(10px)",
  };
  return (
    <span aria-label={text} className={className} role="text">
      {text.split(" ").map((word, i) => (
        <motion.span
          animate={inView ? undefined : target}
          aria-hidden
          className="inline-block will-change-transform [&:not(:last-child)]:mr-[0.25em]"
          initial={reduce ? target : from}
          key={`${word}-${i}`}
          transition={{
            ...WORD_SPRING,
            delay: delay + i * stagger,
            // Blur/opacity ride a plain ease so only the transform bounces.
            opacity: { duration: 0.35, ease: EASE, delay: delay + i * stagger },
            filter: { duration: 0.45, ease: EASE, delay: delay + i * stagger },
          }}
          viewport={inView ? { once: true, amount: 0.6 } : undefined}
          whileInView={inView ? target : undefined}
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}
// "MONEY THAT / MOVES" lands word by word; when the connectors start drawing
// ITSELF slams in from the right and shoves MOVES over to make room.
function HeroTitle() {
  const reduce = useReducedMotion();
  const [itself, setItself] = useState(false);
  useEffect(() => {
    if (reduce) {
      setItself(true);
      return;
    }
    const t = setTimeout(() => setItself(true), INTRO.itself * 1000);
    return () => clearTimeout(t);
  }, [reduce]);
  return (
    <h1
      aria-label="Money that moves itself"
      className="font-bold text-[40px] uppercase leading-none md:text-[56px]"
    >
      <span className="block">
        <Words text="Money that" />
      </span>
      <span className="flex justify-center gap-[0.25em]">
        <motion.span
          className="inline-block"
          layout="position"
          transition={{ type: "spring", stiffness: 320, damping: 16, mass: 1 }}
        >
          <Words delay={2 * WORD_STAGGER_S} text="Moves" />
        </motion.span>
        {itself ? (
          <motion.span
            animate={{
              opacity: 1,
              x: 0,
              scale: 1,
              filter: "blur(0px)",
            }}
            aria-hidden
            className="inline-block will-change-transform"
            initial={
              reduce
                ? false
                : { opacity: 0, x: "0.8em", scale: 0.6, filter: "blur(10px)" }
            }
            transition={{
              ...WORD_SPRING,
              opacity: { duration: 0.3, ease: EASE },
              filter: { duration: 0.4, ease: EASE },
            }}
          >
            Itself
          </motion.span>
        ) : null}
      </span>
    </h1>
  );
}
// Seconds until the last word of `text` has started landing.
const wordsDone = (text: string, stagger = WORD_STAGGER_S) =>
  text.split(" ").length * stagger + 0.15;

// Start-page intro, one focus at a time (seconds):
//   0.0  title words land: MONEY THAT / MOVES (3 beats)
//   0.5  cards rise, left to right, contents follow
//   1.9  connectors draw, dots/arrows/pills with them; ITSELF lands and
//        pushes MOVES aside
//   2.6  body copy, then the Continue button (overlaps the last two lines)
const INTRO = {
  cards: 0.5,
  cardStagger: 0.22,
  lines: 1.9,
  itself: 1.9,
  lineDraw: 0.7,
  lineStagger: 0.18,
  copy: 2.6,
} as const;

// pixel-point/animate-text "focus-blur-resolve": one block pulls from heavy
// blur into focus (760ms). Used for the big numbers that answer a question.
// Knob: a real spring so a step change overshoots a touch and settles.
const KNOB_SPRING = {
  type: "spring",
  stiffness: 380,
  damping: 26,
  mass: 0.9,
} as const;

const FOCUS = {
  initial: {
    opacity: 0,
    transform: "translateY(14px) scale(1.01)",
    filter: "blur(14px)",
  },
  animate: {
    opacity: 1,
    transform: "translateY(0px) scale(1)",
    filter: "blur(0px)",
  },
  transition: { duration: 0.76, ease: EASE },
} as const;

// Scripted setup: each step shows its status for STEP_MS, then appends a
// transaction row. Signatures are placeholders until the steps call the real
// smart-account routes.
// ponytail: fake signatures; swap each step for a real prepare/confirm call.
const STEP_MS = 2000;
const SETUP_STEPS = [
  { status: "Creating smart account…", tx: "Sponsored smart account creation" },
  { status: "Funding setup costs…", tx: "Account setup funding" },
  { status: "Authorizing autodeposit…", tx: "Autodeposit authorization" },
  { status: "Creating autodeposit policy…", tx: "Autodeposit policy creation" },
  {
    status: "Setting up recurring autodeposit…",
    tx: "Recurring autodeposit setup",
  },
  {
    status: "Creating Kamino routing policy…",
    tx: "Kamino routing policy creation",
  },
  {
    status: "Creating Kamino routing policy…",
    tx: "Kamino setup policy creation",
  },
  {
    status: "Setting 10 USDC daily wallet exit limit…",
    tx: "10 USDC Daily wallet exit limit creation",
  },
];
const FAKE_SIGNATURE =
  "2wsvQm3k7hZp9xL4nR8tB6yC1dF5gH0jK2mN4pQ6rS8tU1vW3xY5zA7bC9dE1fG3hn2m";

const MIN_FUNDING_USDC = 2;
const BALANCE_POLL_MS = 10_000;

// Balances shown after each loop step: [wallet, smart account, kamino]. The
// wallet starts from the real USDC balance; the rest is scripted.
// ponytail: fixed 2-USDC loop; read real balances once the steps are real.
type Balances = [number, number, number];
const LOOP_STEPS: {
  status: string;
  tx: string;
  route: [string, string];
  connector: 0 | 1 | 2 | 3;
  after: (wallet: number) => Balances;
}[] = [
  {
    status: "Moving 2 USDC to Smart account…",
    tx: "Move 2 USDC",
    route: ["Privy wallet", "Smart account"],
    connector: 0,
    after: (w) => [w - 2, 2, 0],
  },
  {
    status: "Moving 2 USDC to Kamino…",
    tx: "Move 2 USDC",
    route: ["Smart account", "Kamino"],
    connector: 1,
    after: (w) => [w - 2, 0, 2.000001],
  },
  {
    status: "Sending 1 USDC to smart account…",
    tx: "Send 1 USDC",
    route: ["Kamino", "Smart account"],
    connector: 3,
    after: (w) => [w - 2, 1, 1.000002],
  },
  {
    status: "Sending 1 USDC to wallet…",
    tx: "Send 1 USDC",
    route: ["Smart account", "Privy wallet"],
    connector: 2,
    after: (w) => [w - 1, 0, 1.000002],
  },
];

type DemoTx = {
  id: number;
  title: string;
  time: string;
  signature: string;
  route?: [string, string];
};

const now = () =>
  new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

const usdc = (v: number, min = 2) =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: min,
    maximumFractionDigits: 6,
  });

const KAMINO_YIELD = 0.08;
const BALANCE_STOPS = [
  1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 30_000_000,
  50_000_000, 75_000_000, 100_000_000,
];
const SHARE_STOPS = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08];

const usd = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});
const pct = (v: number) => `${Math.round(v * 100)}%`;
const usdShort = (v: number) =>
  v >= 1_000_000_000
    ? `$${v / 1_000_000_000} billion`
    : `$${v / 1_000_000} million`;

export function DemoStart() {
  const [balanceIdx, setBalanceIdx] = useState(3);
  const [shareIdx, setShareIdx] = useState(3);
  const userBalances = BALANCE_STOPS[balanceIdx];
  const yourShare = SHARE_STOPS[shareIdx];
  const usersShare = KAMINO_YIELD - yourShare;
  const youKeep = userBalances * yourShare;

  const { ready, authenticated, user, login, logout } = usePrivy();
  const walletAddress = useDemoWallet();
  const signedIn = ready && authenticated && user !== null;
  const setup = useScriptedSetup();
  const { solanaEnv, solanaRpcEndpoint } = usePublicEnv();
  const usdcMint = useMemo(
    () =>
      getStablecoinMintForCluster(
        resolveLoyalClusterForSolanaEnv(solanaEnv),
        Stablecoin.USDC
      ),
    [solanaEnv]
  );
  const walletUsdc = useUsdcBalance(
    setup.phase === "done" ? walletAddress : null,
    usdcMint,
    solanaRpcEndpoint
  );
  const loop = useScriptedLoop(setup.phase === "done" ? walletUsdc : null);
  const funded = walletUsdc !== null && walletUsdc >= MIN_FUNDING_USDC;
  const txs = [...loop.txs, ...setup.txs];
  const balances: Balances = loop.balances ?? [walletUsdc ?? 0, 0, 0];
  const activeConnector =
    loop.phase === "running" ? LOOP_STEPS[loop.step].connector : null;
  // Destination card per connector: pull -> smart account, deposit -> kamino,
  // withdraw-to-wallet -> wallet, withdraw-from-kamino -> smart account.
  const activeCard =
    activeConnector === null ? null : [1, 2, 0, 1][activeConnector];
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  // Server HTML has the reveal classes but no JS to start them, so the
  // connectors and unstaggered bits flash before hydration. Render the
  // page only once mounted; the reveal then starts from a blank canvas.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Privy portals its modal to <body>, outside this page's .dark root, and
  // globals.css keys the dark Privy overrides on html.dark. Force it here
  // (the demo is always dark) and put the visitor's theme back on leave.
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!had) root.classList.remove("dark");
    };
  }, []);
  // Google sign-in is a full-page redirect back to /demo?privy_oauth_code=…
  // Privy then exchanges the code and flips `authenticated`. Until that
  // resolves the page must not replay the intro behind Privy's dialog.
  const oauthReturning =
    mounted &&
    !authenticated &&
    new URLSearchParams(window.location.search).has("privy_oauth_code");
  const holdIntro = !ready || oauthReturning;

  return (
    <div className="dark flex min-h-screen w-full flex-col items-center bg-[#141218] font-sans text-[#e1e3e6]">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-24 text-center lg:hidden">
        <Monitor className="text-[#e1e3e6]" size={56} strokeWidth={1.5} />
        <h1 className="mt-4 max-w-[360px] font-bold text-[28px] uppercase leading-8">
          Loyal demo is only available on desktop
        </h1>
        <p className="max-w-[280px] text-[#97959a] text-[15px] leading-5">
          If you&apos;re on a computer, try maximizing your browser window.
        </p>
      </div>
      <header className="flex w-full justify-center px-6 max-lg:absolute max-lg:top-0">
        <div className="relative flex h-[68px] w-full max-w-[1200px] items-center justify-between">
          <Image
            alt="Loyal"
            height={24}
            src="/landing/figma/header-logotype.svg"
            width={56}
          />
          {signedIn ? (
            <button
              className={cn(
                "h-11 rounded-full bg-[rgba(249,54,60,0.14)] px-5 font-medium text-[16px] leading-5 transition-colors hover:bg-[rgba(249,54,60,0.22)]",
                PRESS
              )}
              onClick={() => {
                setup.reset();
                loop.reset();
                void logout();
              }}
              type="button"
            >
              Sign out
            </button>
          ) : null}
        </div>
      </header>
      {mounted && !holdIntro ? (
        <div className="hidden w-full flex-col items-center lg:flex">
          {/* Before sign-in the hero + scheme own the first viewport, so the
              second title cannot start on tall monitors while the intro runs. */}
          <div
            className={cn(
              "flex w-full flex-col items-center",
              !signedIn && "min-h-[calc(100dvh-68px)] justify-center pb-16"
            )}
          >
            <AnimatePresence mode="popLayout">
              {signedIn ? null : (
                <motion.section
                  className="flex w-full flex-col items-center gap-8 px-6 pt-6 pb-12 text-center"
                  key="hero"
                  {...RISE}
                >
                  <div className="flex max-w-[540px] flex-col gap-4">
                    <HeroTitle />
                    <motion.div
                      {...RISE}
                      transition={{
                        ...RISE.transition,
                        delay: INTRO.copy,
                      }}
                    >
                      <p className="text-[15px] text-[#97959a] leading-[1.2]">
                        At {usdShort(userBalances)} of user balances this loop
                        pays you about {usd.format(youKeep)} a year. Users earn{" "}
                        {pct(usersShare)}, you keep {pct(yourShare)} of roughly{" "}
                        {pct(KAMINO_YIELD)} Kamino yield.
                        <br />
                        Rates float. The split is set in your contract.
                      </p>
                    </motion.div>
                    <motion.div
                      {...RISE}
                      transition={{
                        ...RISE.transition,
                        delay: INTRO.copy + 0.25,
                      }}
                    >
                      <button
                        className={cn(
                          "mt-4 h-14 rounded-full bg-[#e1e3e6] px-6 font-medium text-[#0f0d13] text-[20px] hover:bg-white disabled:opacity-60",
                          PRESS
                        )}
                        disabled={!ready}
                        onClick={() => login()}
                        type="button"
                      >
                        Continue with email
                      </button>
                    </motion.div>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>

            <section className="flex w-full justify-center px-6 py-4">
              <div className="relative w-full max-w-[1200px] lg:py-[60px]">
                <Connectors active={activeConnector} />
                <div className="grid grid-cols-1 gap-6 lg:h-[240px] lg:grid-cols-3">
                  <SchemeCard
                    active={activeCard === 0}
                    index={0}
                    action={
                      setup.phase === "done" && balances[0] > 0 ? (
                        <button
                          className="flex h-9 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-[14px] transition-colors hover:bg-white/[0.12]"
                          onClick={() => setWithdrawOpen(true)}
                          type="button"
                        >
                          <CircleArrowUp size={18} strokeWidth={1.5} />
                          Withdraw
                        </button>
                      ) : null
                    }
                    caption="User's spendable cash"
                    subtitle={
                      walletAddress ? (
                        <WalletBadge address={walletAddress} />
                      ) : null
                    }
                    title="Privy wallet"
                    value={balances[0]}
                  />
                  <SchemeCard
                    active={activeCard === 1}
                    index={1}
                    caption="Programmable and policy-guarded account"
                    title="Smart account"
                    value={balances[1]}
                  />
                  <SchemeCard
                    active={activeCard === 2}
                    index={2}
                    caption="Vault, where idle cash works"
                    dim={balances[2] === 0}
                    title="Kamino Main Market"
                    value={balances[2]}
                  />
                </div>
              </div>
            </section>
          </div>

          <AnimatePresence initial={false}>
            {signedIn ? (
              <motion.div
                className="flex w-full flex-col items-center"
                key="signed-in"
                {...RISE}
              >
                <section className="flex w-full justify-center px-6 py-4">
                  <ControlPill
                    funded={funded}
                    loop={loop}
                    setup={setup}
                    walletAddress={walletAddress}
                  />
                </section>
                <section className="flex w-full justify-center px-6 py-4">
                  <div className="flex w-full max-w-[1200px] flex-col rounded-[32px] bg-[#1d1b20]">
                    <p className="px-6 py-[18px] font-semibold text-[20px] leading-6">
                      Transactions
                    </p>
                    <AnimatePresence initial={false} mode="popLayout">
                      {txs.length === 0 ? (
                        <motion.div
                          className="flex flex-col items-center gap-4 pt-6 pb-12"
                          key="empty"
                          {...RISE}
                        >
                          <span className="size-11 rounded-full border-2 border-[#636067] border-dashed" />
                          <p className="text-[#97959a] text-[16px] leading-5 tracking-[-0.176px]">
                            Transactions will appear here
                          </p>
                        </motion.div>
                      ) : (
                        <motion.ul
                          className="flex flex-col px-2"
                          key="list"
                          layout
                        >
                          <AnimatePresence initial={false}>
                            {txs.map((tx) => (
                              <motion.li
                                className="flex items-center justify-between px-4 py-2.5"
                                key={tx.id}
                                layout
                                {...RISE}
                              >
                                <div className="flex flex-1 flex-col gap-0.5">
                                  <p className="text-[16px] leading-5">
                                    {tx.title}
                                  </p>
                                  <p className="text-[#97959a] text-[13px] leading-4">
                                    {tx.time}
                                  </p>
                                </div>
                                {tx.route ? (
                                  <p className="flex flex-1 items-center gap-1.5 text-[14px] leading-5">
                                    {tx.route[0]}
                                    <CircleArrowUp
                                      className="rotate-90 text-[#636067]"
                                      size={14}
                                    />
                                    {tx.route[1]}
                                  </p>
                                ) : null}
                                <span className="flex items-center gap-1.5 font-mono text-[#97959a] text-[14px] leading-5">
                                  <a
                                    className="transition-colors hover:text-[#e1e3e6]"
                                    href={`https://orbmarkets.io/tx/${tx.signature}`}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    {tx.signature.slice(0, 4)} …{" "}
                                    {tx.signature.slice(-4)}
                                  </a>
                                  <CopyButton
                                    label="Copy signature"
                                    size={16}
                                    text={tx.signature}
                                  />
                                </span>
                              </motion.li>
                            ))}
                          </AnimatePresence>
                        </motion.ul>
                      )}
                    </AnimatePresence>
                    <p className="mx-auto max-w-[660px] px-6 pt-4 pb-6 text-center text-[#636067] text-[16px] leading-5 tracking-[-0.176px]">
                      Every receipt opens on Orb Markets. The backend accepts
                      only four fixed, pre-approved movements, never an
                      arbitrary transaction, amount, token, venue, or
                      destination.
                    </p>
                  </div>
                </section>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {walletAddress ? (
            <WithdrawModal
              available={walletUsdc ?? 0}
              from={walletAddress}
              mint={usdcMint}
              onOpenChange={setWithdrawOpen}
              onSent={(signature) =>
                setup.addTx({
                  id: Date.now(),
                  title: `Withdraw ${usdc(walletUsdc ?? 0)} USDC`,
                  time: now(),
                  signature,
                  route: ["Privy wallet", "External wallet"],
                })
              }
              open={withdrawOpen}
            />
          ) : null}

          <section className="flex w-full flex-col items-center gap-12 px-6 py-24 lg:px-16">
            <h2 className="max-w-[474px] text-center font-bold text-[40px] uppercase leading-none md:text-[56px]">
              <Words inView text="Make more money" />
            </h2>
            <motion.div
              className="relative w-full max-w-[680px]"
              initial={{ opacity: 0, transform: "translateY(24px)" }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
              viewport={{ once: true, amount: 0.2 }}
              whileInView={{ opacity: 1, transform: "translateY(0px)" }}
            >
              <Image
                alt=""
                className="pointer-events-none absolute top-[-32px] left-[-64px] hidden size-64 md:block"
                height={256}
                src="/demo/dog-back.svg"
                width={256}
              />
              <div className="relative flex h-[250px] flex-col items-center justify-center rounded-[32px] bg-[#1d1b20] p-6">
                <Image
                  alt=""
                  className="absolute top-0 right-0 size-[100px]"
                  height={100}
                  src="/demo/corner.svg"
                  width={100}
                />
                <div className="flex flex-col items-center gap-1 pb-6">
                  <p className="text-[#97959a] text-[20px] leading-6">
                    You keep
                  </p>
                  <div className="flex items-baseline gap-[7px] md:pl-9">
                    <motion.span
                      className="inline-block"
                      initial={FOCUS.initial}
                      transition={{ ...FOCUS.transition, delay: 0.75 }}
                      viewport={{ once: true, amount: 0.6 }}
                      whileInView={FOCUS.animate}
                    >
                      <NumberFlow
                        className="font-semibold text-[40px] leading-[64px] tracking-[-0.616px] md:text-[56px]"
                        format={{
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 0,
                        }}
                        value={youKeep}
                      />
                    </motion.span>
                    <p className="text-[#97959a] text-[20px] leading-6">
                      /year
                    </p>
                  </div>
                </div>
              </div>
              <div className="mx-8 h-[2px] border-[#1d1b20] border-t-2 border-dashed" />
              <div className="relative flex flex-col gap-6 rounded-[32px] bg-[#1d1b20] p-6 md:flex-row">
                <div className="flex flex-1 flex-col">
                  <div className="flex flex-col gap-1 px-2 pb-2">
                    <p className="text-[#97959a] text-[16px] leading-5">
                      User balances
                    </p>
                    <NumberFlow
                      className="font-semibold text-[24px] leading-7 tracking-[-0.264px]"
                      format={{
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 0,
                      }}
                      value={userBalances}
                    />
                  </div>
                  <StepSlider
                    label="User balances"
                    onChange={setBalanceIdx}
                    stops={BALANCE_STOPS.length}
                    value={balanceIdx}
                  />
                </div>
                <div className="flex flex-1 flex-col">
                  <div className="flex gap-2 px-2 pb-2">
                    <div className="flex flex-1 flex-col gap-1">
                      <p className="text-[#97959a] text-[16px] leading-5">
                        Your share
                      </p>
                      <NumberFlow
                        className="font-semibold text-[24px] leading-7 tracking-[-0.264px]"
                        format={{ style: "percent", maximumFractionDigits: 0 }}
                        value={yourShare}
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-1 text-right">
                      <p className="text-[#97959a] text-[16px] leading-5">
                        Users’ share
                      </p>
                      <NumberFlow
                        className="font-semibold text-[24px] leading-7 tracking-[-0.264px]"
                        format={{ style: "percent", maximumFractionDigits: 0 }}
                        value={usersShare}
                      />
                    </div>
                  </div>
                  <StepSlider
                    label="Your share"
                    onChange={setShareIdx}
                    stops={SHARE_STOPS.length}
                    value={shareIdx}
                  />
                  <p className="px-2 pt-2 text-[#97959a] text-[13px] leading-4">
                    Based on roughly {pct(KAMINO_YIELD)} Kamino yield. Rates
                    float. The split is set in your contract
                  </p>
                </div>
              </div>
              <Image
                alt=""
                className="pointer-events-none absolute top-[-32px] left-[-64px] hidden size-64 md:block"
                height={256}
                src="/demo/dog-front.svg"
                width={256}
              />
            </motion.div>
          </section>
        </div>
      ) : null}
      <EarnToastHost />
    </div>
  );
}

// Balance digits pop in on change (transitions.dev number pop-in); the
// active card gets a soft red ring while money moves through it.
function SchemeCard({
  index,
  title,
  subtitle,
  caption,
  dim,
  value,
  action,
  active,
}: {
  index: number;
  title: string;
  subtitle?: React.ReactNode;
  caption: string;
  dim?: boolean;
  value: number;
  action?: React.ReactNode;
  active?: boolean;
}) {
  const [whole, frac] = usdc(value).split(".");
  const reduce = useReducedMotion();
  return (
    <motion.div
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      className="h-full"
      initial={
        reduce
          ? false
          : { opacity: 0, transform: "translateY(28px) scale(0.94)" }
      }
      transition={{
        type: "spring",
        stiffness: 220,
        damping: 22,
        mass: 1,
        delay: INTRO.cards + index * INTRO.cardStagger,
        opacity: {
          duration: 0.35,
          ease: EASE,
          delay: INTRO.cards + index * INTRO.cardStagger,
        },
      }}
    >
      <div
        className={cn(
          "flex h-full min-h-[200px] flex-col justify-between rounded-[32px] bg-[#1d1b20] ring-1 ring-transparent transition-[box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          active &&
            "shadow-[0_0_48px_-8px_rgba(255,80,80,0.45)] ring-[#ff5050]/60"
        )}
      >
        <motion.div
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          className="flex flex-col gap-0.5 p-6"
          initial={
            reduce ? false : { opacity: 0, transform: "translateY(8px)" }
          }
          transition={{
            duration: 0.45,
            ease: EASE,
            delay: INTRO.cards + index * INTRO.cardStagger + 0.25,
          }}
        >
          <div className="flex items-center gap-1 text-[#97959a] text-[16px] leading-5">
            <p>{title}</p>
            <AnimatePresence>{subtitle}</AnimatePresence>
          </div>
          <div className="flex items-center gap-2">
            <Image
              alt="USDC"
              className="size-9 rounded-full"
              height={36}
              src="/demo/usdc.png"
              width={36}
            />
            <p
              className={cn(
                "font-semibold text-[40px] leading-[48px] tracking-[-0.44px] [font-variant-numeric:tabular-nums]",
                dim && "text-[#636067]"
              )}
            >
              <PopDigits
                segments={[
                  { text: whole },
                  { text: `.${frac}`, color: "#636067" },
                ]}
              />
            </p>
          </div>
          <AnimatePresence>
            {action ? (
              <motion.div
                className="pt-3"
                key="action"
                {...RISE}
                transition={{ duration: 0.35, ease: EASE }}
              >
                {action}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
        <motion.p
          animate={{ opacity: 1 }}
          className="p-6 text-[#97959a] text-[16px] leading-5"
          initial={reduce ? false : { opacity: 0 }}
          transition={{
            duration: 0.45,
            ease: EASE,
            delay: INTRO.cards + index * INTRO.cardStagger + 0.4,
          }}
        >
          {caption}
        </motion.p>
      </div>
    </motion.div>
  );
}

function WalletBadge({ address }: { address: string }) {
  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
  return (
    <motion.span className="flex items-center gap-1" {...RISE}>
      <span>·</span>
      <span>{short}</span>
      <CopyButton label="Copy wallet address" size={16} text={address} />
    </motion.span>
  );
}

// Copy icon crossfades to a check for a beat after a click.
function CopyButton({
  text,
  label,
  size,
  className,
}: {
  text: string;
  label: string;
  size: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={label}
      className={cn(
        "relative text-[#97959a] transition-colors hover:text-[#e1e3e6]",
        copied && "text-[#30d158]",
        className
      )}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      style={{ width: size, height: size }}
      type="button"
    >
      <Copy
        className="absolute inset-0 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
        size={size}
        strokeWidth={1.5}
        style={{
          opacity: copied ? 0 : 1,
          transform: copied ? "scale(0.8)" : "scale(1)",
        }}
      />
      <Check
        className="absolute inset-0 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
        size={size}
        strokeWidth={2}
        style={{
          opacity: copied ? 1 : 0,
          transform: copied ? "scale(1)" : "scale(0.8)",
        }}
      />
    </button>
  );
}
// One pill, many states. Contents crossfade+rise; the running label swaps
// text in place (transitions.dev text-states-swap) so the pill never jumps.
function ControlPill({
  setup,
  loop,
  funded,
  walletAddress,
}: {
  setup: ReturnType<typeof useScriptedSetup>;
  loop: ReturnType<typeof useScriptedLoop>;
  funded: boolean;
  walletAddress: string | null;
}) {
  const running = setup.phase === "running" || loop.phase === "running";
  const state =
    setup.phase === "idle"
      ? "setup"
      : running
      ? "running"
      : loop.phase === "done"
      ? "reset"
      : funded
      ? "run"
      : "fund";
  const status =
    setup.phase === "running"
      ? SETUP_STEPS[setup.step].status
      : loop.phase === "running"
      ? LOOP_STEPS[loop.step].status
      : "";
  const isButton = state === "setup" || state === "run" || state === "reset";
  const onClick =
    state === "setup" ? setup.start : state === "run" ? loop.start : loop.reset;
  const Tag = isButton ? motion.button : motion.div;
  return (
    <Tag
      className={cn(
        "relative flex h-[164px] w-full max-w-[620px] flex-col items-center justify-center overflow-hidden rounded-full px-12 transition-[background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
        state === "running" ? "bg-[#1d1b20]" : "bg-[rgba(249,54,60,0.14)]",
        isButton && cn("hover:bg-[rgba(249,54,60,0.22)]", PRESS)
      )}
      layout
      onClick={isButton ? onClick : undefined}
      type={isButton ? "button" : undefined}
    >
      <AnimatePresence mode="popLayout">
        {state === "running" ? (
          <motion.div
            className="flex flex-col items-center gap-4"
            key="running"
            {...RISE}
          >
            <Loader />
            <TextSwap className="text-[16px] leading-5" text={status} />
          </motion.div>
        ) : state === "setup" ? (
          <motion.div
            className="flex flex-col items-center gap-3"
            key="setup"
            {...RISE}
          >
            <span className="font-bold text-[28px] uppercase leading-8">
              <Words stagger={0.16} text="Set up account" />
            </span>
            <motion.span
              className="text-[#97959a] text-[16px] leading-5"
              {...RISE}
              transition={{
                ...RISE.transition,
                delay: wordsDone("Set up account", 0.16),
              }}
            >
              Privy asks for each approval. Loyal pays every fee
            </motion.span>
          </motion.div>
        ) : state === "run" ? (
          <motion.div
            className="flex flex-col items-center gap-3"
            key="run"
            {...RISE}
          >
            <span className="font-bold text-[28px] uppercase leading-8">
              <Words stagger={0.16} text="Run the loop" />
            </span>
            <motion.span
              className="text-[#97959a] text-[16px] leading-5"
              {...RISE}
              transition={{
                ...RISE.transition,
                delay: wordsDone("Run the loop", 0.16),
              }}
            >
              Pull 2 USDC, deposit to Kamino, withdraw 1 USDC back
            </motion.span>
          </motion.div>
        ) : state === "reset" ? (
          <motion.div
            className="flex items-center gap-3 font-bold text-[28px] uppercase leading-8"
            key="reset"
            {...RISE}
          >
            <RefreshCw size={28} strokeWidth={2} />
            <Words stagger={0.16} text="Reset demo" />
          </motion.div>
        ) : (
          <motion.div
            className="flex flex-col items-center gap-3"
            key="fund"
            {...RISE}
          >
            <span className="flex items-center gap-2 font-bold text-[28px] leading-8">
              {walletAddress ? (
                <CopyButton
                  label="Copy wallet address"
                  size={24}
                  text={walletAddress}
                />
              ) : null}
              {walletAddress
                ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
                : "…"}
            </span>
            <span className="flex items-center gap-1.5 text-[#97959a] text-[16px] leading-5">
              <LoaderCircle className="animate-spin" size={14} />
              Fund Privy wallet with at least 2 USDC
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </Tag>
  );
}

function useScriptedSetup() {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [step, setStep] = useState(0);
  const [txs, setTxs] = useState<DemoTx[]>([]);

  useEffect(() => {
    if (phase !== "running") return;
    const id = setTimeout(() => {
      setTxs((prev) => [
        {
          id: Date.now(),
          title: SETUP_STEPS[step].tx,
          time: now(),
          signature: FAKE_SIGNATURE,
        },
        ...prev,
      ]);
      if (step + 1 < SETUP_STEPS.length) setStep(step + 1);
      else {
        setPhase("done");
        earnToast.success("Account is set up");
      }
    }, STEP_MS);
    return () => clearTimeout(id);
  }, [phase, step]);

  return {
    phase,
    step,
    txs,
    addTx: (tx: DemoTx) => setTxs((prev) => [tx, ...prev]),
    start: () => {
      setTxs([]);
      setStep(0);
      setPhase("running");
    },
    reset: () => {
      setTxs([]);
      setStep(0);
      setPhase("idle");
    },
  };
}

function useScriptedLoop(walletUsdc: number | null) {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [step, setStep] = useState(0);
  const [txs, setTxs] = useState<DemoTx[]>([]);
  const [balances, setBalances] = useState<Balances | null>(null);
  const startWallet = useRef(0);

  useEffect(() => {
    if (phase !== "running") return;
    const id = setTimeout(() => {
      const s = LOOP_STEPS[step];
      setTxs((prev) => [
        {
          id: Date.now(),
          title: s.tx,
          time: now(),
          signature: FAKE_SIGNATURE,
          route: s.route,
        },
        ...prev,
      ]);
      setBalances(s.after(startWallet.current));
      if (step + 1 < LOOP_STEPS.length) setStep(step + 1);
      else {
        setPhase("done");
        earnToast.success("Money moved itself!");
      }
    }, STEP_MS);
    return () => clearTimeout(id);
  }, [phase, step]);

  return {
    phase,
    step,
    txs,
    balances,
    start: () => {
      startWallet.current = walletUsdc ?? 0;
      setTxs([]);
      setStep(0);
      setBalances(null);
      setPhase("running");
    },
    reset: () => {
      setTxs([]);
      setStep(0);
      setBalances(null);
      setPhase("idle");
    },
  };
}

// Real USDC balance of the Privy wallet, polled while an address is given.
function useUsdcBalance(
  address: string | null,
  mint: PublicKey,
  rpcEndpoint: string
): number | null {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!address) {
      setBalance(null);
      return;
    }
    const connection = new Connection(rpcEndpoint, "confirmed");
    const owner = new PublicKey(address);
    let cancelled = false;
    const read = async () => {
      try {
        const { value } = await connection.getParsedTokenAccountsByOwner(
          owner,
          { mint }
        );
        const total = value.reduce(
          (sum, a) =>
            sum + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0),
          0
        );
        if (!cancelled) setBalance(total);
      } catch {
        // keep last value; next poll retries
      }
    };
    void read();
    const id = setInterval(read, BALANCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address, mint, rpcEndpoint]);
  return balance;
}

function Loader() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let anim: AnimationItem | null = null;
    let cancelled = false;
    void import("lottie-web/build/player/lottie_light").then((mod) => {
      if (cancelled) return;
      anim = (mod.default ?? mod).loadAnimation({
        autoplay: true,
        container: el,
        loop: true,
        path: "/demo/loader.json",
        renderer: "svg",
      });
    });
    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, []);
  return <div className="size-8" ref={ref} />;
}

// Privy's Solana wallet for the signed-in user. createOnLogin should make
// one, but that also depends on the dashboard setting, so create on demand.
function useDemoWallet(): string | null {
  const { ready, authenticated, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const creating = useRef(false);
  const wallet = user?.linkedAccounts.find(
    (a) => a.type === "wallet" && a.chainType === "solana"
  );
  const address = wallet && "address" in wallet ? wallet.address : null;
  useEffect(() => {
    if (!ready || !authenticated || address || creating.current) return;
    creating.current = true;
    void createWallet()
      .catch(() => undefined)
      .finally(() => {
        creating.current = false;
      });
  }, [address, authenticated, createWallet, ready]);
  return address;
}

// Arrows between the three cards. Drawn over the card grid; hidden below lg
// where the cards stack. The Figma design uses a 24px column gap and 60px
// connector rows; `vectorEffect` keeps the strokes 2px while the arcs
// stretch with the layout.
// Connector index: 0 pull, 1 deposit, 2 withdraw to wallet, 3 withdraw from Kamino.
// Card centers x = 192, 600, 1008; cards span y 60..300. Source dots and
// arrowheads on the middle card are offset ±8px so they don't overlap.
// Paths run source -> arrowhead so stroke-draw and the travelling dot both
// follow the money.
const CONNECTORS: {
  d: string;
  dot: [number, number];
  arrow: string;
  pill: string;
  label: string;
}[] = [
  {
    d: "M192 60 V45 Q192 21 216 21 H568 Q592 21 592 45 V60",
    dot: [192, 61],
    arrow: "M585 52 L592 59 L599 52",
    pill: "top-[2px] left-[calc(33.333%-12px)]",
    label: "Pull 2 USDC · recurring",
  },
  {
    d: "M608 60 V45 Q608 21 632 21 H984 Q1008 21 1008 45 V60",
    dot: [608, 61],
    arrow: "M1001 52 L1008 59 L1015 52",
    pill: "top-[2px] left-[calc(66.666%-12px)]",
    label: "Deposit · 2 USDC",
  },
  {
    d: "M592 300 V315 Q592 339 568 339 H216 Q192 339 192 315 V300",
    dot: [592, 299],
    arrow: "M185 308 L192 301 L199 308",
    pill: "bottom-[2px] left-[calc(33.333%-12px)]",
    label: "Withdraw · 1 USDC",
  },
  {
    d: "M1008 300 V315 Q1008 339 984 339 H632 Q608 339 608 315 V300",
    dot: [1008, 299],
    arrow: "M601 308 L608 301 L615 308",
    pill: "bottom-[2px] left-[calc(66.666%-12px)]",
    label: "Withdraw · 1 USDC",
  },
];
// Each line draws from its dot, the arrowhead pops when the line arrives,
// and the pill drops on mid-draw. Timing comes from INTRO.
const LINE_DRAW_S = INTRO.lineDraw;
const lineStart = (i: number) => INTRO.lines + i * INTRO.lineStagger;

function Connectors({ active }: { active: number | null }) {
  const reduce = useReducedMotion();
  return (
    <div className="pointer-events-none absolute inset-0 hidden lg:block">
      <svg
        aria-hidden
        className="absolute inset-0 size-full text-[#4b4950]"
        fill="none"
        preserveAspectRatio="none"
        viewBox="0 0 1200 360"
      >
        {CONNECTORS.map((c, i) => {
          const isActive = active === i;
          const t0 = lineStart(i);
          return (
            <g key={c.d}>
              {/* base line, drawn in once */}
              <motion.path
                animate={{ pathLength: 1, opacity: 1 }}
                d={c.d}
                initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                stroke="currentColor"
                strokeWidth="2"
                transition={{
                  pathLength: { duration: LINE_DRAW_S, ease: EASE, delay: t0 },
                  opacity: { duration: 0.1, delay: t0 },
                }}
                vectorEffect="non-scaling-stroke"
              />
              {/* red overlay while money moves along it */}
              <motion.path
                animate={{ opacity: isActive ? 1 : 0 }}
                d={c.d}
                initial={false}
                stroke="#ff5050"
                strokeWidth="2"
                transition={{ duration: 0.3, ease: EASE }}
                vectorEffect="non-scaling-stroke"
              />
              <motion.circle
                animate={{ scale: 1, opacity: 1 }}
                cx={c.dot[0]}
                cy={c.dot[1]}
                fill={isActive ? "#ff5050" : "currentColor"}
                initial={reduce ? false : { scale: 0, opacity: 0 }}
                r="5"
                style={{ originX: `${c.dot[0]}px`, originY: `${c.dot[1]}px` }}
                transition={{
                  type: "spring",
                  stiffness: 500,
                  damping: 20,
                  delay: t0,
                }}
              />
              {isActive && !reduce ? (
                <circle className="demo-flow-dot" fill="#ff5050" r="6">
                  <animateMotion
                    dur="1.4s"
                    path={c.d}
                    repeatCount="indefinite"
                    calcMode="spline"
                    keySplines="0.45 0 0.55 1"
                    keyTimes="0;1"
                  />
                </circle>
              ) : null}
              <motion.path
                animate={{ pathLength: 1, opacity: 1 }}
                d={c.arrow}
                initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                stroke={isActive ? "#ff5050" : "currentColor"}
                strokeLinecap="round"
                strokeWidth="2"
                transition={{
                  pathLength: {
                    duration: 0.25,
                    ease: EASE,
                    delay: t0 + LINE_DRAW_S - 0.05,
                  },
                  opacity: { duration: 0.05, delay: t0 + LINE_DRAW_S - 0.05 },
                }}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </svg>
      {CONNECTORS.map((c, i) => (
        <Pill
          active={active === i}
          className={c.pill}
          delay={lineStart(i) + LINE_DRAW_S * 0.5}
          key={c.pill}
        >
          {c.label}
        </Pill>
      ))}
    </div>
  );
}

function Pill({
  children,
  className,
  active,
  delay,
}: {
  children: string;
  className: string;
  active: boolean;
  delay: number;
}) {
  const reduce = useReducedMotion();
  // Delay only the mount drop-in; later active toggles must react at once.
  const initialDelay = useRef(delay);
  useEffect(() => {
    const id = setTimeout(() => {
      initialDelay.current = 0;
    }, (delay + 0.6) * 1000);
    return () => clearTimeout(id);
  }, [delay]);
  return (
    <motion.span
      animate={{
        opacity: 1,
        transform: active
          ? "translateX(-50%) translateY(0px) scale(1.06)"
          : "translateX(-50%) translateY(0px) scale(1)",
      }}
      initial={
        reduce
          ? false
          : {
              opacity: 0,
              transform: "translateX(-50%) translateY(-10px) scale(0.9)",
            }
      }
      className={cn(
        "absolute flex items-center whitespace-nowrap rounded-full px-5 py-2.5 text-[16px] leading-5 tracking-[-0.176px] transition-colors duration-300",
        active ? "bg-[#ff5050] text-white" : "bg-[#333036]",
        className
      )}
      transition={{
        type: "spring",
        duration: 0.45,
        bounce: 0.3,
        delay: initialDelay.current,
      }}
    >
      <AnimatePresence initial={false}>
        {active ? (
          <motion.span
            animate={{ opacity: 1, width: 16, marginRight: 8 }}
            className="flex overflow-hidden"
            exit={{ opacity: 0, width: 0, marginRight: 0 }}
            initial={{ opacity: 0, width: 0, marginRight: 0 }}
            key="spin"
            transition={{ duration: 0.25, ease: EASE }}
          >
            <LoaderCircle className="animate-spin" size={16} />
          </motion.span>
        ) : null}
      </AnimatePresence>
      {children}
    </motion.span>
  );
}

function StepSlider({
  label,
  stops,
  value,
  onChange,
}: {
  label: string;
  stops: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const max = stops - 1;
  const fill = `${(value / max) * 100}%`;
  const [dragging, setDragging] = useState(false);
  return (
    <div className="p-2">
      <div className="relative h-6 rounded-full bg-white/[0.04]">
        <motion.div
          animate={{ width: `calc(${fill} + (100% - ${fill}) * 0.1)` }}
          className="absolute inset-y-0 left-0 rounded-full bg-[#ff5050]"
          initial={false}
          transition={KNOB_SPRING}
        />
        <div className="absolute inset-0 flex items-center justify-between px-2">
          {Array.from({ length: stops }, (_, i) => (
            <span
              className={cn(
                "size-2 rounded-full transition-[background-color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                i === value
                  ? "bg-[#636067]"
                  : i < value
                  ? "bg-white/60 scale-50"
                  : "bg-[#636067] scale-50"
              )}
              key={i}
            />
          ))}
        </div>
        <motion.div
          animate={{
            left: `calc(14px + (100% - 28px) * ${value / max})`,
            transform: `translate(-50%, -50%) scale(${dragging ? 1.15 : 1})`,
          }}
          className="pointer-events-none absolute top-1/2 size-7 rounded-full border border-white/[0.12] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
          initial={false}
          transition={KNOB_SPRING}
        />
        <input
          aria-label={label}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
          max={max}
          min={0}
          onBlur={() => setDragging(false)}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          step={1}
          type="range"
          value={value}
        />
      </div>
    </div>
  );
}
