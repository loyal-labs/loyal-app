import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export const BentoGrid = ({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) => (
  <div
    className={cn(
      "grid grid-cols-1 gap-4 md:grid-cols-3",
      className
    )}
  >
    {children}
  </div>
);

export const BentoGridItem = ({
  className,
  title,
  description,
  header,
  animationDelay = 0,
}: {
  className?: string;
  title?: string | React.ReactNode;
  description?: string | React.ReactNode;
  header?: React.ReactNode;
  icon?: React.ReactNode;
  animationDelay?: number;
}) => (
  <motion.div
    animate={{ opacity: 1, y: 0, scale: 1 }}
    className={cn("group/bento row-span-1", className)}
    exit={{ opacity: 0, y: 20, scale: 0.95 }}
    initial={{ opacity: 0, y: 20, scale: 0.95 }}
    transition={{
      duration: 0.25,
      delay: animationDelay,
      ease: [0.4, 0, 0.2, 1],
    }}
  >
    <div
      className="flex flex-col overflow-hidden"
      style={{
        background: "#F5F5F5",
        borderRadius: "20px",
      }}
    >
      {header}
      <div
        className="flex min-h-0 flex-1 flex-col items-start justify-end gap-2"
        style={{
          padding: "16px 32px 16px 16px",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "20px",
            fontWeight: 500,
            lineHeight: "24px",
            color: "#000",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "16px",
            fontWeight: 400,
            lineHeight: "20px",
            color: "rgba(60, 60, 67, 0.6)",
            maxWidth: "400px",
          }}
        >
          {description}
        </div>
      </div>
    </div>
  </motion.div>
);
