"use client";

import { useEffect } from "react";

const CHERRY_MOBILE_DOCUMENT_ATTRIBUTE = "data-cherry-mobile";

/** Scopes mobile WebView chrome adjustments to the dedicated Cherry route. */
export function CherryMobileDocumentScope() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(CHERRY_MOBILE_DOCUMENT_ATTRIBUTE, "true");

    return () => {
      root.removeAttribute(CHERRY_MOBILE_DOCUMENT_ATTRIBUTE);
    };
  }, []);

  return null;
}
