"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { isCherryEntryPath } from "../entry";
import {
  resolveCherryEntry,
  type CherryEntryResolution,
} from "./runtime-contract";
import { CherryStatusScreen } from "./status-screen";

const CherryEmbeddedRuntime = dynamic(
  () =>
    import("./runtime-embedded").then((module) => module.CherryEmbeddedRuntime),
  {
    loading: () => <CherryStatusScreen message="Opening Loyal securely…" />,
    ssr: false,
  }
);

type CherryNativeWindow = Window & {
  __cherry?: boolean;
  ReactNativeWebView?: {
    postMessage?: unknown;
  };
};

export function CherryRuntimeBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const [entry, setEntry] = useState<CherryEntryResolution>(() =>
    isCherryEntryPath(pathname)
      ? { mode: "unsupported_cherry_entry" }
      : { mode: "standalone" }
  );
  const [checkedPathname, setCheckedPathname] = useState<string | null>(null);

  useEffect(() => {
    if (!isCherryEntryPath(pathname)) {
      setEntry({ mode: "standalone" });
      setCheckedPathname(pathname);
      return;
    }

    const cherryWindow = window as CherryNativeWindow;
    setEntry(
      resolveCherryEntry({
        pathname,
        hasCherryMarker: cherryWindow.__cherry === true,
        hasNativePostMessage:
          typeof cherryWindow.ReactNativeWebView?.postMessage === "function",
        hasEmbedQueryMarker:
          new URLSearchParams(window.location.search).get("cherry_embed") ===
          "1",
        isFramed: window.parent !== window,
      })
    );
    setCheckedPathname(pathname);
  }, [pathname]);

  if (!isCherryEntryPath(pathname)) {
    return children;
  }

  if (checkedPathname !== pathname) {
    return <CherryStatusScreen message="Checking the Cherry connection…" />;
  }

  if (entry.mode !== "cherry_embedded") {
    return <CherryStatusScreen message="Open this Mini App from Cherry." />;
  }

  return (
    <CherryEmbeddedRuntime platform={entry.platform}>
      {children}
    </CherryEmbeddedRuntime>
  );
}
