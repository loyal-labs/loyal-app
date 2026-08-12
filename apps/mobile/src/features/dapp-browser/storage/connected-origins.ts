import * as SecureStore from "expo-secure-store";

const CONNECTED_ORIGINS_KEY = "loyal.dappBrowser.connectedOrigins";

export async function listConnectedOrigins(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(CONNECTED_ORIGINS_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function rememberConnectedOrigin(origin: string): Promise<void> {
  const current = await listConnectedOrigins();
  const next = Array.from(new Set([...current, origin]));
  await SecureStore.setItemAsync(CONNECTED_ORIGINS_KEY, JSON.stringify(next));
}

export async function forgetConnectedOrigin(origin: string): Promise<void> {
  const current = await listConnectedOrigins();
  const next = current.filter((item) => item !== origin);
  await SecureStore.setItemAsync(CONNECTED_ORIGINS_KEY, JSON.stringify(next));
}
