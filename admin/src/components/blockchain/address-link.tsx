import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const DEFAULT_EDGE_LENGTH = 4;
const explorerLinkClassName =
  "text-foreground underline underline-offset-2 hover:text-foreground/80";

export function formatShortAddress(
  address: string,
  edgeLength = DEFAULT_EDGE_LENGTH
) {
  if (address.length <= edgeLength * 2) {
    return address;
  }

  return `${address.slice(0, edgeLength)}...${address.slice(-edgeLength)}`;
}

export function getOrbAccountUrl(address: string) {
  return `https://orbmarkets.io/address/${address}`;
}

export function getOrbTransactionUrl(signature: string) {
  return `https://orbmarkets.io/tx/${signature}`;
}

type ShortAddressTextProps = ComponentProps<"span"> & {
  address: string;
  edgeLength?: number;
};

export function ShortAddressText({
  address,
  className,
  edgeLength,
  title,
  ...props
}: ShortAddressTextProps) {
  return (
    <span
      className={cn("font-mono [font-variant-ligatures:none]", className)}
      title={title ?? address}
      {...props}
    >
      {formatShortAddress(address, edgeLength)}
    </span>
  );
}

type AddressLinkProps = Omit<ComponentProps<"a">, "href" | "children"> & {
  address: string;
  edgeLength?: number;
};

export function AddressLink({
  address,
  className,
  edgeLength,
  title,
  ...props
}: AddressLinkProps) {
  return (
    <a
      className={cn(
        explorerLinkClassName,
        "font-mono [font-variant-ligatures:none]",
        className
      )}
      href={getOrbAccountUrl(address)}
      rel="noreferrer"
      target="_blank"
      title={title ?? address}
      {...props}
    >
      {formatShortAddress(address, edgeLength)}
    </a>
  );
}

type OrbTransactionLinkProps = Omit<ComponentProps<"a">, "href"> & {
  signature: string;
};

export function OrbTransactionLink({
  children,
  className,
  signature,
  title,
  ...props
}: OrbTransactionLinkProps) {
  return (
    <a
      className={cn(explorerLinkClassName, className)}
      href={getOrbTransactionUrl(signature)}
      rel="noreferrer"
      target="_blank"
      title={title ?? signature}
      {...props}
    >
      {children ?? signature}
    </a>
  );
}
