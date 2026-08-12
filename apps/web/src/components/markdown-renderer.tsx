"use client";

import "katex/dist/katex.min.css";

import { Streamdown } from "streamdown";

type MarkdownRendererProps = {
  content: string;
  className?: string;
  isAnimating?: boolean;
};

export function MarkdownRenderer({
  content,
  className,
  isAnimating = false,
}: MarkdownRendererProps) {
  return (
    <Streamdown
      className={className}
      controls={{ code: true, table: true, mermaid: true }}
      isAnimating={isAnimating}
      parseIncompleteMarkdown={true}
      shikiTheme={["github-light", "github-dark"]}
    >
      {content}
    </Streamdown>
  );
}
