import { ensureEarnRealtimeSession } from "../earn-auth";
import { getEarnSessionToken, maybeMintEarnSession } from "../earn-session";
import type { Signer } from "@/lib/wallet/signer";

jest.mock("../earn-session", () => ({
  getEarnSessionToken: jest.fn(),
  maybeMintEarnSession: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../earn-api", () => ({ EarnApiError: class extends Error {} }));
const session = jest.mocked(getEarnSessionToken);
const signer = (kind: Signer["kind"], wallet = "wallet") =>
  ({
    kind,
    publicKey: { toBase58: () => wallet },
    signMessage: jest.fn().mockResolvedValue(new Uint8Array(64)),
  } as unknown as Signer);
beforeEach(() => {
  jest.clearAllMocks();
  session.mockReset();
  session.mockResolvedValue(null);
});

test("passive bootstrap and expiry renewal can sign locally but never open an external wallet", async () => {
  for (const kind of ["seed-vault", "mwa", "deeplink"] as const) {
    const external = signer(kind);
    expect(await ensureEarnRealtimeSession("wallet", external)).toBeNull();
    expect(external.signMessage).not.toHaveBeenCalled();
  }
  const local = signer("local");
  session.mockResolvedValueOnce(null).mockResolvedValueOnce("renewed");
  expect(await ensureEarnRealtimeSession("wallet", local)).toBe("renewed");
  expect(local.signMessage).toHaveBeenCalledTimes(1);
  expect(maybeMintEarnSession).toHaveBeenCalled();
});

test("cached auth avoids prompts and explicit renewal refuses a stale wallet signer", async () => {
  const external = signer("mwa");
  session.mockResolvedValueOnce("cached");
  expect(await ensureEarnRealtimeSession("wallet", external)).toBe("cached");
  expect(external.signMessage).not.toHaveBeenCalled();
  const stale = signer("mwa", "old-wallet");
  expect(await ensureEarnRealtimeSession("wallet", stale, true)).toBeNull();
  expect(stale.signMessage).not.toHaveBeenCalled();
  session.mockResolvedValueOnce(null).mockResolvedValueOnce("renewed");
  expect(await ensureEarnRealtimeSession("wallet", external, true)).toBe(
    "renewed"
  );
  expect(external.signMessage).toHaveBeenCalledTimes(1);
});
