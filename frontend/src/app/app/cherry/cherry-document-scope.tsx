"use client";

import { useEffect } from "react";

const CHERRY_DOCUMENT_ATTRIBUTE = "data-cherry-embedded";

/** Scopes narrow embedded-view adjustments to the dedicated Cherry route. */
export function CherryDocumentScope() {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(CHERRY_DOCUMENT_ATTRIBUTE, "true");

    return () => {
      root.removeAttribute(CHERRY_DOCUMENT_ATTRIBUTE);
    };
  }, []);

  return null;
}
