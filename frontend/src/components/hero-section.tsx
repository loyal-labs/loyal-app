"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ChatInput } from "@/components/chat-input";
import { ChatMessages } from "@/components/chat-messages";
import { HeroNav } from "@/components/hero-nav";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { useWalletDesktopData } from "@/hooks/use-wallet-desktop-data";
import {
  trackAuthSignInPressed,
  trackWalletSidebarTabOpen,
} from "@/lib/core/analytics";
import {
  HeroRightSidebar,
  type RightSidebarTab,
} from "@/components/wallet-sidebar";
import { HeroSidebar } from "@/components/hero-sidebar";
import type { UIMessage } from "ai";

export type TimestampedMessage = UIMessage & { createdAt?: number };

export interface HeroSectionProps {
  isChatMode: boolean;
  onChatModeChange: (value: boolean) => void;
  messages: TimestampedMessage[];
  setMessages: (messages: TimestampedMessage[]) => void;
  status: string;
  messageTimestamps: Record<string, number>;
  pendingText: string;
  onPendingTextChange: (text: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSubmit: (e: React.FormEvent) => void;
  hasUsableInput: boolean;
  isLoading: boolean;
  isSignedIn: boolean;
  isConnected: boolean;
  truncatedAddress: string;
  openSignInRef?: React.MutableRefObject<(() => void) | null>;
  isOnline: boolean;
  onNewChat: () => void;
  onSelectChat: (chatId: string, clientChatId: string | null) => Promise<void>;
  currentChatId: string;
  connectAgentName?: string;
}

export function shouldOpenRightSidebarTab(args: {
  currentTab: RightSidebarTab;
  isOpen: boolean;
  nextTab: RightSidebarTab;
}): boolean {
  return !(args.isOpen && args.currentTab === args.nextTab);
}

export function HeroSection(props: HeroSectionProps) {
  const { disconnect } = useWallet();
  const { logout } = useAuthSession();
  const publicEnv = usePublicEnv();
  const walletDesktopData = useWalletDesktopData();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] =
    useState<RightSidebarTab>("portfolio");
  const [isBalanceHidden, setIsBalanceHidden] = useState(false);
  const [parallaxOffset, setParallaxOffset] = useState(0);
  const [isInputStuckToBottom, setIsInputStuckToBottom] = useState(false);
  const [stickyInputBottomOffset, setStickyInputBottomOffset] = useState(24);
  const [isScrolledToAbout, setIsScrolledToAbout] = useState(false);
  const [isScrolledToRoadmap, setIsScrolledToRoadmap] = useState(false);
  const [isScrolledToBlog, setIsScrolledToBlog] = useState(false);
  const [isScrolledToLinks, setIsScrolledToLinks] = useState(false);
  const [dogCry, setDogCry] = useState(false);
  const [dogNice, setDogNice] = useState(false);
  const [hasVaultAccount, setHasVaultAccount] = useState(false);
  const pendingConnectRef = useRef(false);

  const { registerHandler } = useSignInModal();

  const openSignIn = useCallback(() => {
    setRightSidebarTab(props.isSignedIn ? "portfolio" : "sign-in");
    setIsRightSidebarOpen(true);
  }, [props.isSignedIn]);

  const closeSignIn = useCallback(() => {
    setIsRightSidebarOpen(false);
  }, []);

  const openTrackedSignIn = useCallback(
    (source: "hero_card") => {
      trackAuthSignInPressed(publicEnv, source);
      openSignIn();
    },
    [openSignIn, publicEnv]
  );

  const openRightSidebarFromHero = useCallback(
    (tab: RightSidebarTab) => {
      if (
        !shouldOpenRightSidebarTab({
          currentTab: rightSidebarTab,
          isOpen: isRightSidebarOpen,
          nextTab: tab,
        })
      ) {
        setIsRightSidebarOpen(false);
        return;
      }

      if (tab !== "sign-in") {
        trackWalletSidebarTabOpen(publicEnv, {
          source: "hero_action_card",
          tab,
        });
      }

      setRightSidebarTab(tab);
      setIsRightSidebarOpen(true);
    },
    [isRightSidebarOpen, publicEnv, rightSidebarTab]
  );

  // Register sidebar as the sign-in handler so Header and other consumers route here
  useEffect(() => {
    registerHandler({ open: openSignIn, close: closeSignIn });
    return () => registerHandler(null);
  }, [registerHandler, openSignIn, closeSignIn]);

