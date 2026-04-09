"use client";
// light theme v1
import { useChat } from "@ai-sdk/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";

import { BentoGridSection } from "@/components/bento-grid-section";
import { BlogSection } from "@/components/blog-section";
import { Footer } from "@/components/footer";
import { HeroSection, type TimestampedMessage } from "@/components/hero-section";
import { RoadmapSection } from "@/components/roadmap-section";
import { TrackedExternalLink } from "@/components/analytics/tracked-external-link";
import { useAuthSession } from "@/contexts/auth-session-context";
import { useChatMode } from "@/contexts/chat-mode-context";
import { isSkillsEnabled } from "@/flags";
import { useAuthCapability } from "@/lib/auth/capability";
import { useUserChats } from "@/providers/user-chats";

export default function LandingPage() {
  const [currentChatId, setCurrentChatId] = useState(() => crypto.randomUUID());
  const { refreshUserChats, clearUserChats, loadChatMessages } = useUserChats();
  const prevStatusRef = useRef<string>("ready");
  const pendingMessagesRef = useRef<TimestampedMessage[] | null>(null);

  const { messages, sendMessage, status, setMessages } =
    useChat<TimestampedMessage>({
      id: currentChatId,
      transport: new DefaultChatTransport({
        api: "/api/chat",
      }),
    });
  const [messageTimestamps, setMessageTimestamps] = useState<
    Record<string, number>
  >({});
  const [pendingText, setPendingText] = useState("");
  const [isChatModeLocal, setIsChatModeLocal] = useState(false);
  const { setIsChatMode } = useChatMode();

  // Check Skills feature flag
  const skillsEnabled = isSkillsEnabled();

  // Sync local state with context
  useEffect(() => {
    setIsChatMode(isChatModeLocal);
  }, [isChatModeLocal, setIsChatMode]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }
  }, [pendingText]);

  // Use local state for component logic
  const isChatMode = isChatModeLocal;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Wallet hooks
  const { connected: isConnected, connecting: isWalletLoading, publicKey } = useWallet();
  const { isHydrated: isAuthHydrated, isAuthenticated } = useAuthSession();
  const { isSignedIn } = useAuthCapability();

  // Toggle body class for mobile header visibility
  useEffect(() => {
    if (isChatModeLocal && isSignedIn) {
      document.body.classList.add("chat-mode-active");
    } else {
      document.body.classList.remove("chat-mode-active");
    }
    return () => {
      document.body.classList.remove("chat-mode-active");
    };
  }, [isChatModeLocal, isSignedIn]);

  const openSignInRef = useRef<(() => void) | null>(null);
  const openSignIn = useCallback(() => openSignInRef.current?.(), []);
  const solanaAddress = publicKey?.toBase58();

  // Apply pending messages after useChat switches to the new ID.
  // setMessages from useChat targets the CURRENT id, so we must wait for
  // the re-render after setCurrentChatId before calling setMessages.
  useEffect(() => {
    if (pendingMessagesRef.current) {
      const msgs = pendingMessagesRef.current;
      pendingMessagesRef.current = null;
      setMessages(msgs);
    }
  }, [currentChatId, setMessages]);

  // Sync chat history with auth state — use isAuthenticated (session cookie exists)
  // rather than isSignedIn (wallet-only connection won't have a session yet)
  useEffect(() => {
    if (isAuthenticated) {
      void refreshUserChats();
    } else {
      clearUserChats();
    }
  }, [isAuthenticated, refreshUserChats, clearUserChats]);

  // Truncate wallet address for display (e.g., "233Q..7ABE")
  const truncatedAddress = solanaAddress
    ? `${solanaAddress.slice(0, 4)}..${solanaAddress.slice(-4)}`
    : "";
  // Track if we've already prompted auth on first input
  const [hasPromptedAuth, setHasPromptedAuth] = useState(false);

  // Prompt auth on first character typed
  // Wait until wallet loading is complete to avoid false triggers during initialization
  useEffect(() => {
    if (
      !(isWalletLoading || !isAuthHydrated || hasPromptedAuth || isSignedIn) &&
      pendingText.length > 0
    ) {
      setHasPromptedAuth(true);
      openSignIn();
    }
  }, [
    hasPromptedAuth,
    isAuthHydrated,
    isSignedIn,
    isWalletLoading,
    openSignIn,
    pendingText,
  ]);

  const [isOnline, setIsOnline] = useState(true);

  // Enable send when there's text input
  const hasUsableInput = pendingText.trim().length > 0;

  // Track timestamps for messages that arrive without metadata
  useEffect(() => {
    setMessageTimestamps((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const message of messages) {
        if (message.createdAt && next[message.id] !== message.createdAt) {
          next[message.id] = message.createdAt;
          changed = true;
          continue;
        }
        if (!message.createdAt && next[message.id] === undefined) {
          next[message.id] = Date.now();
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [messages]);

  // Check if a chat operation is in progress
  const isLoading = status === "streaming" || status === "submitted";

  // Network status monitoring and recovery
  useEffect(() => {
    const handleOnline = () => {
      console.log("Network connection restored");
      setIsOnline(true);

      // Re-enable and refocus the input after network recovery
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.disabled = false;
          inputRef.current.focus();
          console.log("Input re-enabled after network recovery");
        }
      }, 100);
    };

    const handleOffline = () => {
      console.log("Network connection lost");
      setIsOnline(false);
    };

    // Set initial state
    setIsOnline(navigator.onLine);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Open Phantom modal when wallet disconnects in chat mode
  // Wait until wallet loading is complete to avoid false triggers during initialization
  useEffect(() => {
    if (!isWalletLoading && isAuthHydrated && isChatMode && !isSignedIn) {
      openSignIn();
    }
  }, [isAuthHydrated, isChatMode, isSignedIn, isWalletLoading, openSignIn]);

  // Pre-fill input from URL query parameter (e.g., ?req=hello)
  // Read ?connect= param for agent connection request
  const [connectAgentName, setConnectAgentName] = useState<string | undefined>();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reqParam = params.get("req");
    if (reqParam) {
      setPendingText(reqParam);
    }
    const connectParam = params.get("connect");
    if (connectParam) {
      setConnectAgentName(connectParam);
    }
  }, []);

  // Auto-focus on initial load (but not if there's a hash in URL or req param)
  useEffect(() => {
    // Don't auto-focus if there's a hash - let the hash scroll complete first
    const hasHash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    const hasReqParam = params.get("req");
    // Skip if req param exists - the effect above handles focus
    if (!(hasHash || hasReqParam)) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []); // Run once on mount

  // Handle initial page load with hash in URL
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash) {
      // Wait for DOM to be ready
      const timer = setTimeout(() => {
        const navHeight = 80;
        let sectionId = "";

        switch (hash) {
          case "about":
            sectionId = "about-section";
            break;
          case "roadmap":
            sectionId = "roadmap-section";
            break;
          case "links":
            sectionId = "footer-section";
            break;
        }

        if (sectionId) {
          const section = document.getElementById(sectionId);
          if (section) {
            const elementPosition = section.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.scrollY - navHeight;

            window.scrollTo({
              top: offsetPosition,
              behavior: "smooth",
            });
          }
        }
      }, 100);

      return () => clearTimeout(timer);
    }
  }, []);

  // Refresh sidebar when streaming completes
  useEffect(() => {
    if (prevStatusRef.current === "streaming" && status === "ready") {
      void refreshUserChats();
    }
    prevStatusRef.current = status;
  }, [status, refreshUserChats]);

  const onNewChat = useCallback(() => {
    setCurrentChatId(crypto.randomUUID());
    setIsChatModeLocal(false);
    setPendingText("");
    setMessages([]);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  }, [setMessages]);

  const onSelectChat = useCallback(
    async (chatId: string, clientChatId: string | null) => {
      const dbMessages = await loadChatMessages(chatId);
      const uiMessages: TimestampedMessage[] = dbMessages.map((msg) => ({
        id: msg.clientMessageId ?? msg.id,
        role: msg.role as "user" | "assistant",
        parts: [{ type: "text" as const, text: msg.content }],
        createdAt: new Date(msg.createdAt).getTime(),
      }));

      // Queue messages in a ref — they'll be applied by the useEffect
      // after useChat re-initializes with the new ID.
      pendingMessagesRef.current = uiMessages;
      setCurrentChatId(clientChatId ?? chatId);
      setIsChatModeLocal(true);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    },
    [loadChatMessages]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent submission if a chat operation is in progress
    if (isLoading) {
      return;
    }

    // Check if wallet is connected before sending
    if (!isSignedIn) {
      openSignIn();
      return;
    }

    if (!hasUsableInput) {
      return;
    }

    setIsChatModeLocal(true);

    // Send message to LLM
    const messageText = pendingText.trim();
    if (messageText) {
      sendMessage({ text: messageText });
      setPendingText("");
    }

    // Ensure focus
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 50);
  };

  return (
    <main
      className=""
      style={{
        margin: 0,
        minHeight: "100vh",
        width: "100%",
        backgroundColor: "#fff",
        overflow: isChatMode ? "hidden" : "auto",
      }}
    >
      {/* Main content wrapper */}
      <div
        style={{
          position: "relative",
          width: "100%",
          minHeight: "100vh",
          display: isChatMode ? "flex" : "block",
          flexDirection: "column",
        }}
      >
        <HeroSection
          isChatMode={isChatMode}
          onChatModeChange={setIsChatModeLocal}
          messages={messages as TimestampedMessage[]}
          setMessages={setMessages}
          status={status}
          messageTimestamps={messageTimestamps}
          pendingText={pendingText}
          onPendingTextChange={setPendingText}
          inputRef={inputRef}
          onSubmit={handleSubmit}
          hasUsableInput={hasUsableInput}
          isLoading={isLoading}
          isSignedIn={isSignedIn}
          isConnected={isConnected}
          truncatedAddress={truncatedAddress}
          openSignInRef={openSignInRef}
          isOnline={isOnline}
          onNewChat={onNewChat}
          onSelectChat={onSelectChat}
          currentChatId={currentChatId}
          connectAgentName={connectAgentName}
        />
        {/* End of first section */}

        {/* BentoGrid Section - Only show when not in chat mode */}
        {!isChatMode && <BentoGridSection />}

        {/* Roadmap Section - Only show when not in chat mode */}
        {!isChatMode && <RoadmapSection />}

        {/* Blog Section - Only show when not in chat mode */}
        {!isChatMode && <BlogSection />}
        {!isChatMode && <Footer />}
      </div>

      {/* Network offline overlay */}
      {!isOnline && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.8)",
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            animation: "fadeIn 0.3s ease-out",
          }}
        >
          <div
            style={{
              maxWidth: "400px",
              background: "rgba(255, 140, 0, 0.1)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255, 140, 0, 0.3)",
              borderRadius: "20px",
              padding: "2rem",
              boxShadow:
                "0 20px 60px 0 rgba(255, 140, 0, 0.2), " +
                "inset 0 2px 4px rgba(255, 255, 255, 0.1)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "3rem",
                marginBottom: "1rem",
                animation: "pulse 2s ease-in-out infinite",
              }}
            >
              📡
            </div>
            <h3
              style={{
                fontSize: "1.5rem",
                fontWeight: 600,
                color: "#fff",
                marginBottom: "1rem",
              }}
            >
              No Internet Connection
            </h3>
            <p
              style={{
                color: "rgba(255, 255, 255, 0.9)",
                fontSize: "1rem",
                lineHeight: 1.6,
                marginBottom: "1.5rem",
              }}
            >
              Your internet connection has been lost. The input will be
              automatically restored when you&apos;re back online.
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                color: "rgba(255, 255, 255, 0.7)",
                fontSize: "0.875rem",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  background: "rgba(255, 140, 0, 0.8)",
                  borderRadius: "50%",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              />
              Waiting for connection...
            </div>
          </div>
        </div>
      )}

      {/* Modal for testers message */}
      {isModalOpen && (
        <div
          onClick={() => setIsModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            animation: "fadeIn 0.3s ease-out",
          }}
        >
          {/* Backdrop */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              backdropFilter: "blur(10px)",
            }}
          />

          {/* Modal content */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              maxWidth: "600px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              background: "rgba(255, 255, 255, 0.08)",
              backdropFilter: "blur(30px)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: "24px",
              padding: "2.5rem",
              boxShadow:
                "0 20px 60px 0 rgba(0, 0, 0, 0.5), " +
                "inset 0 2px 4px rgba(255, 255, 255, 0.1), " +
                "inset 0 -1px 2px rgba(0, 0, 0, 0.3)",
              animation: "slideInUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            {/* Modal header */}
            <h2
              style={{
                fontSize: "1.75rem",
                fontWeight: 600,
                color: "#fff",
                marginBottom: "1.5rem",
                lineHeight: 1.3,
              }}
            >
              Thank you for joining Loyal open test!
            </h2>

            {/* Modal body */}
            <div
              style={{
                color: "rgba(255, 255, 255, 0.9)",
                fontSize: "1rem",
                lineHeight: 1.7,
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              <p style={{ margin: 0 }}>
                <strong style={{ color: "#fff", fontWeight: 600 }}>
                  What is it:
                </strong>{" "}
                you&apos;re looking at fully private on-chain AI. Every message
                is encrypted and facilitated on-chain with AI itself running in
                confidential VM. Neither Loyal devs nor compute node owners can
                access your data.
              </p>

              <p style={{ margin: 0 }}>
                For this open test, there&apos;s no per-query fee but the wallet
                verification is required.
              </p>

              <p style={{ margin: 0 }}>
                <strong style={{ color: "#ef4444", fontWeight: 600 }}>
                  WARNING:
                </strong>{" "}
                this is an early stage product and some features may be
                incomplete or contain errors.
              </p>

              <p style={{ margin: 0 }}>
                You will help our cause if you report any bugs/drop your
                feedback or ideas in our discord community:{" "}
                <TrackedExternalLink
                  href="https://discord.askloyal.com"
                  linkText="Discord community"
                  source="tester_modal"
                  style={{
                    color: "#60a5fa",
                    textDecoration: "underline",
                  }}
                  target="_blank"
                >
                  https://discord.askloyal.com
                </TrackedExternalLink>
              </p>
            </div>

            {/* Close button */}
            <button
              onClick={() => setIsModalOpen(false)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)";
                e.currentTarget.style.border =
                  "1px solid rgba(255, 255, 255, 0.3)";
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow =
                  "0 6px 24px 0 rgba(0, 0, 0, 0.4), " +
                  "inset 0 1px 2px rgba(255, 255, 255, 0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)";
                e.currentTarget.style.border =
                  "1px solid rgba(255, 255, 255, 0.2)";
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow =
                  "0 4px 20px 0 rgba(0, 0, 0, 0.3), " +
                  "inset 0 1px 2px rgba(255, 255, 255, 0.1)";
              }}
              style={{
                marginTop: "2rem",
                width: "100%",
                padding: "1rem 1.5rem",
                fontSize: "1rem",
                fontWeight: 600,
                color: "#fff",
                background: "rgba(255, 255, 255, 0.15)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: "12px",
                cursor: "pointer",
                transition: "all 0.3s ease",
                boxShadow:
                  "0 4px 20px 0 rgba(0, 0, 0, 0.3), " +
                  "inset 0 1px 2px rgba(255, 255, 255, 0.1)",
              }}
            >
              I understand
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeInDown {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        @keyframes slideInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeInDownSimple {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        @keyframes subtlePulse {
          0%,
          100% {
            transform: translateX(-50%) scale(1);
            box-shadow: 0 2px 10px rgba(255, 68, 68, 0.2);
          }
          50% {
            transform: translateX(-50%) scale(1.03);
            box-shadow: 0 4px 15px rgba(255, 68, 68, 0.35);
          }
        }

        @keyframes tooltipFadeInDown {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }
      `}</style>
    </main>
  );
}
