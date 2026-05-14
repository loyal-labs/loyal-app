"use client";

import { useEffect } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";

let hasLoggedBuildInfo = false;

export function BuildInfoLogger() {
  const publicEnv = usePublicEnv();

  useEffect(() => {
    if (hasLoggedBuildInfo) {
      return;
    }

    hasLoggedBuildInfo = true;
    console.log(`${publicEnv.gitBranch} @ ${publicEnv.gitCommitHash}`);
  }, [publicEnv.gitBranch, publicEnv.gitCommitHash]);

  return null;
}
