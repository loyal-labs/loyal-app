import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full items-end justify-end gap-2 py-4",
      from === "user" ? "is-user" : "is-assistant flex-row-reverse justify-end",
      "[&>div]:max-w-[80%]",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex flex-col gap-2 overflow-hidden rounded-lg px-4 py-3 text-sm",
      "group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground",
      // Dark glassmorphic background for assistant messages
      "group-[.is-assistant]:border group-[.is-assistant]:border-white/10 group-[.is-assistant]:backdrop-blur-[10px]",
      className
    )}
    style={{
      background: "rgba(0, 0, 0, 0.3)",
    }}
    {...props}
  >
    <div className="is-user:dark" style={{ color: "rgba(255, 255, 255, 0.9)" }}>
      {children}
    </div>
  </div>
);

export type MessageAvatarProps = ComponentProps<typeof Avatar> & {
  src: string;
  name?: string;
};

export const MessageAvatar = ({
  src,
  name,
  className,
  ...props
}: MessageAvatarProps) => (
  <Avatar
    className={cn("size-8 ring ring-1 ring-border", className)}
    {...props}
  >
    <AvatarImage alt="" className="mt-0 mb-0" src={src} />
    <AvatarFallback>{name?.slice(0, 2) || "ME"}</AvatarFallback>
  </Avatar>
);
