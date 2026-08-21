import { describe, expect, mock, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";

import {
  executeEarnAutoswapSetupClient,
  prepareEarnAutoswapDeletionClient,
} from "./earn-autoswap-client-flow";

const key = () => PublicKey.unique();
const prepared = (id: string) => ({ id } as never);
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
    const secondInput = prepare.mock.calls[1]?.[0] as {
      projectedPolicies: Array<{ seed: bigint; sourceShard: string }>;
    };
    expect(secondInput.projectedPolicies).toEqual([
      expect.objectContaining({ seed: BigInt(10), sourceShard: "classic" }),
    ]);
  });

  test("resumes a projected partial pair by sending only the missing shard", async () => {
    const classic = policy("classic", BigInt(10), true);
    const token2022 = policy("token_2022", BigInt(11), false);
    const prepare = mock(async () => ({ policies: [classic, token2022] }));
    const sendPrepared = mock(async () => "signature");

    const result = await executeEarnAutoswapSetupClient({
      client: { prepareEarnCrossMintSwapPolicies: prepare } as never,
      input: {
        projectedPolicies: [
          {
            account: classic.policy.account,
            seed: classic.policy.seed,
            sourceShard: classic.sourceShard,
          },
        ],
      } as never,
      sendPrepared,
    });

    expect(result).toEqual({ completedPolicies: 2 });
    expect(sendPrepared).toHaveBeenCalledTimes(1);
    const sendCalls = sendPrepared.mock.calls as unknown as Array<
      [unknown, { policyNumber: number; sourceShard: string }]
    >;
    expect(sendCalls[0]?.[1]).toEqual({
      policyNumber: 2,
      sourceShard: "token_2022",
    });
  });

  test("submits nothing when both projected shards validate", async () => {
    const prepare = mock(async () => ({
      policies: [
        policy("classic", BigInt(10), true),
        policy("token_2022", BigInt(11), true),
      ],
    }));
    const sendPrepared = mock(async () => "signature");

    const result = await executeEarnAutoswapSetupClient({
      client: { prepareEarnCrossMintSwapPolicies: prepare } as never,
      input: {} as never,
      sendPrepared,
    });

    expect(result).toEqual({ completedPolicies: 2 });
    expect(sendPrepared).not.toHaveBeenCalled();
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
