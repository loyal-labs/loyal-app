"use client";

import dynamic from "next/dynamic";

const TelegramLayoutClient = dynamic(() => import("./TelegramLayoutClient"), {
  ssr: false,
});

export default function TelegramLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TelegramLayoutClient>{children}</TelegramLayoutClient>;
}
