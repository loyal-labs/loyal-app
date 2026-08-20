import { describe, expect, mock, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";

import {
  executeEarnAutoswapSetupClient,
  prepareEarnAutoswapDeletionClient,
} from "./earn-autoswap-client-flow";

const key = () => PublicKey.unique();
const prepared = (id: string) => ({ id }) as never;
const policy = (
  sourceShard: "classic" | "token_2022",
  seed: bigint,
  existing: boolean
) => ({
  existing,
  policy: { account: key(), id: seed, seed },
  prepared: existing ? undefined : prepared(`${sourceShard}-${seed}`),
  sourceShard,
  persistence: {} as never,
});

describe("Autoswap client flow", () => {
  test("re-prepares after each sequential policy confirmation", async () => {
    const prepare = mock()
      .mockResolvedValueOnce({
        policies: [
          policy("classic", BigInt(10), false),
          policy("token_2022", BigInt(11), false),
        ],
      })
      .mockResolvedValueOnce({
        policies: [
          policy("classic", BigInt(10), true),
          policy("token_2022", BigInt(11), false),
        ],
      });
    const sendPrepared = mock(async () => "signature");
    const result = await executeEarnAutoswapSetupClient({
      client: { prepareEarnCrossMintSwapPolicies: prepare } as never,
      input: {} as never,
      sendPrepared,
    });

    expect(result).toEqual({ completedPolicies: 2 });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(sendPrepared).toHaveBeenCalledTimes(2);
    const calls = sendPrepared.mock.calls as unknown as Array<
      [unknown, { sourceShard: string }]
    >;
    expect(calls.map((call) => call[1].sourceShard)).toEqual([
      "classic",
      "token_2022",
    ]);
  });

  test("builds deletion directly with public wallet inputs", async () => {
    const prepareClosePoliciesSync = mock(async () => prepared("close"));
    const feePayer = key();
    const policies = [key(), key()];
    const settingsPda = key();
    const result = await prepareEarnAutoswapDeletionClient({
      client: { prepareClosePoliciesSync } as never,
      feePayer,
      policies,
      settingsPda,
      signer: feePayer,
    });

    expect(result).not.toBeNull();
    expect(prepareClosePoliciesSync).toHaveBeenCalledWith({
      feePayer,
      policies,
      settingsPda,
      signers: [feePayer],
    });
  });
});
