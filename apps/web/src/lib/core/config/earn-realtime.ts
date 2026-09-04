import {
  getOptionalEnv,
  type AppEnvironment,
  type EnvSource,
} from "./shared";

const REALTIME_EVENTS_URL_ENV_NAME = "REALTIME_EVENTS_URL";
const DEFAULT_REALTIME_EVENTS_URL =
  "https://loyal-yield-realtime.onrender.com/events";
const DEFAULT_LOCAL_REALTIME_EVENTS_URL = "http://127.0.0.1:10000/events";

export function resolveEarnRealtimeEventsUrl(
  env: EnvSource,
  appEnvironment: AppEnvironment
): string {
  const configured = getOptionalEnv(env, REALTIME_EVENTS_URL_ENV_NAME);
  if (configured) {
    return configured;
  }

  const isVercelDeployment =
    getOptionalEnv(env, "VERCEL") === "1" ||
    getOptionalEnv(env, "VERCEL_ENV") !== undefined;
  return appEnvironment === "local" && !isVercelDeployment
    ? DEFAULT_LOCAL_REALTIME_EVENTS_URL
    : DEFAULT_REALTIME_EVENTS_URL;
}
