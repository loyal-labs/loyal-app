"use client";

import { X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef } from "react";

import type { TimestampedMessage } from "@/components/hero-section";
import { MenuIcon, type MenuIconHandle } from "@/components/ui/menu";
import { PlusIcon, type PlusIconHandle } from "@/components/ui/plus";
import { useUserChats } from "@/providers/user-chats";

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export interface HeroSidebarProps {
  isChatMode: boolean;
  isSidebarOpen: boolean;
  onSidebarOpenChange: (open: boolean) => void;
  isConnected: boolean;
  truncatedAddress: string;
  onOpenSignIn: () => void;
  messages: TimestampedMessage[];
  onNewChat: () => void;
  onSelectChat: (chatId: string, clientChatId: string | null) => Promise<void>;
  currentChatId: string;
}

export function HeroSidebar(props: HeroSidebarProps) {
  const { userChats } = useUserChats();
  const menuIconRef = useRef<MenuIconHandle>(null);
  const plusIconRef = useRef<PlusIconHandle>(null);

  // Toggle body class when sidebar opens (for header visibility on mobile)
  useEffect(() => {
    if (props.isSidebarOpen) {
      document.body.classList.add("sidebar-open");
    } else {
      document.body.classList.remove("sidebar-open");
    }
    return () => {
      document.body.classList.remove("sidebar-open");
    };
  }, [props.isSidebarOpen]);

  // Control menu icon animation based on sidebar state
  useEffect(() => {
    if (props.isSidebarOpen) {
      menuIconRef.current?.startAnimation();
    } else {
      menuIconRef.current?.stopAnimation();
    }
  }, [props.isSidebarOpen]);

  return (
    <>
      <style jsx>{`
        .sidebar-icon-btn:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }
      `}</style>

      {/* "loyal" logotype SVG - beside sidebar, covered when sidebar opens */}
      <div
        onClick={() => {
          if (props.isChatMode) {
            props.onNewChat();
          }
        }}
        style={{
          position: "fixed",
          top: "24px",
          left: "68px",
          zIndex: 55,
          opacity: props.isSidebarOpen ? 0 : 1,
          pointerEvents: props.isSidebarOpen ? "none" : "auto",
          transition: "opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          cursor: props.isChatMode ? "pointer" : "default",
        }}
      >
        <Image
          alt="loyal"
          height={20}
          src="/hero-new/Logotype.svg"
          style={{ display: "block" }}
          width={48}
        />
      </div>

      {/* Sidebar Container - Fixed position on left */}
      <div
        style={{
          position: "fixed",
          top: props.isSidebarOpen ? "8px" : "16px",
          left: props.isSidebarOpen ? "8px" : "16px",
          bottom: "8px",
          transition: "top 0.3s cubic-bezier(0.4, 0, 0.2, 1), left 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          zIndex: 60,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "0",
          pointerEvents: "none",
        }}
      >
        {/* Collapsed State - Icon Buttons */}
        <div
          style={{
            position: "absolute",
            top: "0",
            left: "0",
            bottom: "0",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "0",
            opacity: props.isSidebarOpen ? 0 : 1,
            pointerEvents: props.isSidebarOpen ? "none" : "auto",
            transition: "opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          {/* Top buttons group */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {/* Menu Button */}
            <button
              className="sidebar-icon-btn"
              onClick={() => props.onSidebarOpenChange(true)}
              style={{
                width: "36px",
                height: "36px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                background: "rgba(0, 0, 0, 0.04)",
                border: "none",
                borderRadius: "9999px",
                cursor: "pointer",
                transition: "all 0.2s ease",
                color: "#3C3C43",
              }}
              title="Open menu"
            >
              <MenuIcon
                onMouseEnter={() => {}}
                onMouseLeave={() => {}}
                ref={menuIconRef}
                size={24}
              />
            </button>

            {/* New Chat Button */}
            <button
              className="sidebar-icon-btn"
              onClick={() => props.onNewChat()}
              style={{
                width: "36px",
                height: "36px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                background: "rgba(0, 0, 0, 0.04)",
                border: "none",
                borderRadius: "9999px",
                cursor: "pointer",
                transition: "all 0.2s ease",
                color: "#3C3C43",
              }}
              title="New chat"
            >
              <PlusIcon
                onMouseEnter={() => {}}
                onMouseLeave={() => {}}
                ref={plusIconRef}
                size={24}
              />
            </button>
          </div>
        </div>

        {/* Expanded Sidebar Panel */}
        <div
          style={{
            width: "298px",
            height: "100%",
            background: "#F5F5F5",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            transform: props.isSidebarOpen
              ? "translateX(0)"
              : "translateX(-110%)",
            opacity: props.isSidebarOpen ? 1 : 0,
            transition:
              "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            pointerEvents: props.isSidebarOpen ? "auto" : "none",
          }}
        >
          {/* Panel Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px",
            }}
          >
            {/* Close Button */}
            <button
              className="sidebar-icon-btn"
              onClick={() => props.onSidebarOpenChange(false)}
              style={{
                width: "36px",
                height: "36px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                background: "rgba(0, 0, 0, 0.04)",
                border: "none",
                borderRadius: "9999px",
                cursor: "pointer",
                transition: "all 0.2s ease",
                color: "#3C3C43",
              }}
            >
              <X size={24} />
            </button>

            {/* New Chat Button */}
            <button
              className="sidebar-icon-btn"
              onClick={() => props.onNewChat()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "rgba(0, 0, 0, 0.04)",
                border: "none",
                borderRadius: "9999px",
                cursor: "pointer",
                transition: "all 0.2s ease",
                color: "#3C3C43",
                padding: "6px 16px 6px 6px",
              }}
            >
              <PlusIcon
                onMouseEnter={() => {}}
                onMouseLeave={() => {}}
                ref={plusIconRef}
                size={24}
              />
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: "#000",
                }}
              >
                New Chat
              </span>
            </button>
          </div>

          {/* History Section */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              padding: "0 8px",
            }}
          >
            {/* History Header */}
            <div
              style={{
                padding: "12px 12px 8px",
              }}
            >
              <span
                style={{
                  fontSize: "16px",
                  fontWeight: 500,
                  lineHeight: "20px",
                  color: "#000",
                  letterSpacing: "-0.176px",
                }}
              >
                History
              </span>
            </div>

            {/* History List */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                overflowX: "hidden",
              }}
            >
              {userChats.length === 0 && !props.isChatMode ? (
                <div
                  style={{
                    padding: "12px 12px 0",
                    color: "rgba(0, 0, 0, 0.35)",
                    fontSize: "13px",
                    lineHeight: "18px",
                  }}
                >
                  Your chat history will appear here
                </div>
              ) : (
                <>
                  {/* Current new conversation (not yet saved) */}
                  {props.isChatMode &&
                    !userChats.some(
                      (c) => c.clientChatId === props.currentChatId
                    ) && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                          minHeight: "44px",
                          padding: "6px 12px",
                          borderRadius: "12px",
                          cursor: "default",
                          background: "rgba(0, 0, 0, 0.04)",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "14px",
                            fontWeight: 400,
                            lineHeight: "20px",
                            color: "#000",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {props.messages.length > 0 &&
                          props.messages[0]?.role === "user"
                            ? props.messages[0].parts
                                .filter((part) => part.type === "text")
                                .map((part) => part.text)
                                .join("")
                                .slice(0, 40) +
                              (props.messages[0].parts
                                .filter((part) => part.type === "text")
                                .map((part) => part.text)
                                .join("").length > 40
                                ? "..."
                                : "")
                            : "New conversation"}
                        </span>
                        <span
                          style={{
                            fontSize: "12px",
                            lineHeight: "16px",
                            color: "rgba(0, 0, 0, 0.35)",
                          }}
                        >
                          just now
                        </span>
                      </div>
                    )}
                  {userChats.map((chat) => {
                    const isActive =
                      chat.clientChatId === props.currentChatId;
                    return (
                      <div
                        className="sidebar-history-item"
                        key={chat.id}
                        onClick={() =>
                          !isActive &&
                          props.onSelectChat(chat.id, chat.clientChatId)
                        }
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background =
                              "rgba(0, 0, 0, 0.04)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background = "transparent";
                          }
                        }}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                          minHeight: "44px",
                          padding: "6px 12px",
                          borderRadius: "12px",
                          cursor: isActive ? "default" : "pointer",
                          transition: "background 0.2s ease",
                          background: isActive
                            ? "rgba(0, 0, 0, 0.04)"
                            : "transparent",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "14px",
                            fontWeight: 400,
                            lineHeight: "20px",
                            color: "#000",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {chat.title ?? "Untitled"}
                        </span>
                        <span
                          style={{
                            fontSize: "12px",
                            lineHeight: "16px",
                            color: "rgba(0, 0, 0, 0.35)",
                          }}
                        >
                          {formatRelativeTime(chat.lastMessageAt)}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>

          {/* Wallet Container - Bottom (only visible in chat mode when connected) */}
          {props.isChatMode && props.isConnected && (
            <div
              style={{
                padding: "8px",
              }}
            >
              <button
                className="sidebar-icon-btn"
                onClick={() => props.onOpenSignIn()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0, 0, 0, 0.04)",
                  border: "none",
                  borderRadius: "9999px",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  padding: "4px",
                  width: "36px",
                  height: "36px",
                }}
              >
                <img
                  alt="Wallet"
                  height={28}
                  src="/Wallet-Icon.svg"
                  style={{
                    borderRadius: "9999px",
                  }}
                  width={28}
                />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile backdrop overlay */}
      {props.isSidebarOpen && (
        <div
          className="md:hidden"
          onClick={() => props.onSidebarOpenChange(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(4px)",
            zIndex: 39,
            animation: "fadeIn 0.3s ease-out",
          }}
        />
      )}
    </>
  );
}
