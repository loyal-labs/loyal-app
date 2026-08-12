"use client";

import { AppRoot } from "@telegram-apps/telegram-ui";
import type { PropsWithChildren } from "react";

export function TelegramAppRootClient({ children }: PropsWithChildren) {
  return <AppRoot suppressHydrationWarning>{children}</AppRoot>;
}
