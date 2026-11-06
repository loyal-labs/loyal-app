import type { ReactNode } from "react";

// Small server-safe primitives for the Backyard page.

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-lg border bg-card p-5 md:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHead({
  eyebrow,
  note,
  title,
}: {
  eyebrow: string;
  note?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header className="mb-5 space-y-1">
      <p className="text-sm text-muted-foreground">{eyebrow}</p>
      <h2 className="text-base font-semibold tracking-normal">{title}</h2>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
    </header>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

export function Fact({
  hint,
  label,
  value,
}: {
  hint: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <Label>{label}</Label>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "bad" | "good" | "neutral";
}) {
  const tones = {
    bad: "border-primary/40 bg-primary/10 text-primary",
    good: "border-success/30 bg-success/10 text-success",
    neutral: "border-border bg-muted text-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Public page: never echo raw errors (they can name internal hosts). */
export function Unavailable({ what }: { error?: string; what: string }) {
  return (
    <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
      {what} is unavailable right now. It retries every minute.
    </p>
  );
}

export function Address({
  address,
  kind = "account",
}: {
  address: string;
  kind?: "account" | "tx";
}) {
  return (
    <a
      className="font-mono underline decoration-border underline-offset-2 hover:decoration-foreground"
      href={`https://solscan.io/${kind}/${address}`}
      rel="noreferrer"
      target="_blank"
    >
      {address.slice(0, 4)}…{address.slice(-4)}
    </a>
  );
}

export function Th({
  children,
  right,
}: {
  children: ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`whitespace-nowrap border-b px-3 py-2 text-xs font-medium text-muted-foreground ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  right,
}: {
  children: ReactNode;
  className?: string;
  right?: boolean;
}) {
  return (
    <td
      className={`border-b px-3 py-2.5 align-top text-sm ${
        right ? "text-right font-mono tabular-nums" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 md:-mx-6 md:px-6">
      <table className="w-full min-w-[560px] border-collapse">{children}</table>
    </div>
  );
}
