import { resolveAppEnvironment } from "./config/shared";

export const logger = {
  debug: (...args: unknown[]) => {
    if (
      resolveAppEnvironment(process.env.NEXT_PUBLIC_APP_ENVIRONMENT) === "local"
    ) {
      console.debug(...args);
    }
  },
  error: (message: string, error: unknown) => {
    console.error(message, error);
  },
} as const;
