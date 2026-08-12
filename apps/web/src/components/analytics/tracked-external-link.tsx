"use client";

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { trackFrontendLinkClick } from "@/lib/core/analytics";

type TrackedExternalLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> & {
  children: ReactNode;
  href: string;
  linkText?: string;
  source: string;
};

export function TrackedExternalLink({
  children,
  href,
  linkText,
  onClick,
  rel,
  source,
  target,
  ...props
}: TrackedExternalLinkProps) {
  const publicEnv = usePublicEnv();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    trackFrontendLinkClick(publicEnv, {
      href,
      linkText,
      source,
    });
    onClick?.(event);
  };

  return (
    <a
      {...props}
      href={href}
      onClick={handleClick}
      rel={rel ?? (target === "_blank" ? "noopener noreferrer" : undefined)}
      target={target}
    >
      {children}
    </a>
  );
}
