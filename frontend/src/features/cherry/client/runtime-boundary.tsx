"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { isCherryEntryPath } from "../entry";
import {
  resolveCherryMobileEntry,
  type CherryMobileEntryMode,
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
  const [entryMode, setEntryMode] = useState<CherryMobileEntryMode>(() =>
    isCherryEntryPath(pathname) ? "unsupported_cherry_entry" : "standalone"
  );
  const [checkedPathname, setCheckedPathname] = useState<string | null>(null);

  useEffect(() => {
    if (!isCherryEntryPath(pathname)) {
      setEntryMode("standalone");
      setCheckedPathname(pathname);
      return;
    }

    const cherryWindow = window as CherryNativeWindow;
    setEntryMode(
      resolveCherryMobileEntry({
        pathname,
        hasCherryMarker: cherryWindow.__cherry === true,
        hasNativePostMessage:
          typeof cherryWindow.ReactNativeWebView?.postMessage === "function",
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

  if (entryMode !== "cherry_mobile") {
    return (
      <CherryStatusScreen message="Open this Mini App from the Cherry mobile app." />
    );
  }

  return <CherryEmbeddedRuntime>{children}</CherryEmbeddedRuntime>;
}
