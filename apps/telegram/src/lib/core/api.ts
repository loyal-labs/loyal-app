import { publicEnv } from "./config/public";

export function resolveEndpoint(path: string): string {
  const serverHost = publicEnv.serverHost;
  if (!serverHost) return path;

  try {
    const url = new URL(path, serverHost);
    return url.toString();
  } catch {
    return path;
  }
}
