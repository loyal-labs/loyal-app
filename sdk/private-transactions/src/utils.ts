export async function sha256hash(data: string): Promise<number[]> {
  const encoded = Uint8Array.from(new TextEncoder().encode(data));
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash));
}
