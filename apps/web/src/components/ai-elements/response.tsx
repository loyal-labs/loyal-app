"use client";

import "katex/dist/katex.min.css";

import type { HTMLAttributes, ReactNode } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

import { TrackedExternalLink } from "@/components/analytics/tracked-external-link";
import { cn } from "@/lib/utils";

export type ResponseProps = HTMLAttributes<HTMLDivElement> & {
  children: string;
  parseIncompleteMarkdown?: boolean;
  isAnimating?: boolean;
};

type ComponentProps = {
  children?: ReactNode;
  className?: string;
  href?: string;
  [key: string]: unknown;
};

// Markdown components matching Figma design system
const customComponents = {
  // Headings - Geist SemiBold
  h1: ({ children, ...props }: ComponentProps) => (
    <h1
      style={{
        fontSize: "24px",
        fontWeight: 600,
        lineHeight: "32px",
        color: "#fff",
        margin: "0",
        padding: "8px 0",
      }}
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: ComponentProps) => (
    <h2
      style={{
        fontSize: "20px",
        fontWeight: 600,
        lineHeight: "28px",
        color: "#fff",
        margin: "0",
        padding: "16px 0 0 0",
      }}
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: ComponentProps) => (
    <h3
      style={{
        fontSize: "18px",
        fontWeight: 600,
        lineHeight: "28px",
        color: "#fff",
        margin: "0",
        padding: "16px 0 0 0",
      }}
      {...props}
    >
      {children}
    </h3>
  ),
  h4: ({ children, ...props }: ComponentProps) => (
    <h4
      style={{
        fontSize: "16px",
        fontWeight: 600,
        lineHeight: "28px",
        color: "#fff",
        margin: "0",
        padding: "16px 0 0 0",
      }}
      {...props}
    >
      {children}
    </h4>
  ),
  h5: ({ children, ...props }: ComponentProps) => (
    <h5
      style={{
        fontSize: "16px",
        fontWeight: 600,
        lineHeight: "28px",
        color: "#fff",
        margin: "0",
        padding: "16px 0 0 0",
      }}
      {...props}
    >
      {children}
    </h5>
  ),
  h6: ({ children, ...props }: ComponentProps) => (
    <h6
      style={{
        fontSize: "16px",
        fontWeight: 600,
        lineHeight: "28px",
        color: "#fff",
        margin: "0",
        padding: "16px 0 0 0",
      }}
      {...props}
    >
      {children}
    </h6>
  ),

  // Paragraph - Geist Regular
  p: ({ children, ...props }: ComponentProps) => (
    <p
      style={{
        fontSize: "16px",
        fontWeight: 400,
        lineHeight: "28px",
        color: "#fff",
        margin: "0",
        padding: "8px 0",
      }}
      {...props}
    >
      {children}
    </p>
  ),

  // Lists - Geist Regular with 24px indentation per level
  ul: ({ children, ...props }: ComponentProps) => (
    <ul
      style={{
        fontSize: "16px",
        fontWeight: 400,
        lineHeight: "28px",
        color: "#fff",
        margin: "0",
        padding: "0",
        paddingLeft: "24px",
        listStyleType: "disc",
      }}
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: ComponentProps) => (
    <ol
      style={{
        fontSize: "16px",
        fontWeight: 400,
        lineHeight: "28px",
        color: "#fff",
        margin: "0",
        padding: "0",
        paddingLeft: "24px",
        listStyleType: "decimal",
      }}
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }: ComponentProps) => (
    <li
      style={{
        fontSize: "16px",
        fontWeight: 400,
        lineHeight: "28px",
        color: "#fff",
        margin: "0",
        padding: "0",
      }}
      {...props}
    >
      {children}
    </li>
  ),

  // Inline elements
  strong: ({ children, ...props }: ComponentProps) => (
    <strong
      style={{
        fontWeight: 600,
        color: "#fff",
      }}
      {...props}
    >
      {children}
    </strong>
  ),
  a: ({ children, href, ...props }: ComponentProps) => (
    <TrackedExternalLink
      href={href ?? "#"}
      linkText={typeof children === "string" ? children : href}
      source="chat_response"
      style={{
        color: "rgba(147, 197, 253, 1)",
        textDecoration: "underline",
        transition: "opacity 0.2s ease",
      }}
      target="_blank"
      {...props}
    >
      {children}
    </TrackedExternalLink>
  ),

  // Divider
  hr: ({ ...props }: ComponentProps) => (
    <hr
      style={{
        border: "none",
        height: "1px",
        background: "rgba(255, 255, 255, 0.1)",
        margin: "28px 0",
      }}
      {...props}
    />
  ),

  // Blockquote
  blockquote: ({ children, ...props }: ComponentProps) => (
    <blockquote
      style={{
        borderLeft: "2px solid rgba(255, 255, 255, 0.2)",
        paddingLeft: "16px",
        margin: "8px 0",
        color: "rgba(255, 255, 255, 0.8)",
        fontStyle: "italic",
      }}
      {...props}
    >
      {children}
    </blockquote>
  ),

  // Table - matching Figma design (14px, 20px line-height, 36px row height)
  table: ({ children, ...props }: ComponentProps) => (
    <div style={{ overflowX: "auto", margin: "8px 0" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "'Geist', sans-serif",
          fontSize: "14px",
          lineHeight: "20px",
          background: "transparent",
        }}
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: ComponentProps) => (
    <thead
      style={{
        background: "transparent",
      }}
      {...props}
    >
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }: ComponentProps) => (
    <tbody style={{ background: "transparent" }} {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }: ComponentProps) => (
    <tr
      style={{
        borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
        height: "36px",
        background: "transparent",
      }}
      {...props}
    >
      {children}
    </tr>
  ),
  th: ({ children, ...props }: ComponentProps) => (
    <th
      style={{
        padding: "8px 8px 8px 0",
        textAlign: "left",
        fontFamily: "'Geist', sans-serif",
        fontWeight: 500,
        fontSize: "14px",
        lineHeight: "20px",
        color: "#fff",
        background: "transparent",
        verticalAlign: "middle",
      }}
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: ComponentProps) => (
    <td
      style={{
        padding: "8px 8px 8px 0",
        fontFamily: "'Geist', sans-serif",
        fontWeight: 400,
        fontSize: "14px",
        lineHeight: "20px",
        color: "#fff",
        background: "transparent",
        verticalAlign: "middle",
      }}
      {...props}
    >
      {children}
    </td>
  ),

  // Code blocks - Geist Mono with dark background
  pre: ({ children, ...props }: ComponentProps) => (
    <pre
      style={{
        background: "rgba(0, 0, 0, 0.4)",
        borderRadius: "16px",
        margin: "8px 0",
        padding: "0",
        overflow: "hidden",
      }}
      {...props}
    >
      {children}
    </pre>
  ),
  code: ({ children, className, ...props }: ComponentProps) => {
    // Check if it's an inline code or block code
    const isInline = !className;
    if (isInline) {
      return (
        <code
          style={{
            fontFamily: "'Geist Mono', monospace",
            fontSize: "14px",
            background: "rgba(255, 255, 255, 0.1)",
            padding: "2px 6px",
            borderRadius: "4px",
            color: "#fff",
          }}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className={className}
        style={{
          fontFamily: "'Geist Mono', monospace",
          fontSize: "14px",
          lineHeight: "22px",
          display: "block",
          padding: "16px",
          color: "#fff",
        }}
        {...props}
      >
        {children}
      </code>
    );
  },
};

export const Response = memo(
  ({
    className,
    children,
    parseIncompleteMarkdown: shouldParseIncompleteMarkdown = true,
    isAnimating = false,
    ...props
  }: ResponseProps) => (
    <div
      className={cn(
        "size-full [&>*:first-child]:pt-0 [&>*:last-child]:pb-0",
        className
      )}
      style={{
        fontFamily: "var(--font-geist-sans), 'Geist', sans-serif",
      }}
      {...props}
    >
      <Streamdown
        components={customComponents as Record<string, unknown>}
        controls={{ code: true, table: true, mermaid: true }}
        isAnimating={isAnimating}
        parseIncompleteMarkdown={shouldParseIncompleteMarkdown}
        shikiTheme={["github-dark", "github-dark"]}
      >
        {children}
      </Streamdown>
    </div>
  )
);

Response.displayName = "Response";
