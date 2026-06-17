import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const DEFAULT_EDGE_LENGTH = 4;
const solscanLinkClassName =
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

export function getSolscanAccountUrl(address: string, solanaEnv: string) {
  const params =
    solanaEnv === "mainnet" ? "" : `?cluster=${encodeURIComponent(solanaEnv)}`;

  return `https://solscan.io/account/${address}${params}`;
}

export function getSolscanTransactionUrl(signature: string, solanaEnv: string) {
  const params =
    solanaEnv === "mainnet" ? "" : `?cluster=${encodeURIComponent(solanaEnv)}`;

  return `https://solscan.io/tx/${signature}${params}`;
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
  solanaEnv: string;
};

export function AddressLink({
  address,
  className,
  edgeLength,
  solanaEnv,
  title,
  ...props
}: AddressLinkProps) {
  return (
    <a
      className={cn(
        solscanLinkClassName,
        "font-mono [font-variant-ligatures:none]",
        className
      )}
      href={getSolscanAccountUrl(address, solanaEnv)}
      rel="noreferrer"
      target="_blank"
      title={title ?? address}
      {...props}
    >
      {formatShortAddress(address, edgeLength)}
    </a>
  );
}

type SolscanTransactionLinkProps = Omit<ComponentProps<"a">, "href"> & {
  signature: string;
  solanaEnv: string;
};

export function SolscanTransactionLink({
  children,
  className,
  signature,
  solanaEnv,
  title,
  ...props
}: SolscanTransactionLinkProps) {
  return (
    <a
      className={cn(solscanLinkClassName, className)}
      href={getSolscanTransactionUrl(signature, solanaEnv)}
      rel="noreferrer"
      target="_blank"
      title={title ?? signature}
      {...props}
    >
      {children ?? signature}
    </a>
  );
}