  // Expose openSignIn to parent via ref
  useEffect(() => {
    if (props.openSignInRef) {
      props.openSignInRef.current = openSignIn;
    }
  }, [openSignIn, props.openSignInRef]);

  // Auto-switch from sign-in tab to portfolio (or connect) when user signs in
  const wasSignedInRef = useRef(props.isSignedIn);
  const [pendingAutoClose, setPendingAutoClose] = useState(false);
  useEffect(() => {
    const justSignedIn = props.isSignedIn && !wasSignedInRef.current;
    wasSignedInRef.current = props.isSignedIn;

    if (justSignedIn && isRightSidebarOpen) {
      if (pendingConnectRef.current) {
        pendingConnectRef.current = false;
        setRightSidebarTab("connect");
      } else {
        setRightSidebarTab("portfolio");
        setPendingAutoClose(true);
      }
    }
  }, [props.isSignedIn, isRightSidebarOpen]);

  // Close sidebar 2s after wallet data finishes loading post-sign-in
  useEffect(() => {
    if (pendingAutoClose && !walletDesktopData.isLoading) {
      const t = setTimeout(() => {
        setIsRightSidebarOpen(false);
        setPendingAutoClose(false);
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [pendingAutoClose, walletDesktopData.isLoading]);

  // Dog shows "nice" face whenever wallet finishes loading
  const wasWalletLoadingRef = useRef(walletDesktopData.isLoading);
  useEffect(() => {
    const justFinished = wasWalletLoadingRef.current && !walletDesktopData.isLoading;
    wasWalletLoadingRef.current = walletDesktopData.isLoading;

    if (justFinished && walletDesktopData.isConnected) {
      setDogNice(true);
      setTimeout(() => setDogNice(false), 3000);
    }
  }, [walletDesktopData.isLoading, walletDesktopData.isConnected]);

  // Auto-focus input when entering chat mode with multiple fallback strategies
  useEffect(() => {
    if (props.isChatMode && props.inputRef.current) {
      const focusInput = () => {
        if (props.inputRef.current && document.activeElement !== props.inputRef.current) {
          props.inputRef.current.focus();
          props.inputRef.current.select(); // Also select any existing text
        }
      };

      // Strategy 1: Immediate focus attempt
      focusInput();

      // Strategy 2: After micro-task
      Promise.resolve().then(focusInput);

      // Strategy 3: After animation frame (for layout)
      requestAnimationFrame(() => {
        focusInput();

        // Strategy 4: After second animation frame (for paint)
        requestAnimationFrame(focusInput);
      });

      // Strategy 5: After transition completes (800ms based on CSS)
      const timeout1 = setTimeout(focusInput, 850);

      // Strategy 6: Multiple attempts with increasing delays
      const timeout2 = setTimeout(focusInput, 100);
      const timeout3 = setTimeout(focusInput, 300);
      const timeout4 = setTimeout(focusInput, 500);
      const timeout5 = setTimeout(focusInput, 1000);

      // Cleanup
      return () => {
        clearTimeout(timeout1);
        clearTimeout(timeout2);
        clearTimeout(timeout3);
        clearTimeout(timeout4);
        clearTimeout(timeout5);
      };
    }
  }, [props.isChatMode, props.inputRef]);

  // Keep focus on textarea when messages change (e.g., after receiving response)
  useEffect(() => {
    if (props.isChatMode && props.messages.length > 0 && props.inputRef.current) {
      // Small delay to ensure UI has updated
      const timeout = setTimeout(() => {
        if (document.activeElement !== props.inputRef.current) {
          props.inputRef.current?.focus();
        }
      }, 100);

      return () => clearTimeout(timeout);
    }
  }, [props.messages, props.isChatMode, props.inputRef]);

  // Detect when user scrolls to About/Roadmap/Blog/Links sections
  useEffect(() => {
    if (props.isChatMode) return; // Don't track scroll in chat mode

    const handlePageScroll = () => {
      const aboutSection = document.getElementById("about-section");
      const roadmapSection = document.getElementById("roadmap-section");
      const blogSection = document.getElementById("blog-section");
      const footerSection = document.getElementById("footer-section");

      // Check if we're at the bottom of the page
      const isAtBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 10;

      // If at bottom, activate links section
      if (isAtBottom && footerSection) {
        setIsScrolledToAbout(false);
        setIsScrolledToRoadmap(false);
        setIsScrolledToBlog(false);
        setIsScrolledToLinks(true);
        return;
      }

      // Calculate which section is closest to the top threshold
      const sections = [
        { id: "about", element: aboutSection, setter: setIsScrolledToAbout },
        {
          id: "roadmap",
          element: roadmapSection,
          setter: setIsScrolledToRoadmap,
        },
        { id: "blog", element: blogSection, setter: setIsScrolledToBlog },
        { id: "links", element: footerSection, setter: setIsScrolledToLinks },
      ];

      let closestSection = null;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const section of sections) {
        if (section.element) {
          const rect = section.element.getBoundingClientRect();
          const isInView = rect.top <= 100 && rect.bottom >= 100;

          if (isInView) {
            // Calculate distance from top of section to threshold
            const distance = Math.abs(rect.top - 100);
            if (distance < closestDistance) {
              closestDistance = distance;
              closestSection = section;
            }
          }
        }
      }

      // Set only the closest section as active
      for (const section of sections) {
        section.setter(section === closestSection);
      }
    };

    window.addEventListener("scroll", handlePageScroll, { passive: true });
    handlePageScroll(); // Check initial state

    return () => {
      window.removeEventListener("scroll", handlePageScroll);
    };
  }, [props.isChatMode]);

  // Parallax effect for landing page input + sticky behavior
  useEffect(() => {
    if (props.isChatMode) {
      setParallaxOffset(0);
      setIsInputStuckToBottom(false);
      setStickyInputBottomOffset(24);
      return;
    }

    const handleParallaxScroll = () => {
      const scrollY = window.scrollY;
      const viewportHeight = window.innerHeight;

      // Move the input at 0.15 of the scroll speed (subtle parallax)
      const offset = scrollY * 0.15;
      setParallaxOffset(offset);

      // Calculate when the input form has completely scrolled above the viewport
      const inputNaturalCenterFromTop = viewportHeight / 2 - 17 - scrollY * 0.85;
      const formHalfHeight = 40; // ~half the rendered form height
      const formBottomFromTop = inputNaturalCenterFromTop + formHalfHeight;

      if (formBottomFromTop < 0) {
        setIsInputStuckToBottom(true);
        setStickyInputBottomOffset(24);
      } else {
        setIsInputStuckToBottom(false);
        setStickyInputBottomOffset(24);
      }
    };

    window.addEventListener("scroll", handleParallaxScroll, { passive: true });
    handleParallaxScroll();

    return () => {
      window.removeEventListener("scroll", handleParallaxScroll);
    };
  }, [props.isChatMode]);

  const handleScrollToAbout = () => {
    const aboutSection = document.getElementById("about-section");
    if (aboutSection) {
      const navHeight = 80; // Height of nav + extra spacing
      const elementPosition = aboutSection.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - navHeight;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });

      // Update URL hash
      window.history.pushState(null, "", "#about");
    }
  };

  const handleScrollToRoadmap = () => {
    const roadmapSection = document.getElementById("roadmap-section");
    if (roadmapSection) {
      const navHeight = 80;
      const elementPosition = roadmapSection.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - navHeight;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });

      // Update URL hash
      window.history.pushState(null, "", "#roadmap");
    }
  };

  const handleScrollToBlog = () => {
    const blogSection = document.getElementById("blog-section");
    if (blogSection) {
      const navHeight = 80;
      const elementPosition = blogSection.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - navHeight;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });

      // Update URL hash
      window.history.pushState(null, "", "#blog");
    }
  };

  const handleScrollToLinks = () => {
    const footerSection = document.getElementById("footer-section");
    if (footerSection) {
      const navHeight = 80;
      const elementPosition = footerSection.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - navHeight;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });

      // Update URL hash
      window.history.pushState(null, "", "#links");
    }
  };

  // Open connect request sidebar when ?connect= param is present
  const connectHandledRef = useRef(false);
  useEffect(() => {
    if (!props.connectAgentName || connectHandledRef.current) return;
    connectHandledRef.current = true;

    if (props.isSignedIn) {
      setRightSidebarTab("connect");
      setIsRightSidebarOpen(true);
    } else {
      pendingConnectRef.current = true;
      setRightSidebarTab("sign-in");
      setIsRightSidebarOpen(true);
    }
  }, [props.connectAgentName, props.isSignedIn]);

  const handleBackToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });

    // Remove hash from URL
    window.history.pushState(null, "", window.location.pathname);
  };

  return (
    <>
      {!props.isChatMode && (
        <HeroNav
          isScrolledToAbout={isScrolledToAbout}
          isScrolledToRoadmap={isScrolledToRoadmap}
          isScrolledToBlog={isScrolledToBlog}
          isScrolledToLinks={isScrolledToLinks}
          onScrollToAbout={handleScrollToAbout}
          onScrollToRoadmap={handleScrollToRoadmap}
          onScrollToBlog={handleScrollToBlog}
          onScrollToLinks={handleScrollToLinks}
          onBackToTop={handleBackToTop}
        />
      )}

      <HeroSidebar
        isChatMode={props.isChatMode}
        isSidebarOpen={isSidebarOpen}
        onSidebarOpenChange={setIsSidebarOpen}
        isConnected={props.isConnected}
        truncatedAddress={props.truncatedAddress}
        onOpenSignIn={openSignIn}
        messages={props.messages}
        onNewChat={props.onNewChat}
        onSelectChat={props.onSelectChat}
        currentChatId={props.currentChatId}
      />

      {/* First section */}
      <div style={{ position: "relative", width: "100%", height: "100vh" }}>
        {/* Light overlay for chat mode */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "#fff",
            opacity: props.isChatMode ? 1 : 0,
            transition: "all 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
            pointerEvents: props.isChatMode ? "auto" : "none",
          }}
        />

        {/* Chat container */}
        <div
          onClick={(e) => {
            if (props.isChatMode && e.target === e.currentTarget) {
              props.inputRef.current?.focus();
            }
          }}
          style={{
            position: "absolute",
            top: "0",
            bottom: "0",
            left: "0",
            right: "0",
            marginLeft: "0",
            display: "flex",
            flexDirection: "column",
            gap: "0",
            padding: "0",
          }}
        >
          {props.isChatMode && (
            <ChatMessages
              messages={props.messages}
              messageTimestamps={props.messageTimestamps}
              status={props.status}
              inputRef={props.inputRef}
            />
          )}

          <ChatInput
            isChatMode={props.isChatMode}
            isInputStuckToBottom={isInputStuckToBottom}
            stickyInputBottomOffset={stickyInputBottomOffset}
            parallaxOffset={parallaxOffset}
            pendingText={props.pendingText}
            onPendingTextChange={props.onPendingTextChange}
            inputRef={props.inputRef}
            onSubmit={props.onSubmit}
            hasUsableInput={props.hasUsableInput}
            isLoading={props.isLoading}
            isSignedIn={props.isSignedIn}
            isOnline={props.isOnline}
            isBalanceHidden={isBalanceHidden}
            onBalanceHiddenChange={setIsBalanceHidden}
            isWalletConnected={walletDesktopData.isConnected}
            isWalletLoading={walletDesktopData.isLoading}
            walletAddress={walletDesktopData.walletAddress}
            walletLabel={walletDesktopData.walletLabel}
            balanceWhole={walletDesktopData.balanceWhole}
            balanceFraction={walletDesktopData.balanceFraction}
            balanceSolLabel={walletDesktopData.balanceSolLabel}
            balanceHistory={walletDesktopData.balanceHistory.map((p) => p.valueUsd)}
            onOpenRightSidebar={openRightSidebarFromHero}
            onOpenSignIn={openTrackedSignIn}
            dogCry={dogCry}
            dogNice={dogNice}
          />

          <HeroRightSidebar
            isOpen={isRightSidebarOpen}
            activeTab={rightSidebarTab}
            onClose={() => setIsRightSidebarOpen(false)}
            onTabChange={setRightSidebarTab}
            isBalanceHidden={isBalanceHidden}
            onBalanceHiddenChange={setIsBalanceHidden}
            walletDesktopData={walletDesktopData}
            showQuickActions={props.isChatMode || isInputStuckToBottom}
            onDisconnect={async () => {
              setRightSidebarTab("sign-in");
              setDogCry(true);
              setTimeout(() => setDogCry(false), 3000);
              await disconnect();
              await logout();
            }}
            connectAgentName={props.connectAgentName}
            onConnectDecline={() => setIsRightSidebarOpen(false)}
            onConnectApprove={() => {
              setHasVaultAccount(true);
              setRightSidebarTab("portfolio");
            }}
            hasVaultAccount={hasVaultAccount}
          />
        </div>
      </div>
    </>
  );
}
