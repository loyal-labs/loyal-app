"use client";

import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

import type { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-auto", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content className={cn("p-4", className)} {...props} />
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    <button
      className={cn(
        "group absolute right-8 bottom-20 flex size-10 items-center justify-center",
        className
      )}
      onClick={handleScrollToBottom}
      onMouseEnter={(e) => {
        if (!isAtBottom) {
          e.currentTarget.style.transform = "scale(1.05)";
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
          e.currentTarget.style.border = "1px solid rgba(255, 255, 255, 0.25)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isAtBottom) {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
          e.currentTarget.style.border = "1px solid rgba(255, 255, 255, 0.15)";
        }
      }}
      style={{
        background: "rgba(255, 255, 255, 0.08)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        borderRadius: "50%",
        boxShadow:
          "0 8px 32px 0 rgba(0, 0, 0, 0.37), inset 0 1px 1px rgba(255, 255, 255, 0.1)",
        cursor: "pointer",
        transition: "all 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
        transform: isAtBottom ? "scale(0.8)" : "scale(1)",
        opacity: isAtBottom ? 0 : 1,
        visibility: isAtBottom ? "hidden" : "visible",
        pointerEvents: isAtBottom ? "none" : "auto",
        zIndex: 10,
      }}
      type="button"
      {...props}
    >
      <ArrowDownIcon
        className="size-[1.125rem] text-white"
        style={{
          filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3))",
        }}
      />
    </button>
  );
};
