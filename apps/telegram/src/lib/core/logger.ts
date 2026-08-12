import { publicEnv } from "./config/public";

export const logger = {
  debug: (...args: unknown[]) => {
    if (publicEnv.appEnvironment === "local") {
      console.debug(...args);
    }
  },
  error: (message: string, error: unknown) => {
    console.error(message, error);
  },
} as const;
