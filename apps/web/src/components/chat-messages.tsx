"use client";

import { ArrowDownIcon, MoreHorizontal, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { CopyIcon, type CopyIconHandle } from "@/components/ui/copy";
import type { TimestampedMessage } from "@/components/hero-section";

export interface ChatMessagesProps {
  messages: TimestampedMessage[];
  messageTimestamps: Record<string, number>;
  status: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function ChatMessages(props: ChatMessagesProps) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const copyIconRefs = useRef<Map<string, CopyIconHandle>>(new Map());

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      // Use a longer delay to ensure markdown rendering is complete
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
        setShowScrollButton(false);
      }, 100);
    }
  }, [props.messages, props.status]);

  // Scroll detection for showing/hiding scroll button
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    let scrollTimeout: NodeJS.Timeout;

    const handleScroll = () => {
      // Clear existing timeout
      clearTimeout(scrollTimeout);

      // Add a small delay to debounce scroll events for smoother animation
      scrollTimeout = setTimeout(() => {
        const { scrollTop, scrollHeight, clientHeight } = container;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
        setShowScrollButton(!isNearBottom && props.messages.length > 0);
      }, 50);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // Check initial state

    return () => {
      container.removeEventListener("scroll", handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [props.messages.length]);

  const handleCopyMessage = async (messageId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);

      // Trigger animation on the specific copy icon
      const iconHandle = copyIconRefs.current.get(messageId);
      iconHandle?.startAnimation();

      // Reset copied state after 2 seconds
      setTimeout(() => {
        setCopiedMessageId(null);
        iconHandle?.stopAnimation();
      }, 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const handleScrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
    setShowScrollButton(false);
  };

  return (
    <>
      <div
        className="chat-messages-container"
        onClick={(e) => {
          // Only focus input if no text is selected
          const selection = window.getSelection();
          if (!selection || selection.toString().length === 0) {
            // Focus input when clicking on the message area
            props.inputRef.current?.focus();
          }
        }}
        ref={messagesContainerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          gap: "1rem",
          padding: "60px 32px 128px",
          animation: "fadeIn 0.5s ease-in",
          position: "relative",
          maxWidth: "768px",
          margin: "0 auto",
          width: "100%",
          maskImage:
            "linear-gradient(to bottom, transparent 0%, black 60px, black calc(100% - 68px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, black 60px, black calc(100% - 68px), transparent 100%)",
        }}
      >
        {props.messages.map((message, messageIndex) => {
          const messageText = message.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");

          const resolvedTimestamp =
            message.createdAt ?? props.messageTimestamps[message.id];
          const messageTime = resolvedTimestamp
            ? new Date(resolvedTimestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : null;

          return (
            <div
              key={message.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems:
                  message.role === "user" ? "flex-end" : "flex-start",
                gap: "0.5rem",
                animation: "slideInUp 0.3s ease-out",
                animationFillMode: "both",
              }}
            >
              {/* Message content */}
              {message.role === "user" ? (
                <div
                  style={{
                    position: "relative",
                    padding: "8px 16px",
                    borderRadius: "20px 20px 4px 20px",
                    background: "#F2F2F2",
                    color: "#000",
                    fontSize: "16px",
                    lineHeight: "24px",
                    maxWidth: "464px",
                    fontFamily: "var(--font-geist-sans), sans-serif",
                  }}
                >
                  {message.parts.map((part, index) =>
                    part.type === "text" ? (
                      <span key={index}>{part.text}</span>
                    ) : null
                  )}
                </div>
              ) : (
                <div
                  style={{
                    width: "100%",
                    color: "#000",
                    fontSize: "16px",
                    lineHeight: "28px",
                    fontFamily: "var(--font-geist-sans), sans-serif",
                  }}
                >
                  <MarkdownRenderer content={messageText} />
                </div>
              )}

              {/* Message Footer Actions */}
              {message.role === "user" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    height: "40px",
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {/* Copy button */}
                    <button
                      className="message-action-btn"
                      onClick={() =>
                        handleCopyMessage(message.id, messageText)
                      }
                      style={{
                        color:
                          copiedMessageId === message.id
                            ? "#22c55e"
                            : "#3C3C43",
                      }}
                      title={
                        copiedMessageId === message.id
                          ? "Copied!"
                          : "Copy message"
                      }
                    >
                      <CopyIcon
                        ref={(el) => {
                          if (el) {
                            copyIconRefs.current.set(message.id, el);
                          }
                        }}
                        size={20}
                      />
                    </button>

                    {/* More button */}
                    <button
                      className="message-action-btn"
                      title="More options"
                    >
                      <MoreHorizontal size={20} />
                    </button>
                  </div>
                </div>
              )}

              {/* Assistant Message Footer Actions - only show on completed messages */}
              {message.role === "assistant" &&
                !(
                  messageIndex === props.messages.length - 1 &&
                  (props.status === "streaming" || props.status === "submitted")
                ) && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-start",
                      height: "40px",
                      width: "100%",
                      gap: "8px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      {/* Copy button */}
                      <button
                        className="message-action-btn"
                        onClick={() =>
                          handleCopyMessage(message.id, messageText)
                        }
                        style={{
                          color:
                            copiedMessageId === message.id
                              ? "#22c55e"
                              : "#3C3C43",
                        }}
                        title={
                          copiedMessageId === message.id
                            ? "Copied!"
                            : "Copy message"
                        }
                      >
                        <CopyIcon
                          ref={(el) => {
                            if (el) {
                              copyIconRefs.current.set(message.id, el);
                            }
                          }}
                          size={20}
                        />
                      </button>

                      {/* Refresh/Regenerate button */}
                      <button
                        className="message-action-btn"
                        title="Regenerate response"
                      >
                        <RefreshCw size={20} />
                      </button>

                      {/* More button */}
                      <button
                        className="message-action-btn"
                        title="More options"
                      >
                        <MoreHorizontal size={20} />
                      </button>
                    </div>
                  </div>
                )}
            </div>
          );
        })}

        {/* Thinking indicator */}
        {props.status === "submitted" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              paddingBottom: "8px",
              animation: "slideInUp 0.3s ease-out",
              animationFillMode: "both",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontWeight: 500,
                fontSize: "16px",
                lineHeight: "28px",
                backgroundImage:
                  "linear-gradient(90deg, rgba(0, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0.8) 50%, rgba(0, 0, 0, 0.3) 100%)",
                backgroundSize: "200% 100%",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                animation: "thinkingShimmer 2s ease-in-out infinite",
              }}
            >
              Thinking
            </span>
          </div>
        )}

        <div ref={messagesEndRef} style={{ height: "1rem" }} />
      </div>

      {/* Scroll to bottom button - positioned above input */}
      <button
        aria-label="Scroll to bottom"
        className="scroll-to-bottom-button"
        onClick={handleScrollToBottom}
        onMouseEnter={(e) => {
          if (showScrollButton) {
            e.currentTarget.style.transform = "scale(1.05)";
            e.currentTarget.style.background = "rgba(0, 0, 0, 0.08)";
          }
        }}
        onMouseLeave={(e) => {
          if (showScrollButton) {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.background = "rgba(0, 0, 0, 0.04)";
          }
        }}
        style={{
          position: "absolute",
          bottom: "7rem",
          right: "2rem",
          width: "32px",
          height: "32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0, 0, 0, 0.04)",
          border: "none",
          borderRadius: "50%",
          cursor: "pointer",
          transition: "all 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
          transform: showScrollButton ? "scale(1)" : "scale(0.8)",
          opacity: showScrollButton ? 1 : 0,
          visibility: showScrollButton ? "visible" : "hidden",
          pointerEvents: showScrollButton ? "auto" : "none",
          zIndex: 10,
        }}
        type="button"
      >
        <ArrowDownIcon
          style={{
            width: "20px",
            height: "20px",
            color: "#3C3C43",
          }}
        />
      </button>

      <style jsx>{`
        .message-action-btn {
          padding: 6px;
          background: transparent;
          border: none;
          border-radius: 9999px;
          cursor: pointer;
          color: #3C3C43;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .message-action-btn:hover {
          background: rgba(0, 0, 0, 0.04);
        }

        /* Custom scrollbar for chat messages */
        .chat-messages-container::-webkit-scrollbar {
          width: 8px;
        }

        .chat-messages-container::-webkit-scrollbar-track {
          background: transparent;
          border-radius: 10px;
          margin: 10px 0;
        }

        .chat-messages-container::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.15);
          border-radius: 10px;
        }

        .chat-messages-container::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.25);
        }

        /* Firefox custom scrollbar */
        .chat-messages-container {
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 0, 0, 0.15) transparent;
        }

        @keyframes thinkingShimmer {
          0% {
            background-position: 100% 50%;
          }
          100% {
            background-position: -100% 50%;
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

        /* Mobile styles for chat */
        @media (max-width: 767px) {
          .chat-messages-container {
            padding-left: 56px !important;
          }
        }
      `}</style>
    </>
  );
}
