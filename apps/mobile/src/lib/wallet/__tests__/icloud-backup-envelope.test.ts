/**
 * iCloud Drive backup envelope (ASK-2163) — trust-boundary parser tests.
 * The backup file comes back from iCloud, which can hand over truncated,
 * stale-format, or foreign content; a bad parse must yield null, never a
 * half-populated wallet restore.
 */
// icloud-backup transitively imports expo-secure-store (ESM, unloadable in
// jest's node env) via keypair-storage; the parser under test touches neither.
jest.mock("expo-secure-store", () => ({}));
jest.mock("expo-synced-keychain", () => ({}));

// eslint-disable-next-line import/first -- mocks above must precede the import
import { parseBackupEnvelope } from "../icloud-backup";

const valid = {
  v: 1,
  createdAt: "2026-08-18T12:00:00.000Z",
  publicKey: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  ciphertext: "base64ciphertextblob",
};

test("accepts a valid envelope and preserves the fields that matter", () => {
  const parsed = parseBackupEnvelope(JSON.stringify(valid));
  expect(parsed).not.toBeNull();
  expect(parsed?.publicKey).toBe(valid.publicKey);
  expect(parsed?.ciphertext).toBe(valid.ciphertext);
});

test.each([
  ["not JSON", "{{{"],
  ["truncated file", JSON.stringify(valid).slice(0, 40)],
  ["wrong version", JSON.stringify({ ...valid, v: 2 })],
  ["missing ciphertext", JSON.stringify({ ...valid, ciphertext: undefined })],
  ["empty ciphertext", JSON.stringify({ ...valid, ciphertext: "" })],
  ["missing publicKey", JSON.stringify({ ...valid, publicKey: undefined })],
  ["non-object", JSON.stringify("hello")],
  ["null", JSON.stringify(null)],
])("rejects %s", (_name, raw) => {
  expect(parseBackupEnvelope(raw)).toBeNull();
});

test("tolerates a missing createdAt rather than rejecting the wallet", () => {
  const { createdAt: _omit, ...rest } = valid;
  const parsed = parseBackupEnvelope(JSON.stringify(rest));
  expect(parsed?.publicKey).toBe(valid.publicKey);
});
