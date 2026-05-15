/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/kamino_router.json`.
 */
export type KaminoRouter = {
  "address": "4MDtYRz8fbRfk3AbxdDJ2nCejQrSxcemAyZW9EEZDrtX",
  "metadata": {
    "name": "kaminoRouter",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "crankRoute",
      "discriminator": [
        223,
        67,
        222,
        93,
        107,
        203,
        62,
        192
      ],
      "accounts": [
        {
          "name": "policy",
          "writable": true
        },
        {
          "name": "crankAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  107,
                  97,
                  109,
                  105,
                  110,
                  111,
                  95,
                  114,
                  111,
                  117,
                  116,
                  101,
                  114,
                  95,
                  99,
                  114,
                  97,
                  110,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              }
            ]
          }
        },
        {
          "name": "smartAccountProgram",
          "address": "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "crankRouteArgs"
            }
          }
        }
      ]
    },
    {
      "name": "routeDeposit",
      "discriminator": [
        24,
        140,
        221,
        247,
        2,
        183,
        14,
        53
      ],
      "accounts": [
        {
          "name": "crank",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "signer": true
        },
        {
          "name": "sourceLiquidity",
          "writable": true
        },
        {
          "name": "tokenMint",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "feeLiquidity",
          "writable": true
        },
        {
          "name": "lendingMarket",
          "address": "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA"
        },
        {
          "name": "lendingMarketAuthority"
        },
        {
          "name": "reserve",
          "writable": true,
          "address": "9GJ9GBRwCp4pHmWrQ43L5xpc9Vykg7jnfwcFGN8FoHYu"
        },
        {
          "name": "reserveLiquiditySupply",
          "writable": true,
          "address": "H6JUwz8c61eQnYUx8avGXydKztKPyGvgWAUjmZUPS3BC"
        },
        {
          "name": "reserveCollateralMint",
          "writable": true,
          "address": "DKaVQFXD6Qz4USTkRWyPun3oU6r1RfYsWJ8YqLpnSnN5"
        },
        {
          "name": "vaultCollateralTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "reserveCollateralMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "instructionSysvarAccount",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "klendProgram",
          "address": "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "routeDepositArgs"
            }
          }
        }
      ]
    }
  ],
  "events": [
    {
      "name": "kaminoRouteEvent",
      "discriminator": [
        182,
        216,
        123,
        175,
        27,
        127,
        147,
        41
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "policyPayloadTooLarge",
      "msg": "Policy payload is too large"
    },
    {
      "code": 6001,
      "name": "invalidPolicyPayload",
      "msg": "Invalid policy payload"
    },
    {
      "code": 6002,
      "name": "invalidMint",
      "msg": "Invalid token mint"
    },
    {
      "code": 6003,
      "name": "invalidTokenAccount",
      "msg": "Invalid token account"
    },
    {
      "code": 6004,
      "name": "invalidFeeTokenAccount",
      "msg": "Invalid fee token account"
    },
    {
      "code": 6005,
      "name": "invalidKaminoAccounts",
      "msg": "Invalid Kamino accounts"
    },
    {
      "code": 6006,
      "name": "thresholdNotMet",
      "msg": "Source balance is not above the routing threshold"
    },
    {
      "code": 6007,
      "name": "routeAmountTooSmall",
      "msg": "Route amount is too small"
    },
    {
      "code": 6008,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6009,
      "name": "invalidKaminoDeposit",
      "msg": "Kamino consumed an unexpected liquidity amount"
    },
    {
      "code": 6010,
      "name": "noCollateralMinted",
      "msg": "Kamino deposit minted no collateral shares"
    }
  ],
  "types": [
    {
      "name": "crankRouteArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "accountIndex",
            "type": "u8"
          },
          {
            "name": "policyPayload",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "kaminoRouteEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "sourceLiquidity",
            "type": "pubkey"
          },
          {
            "name": "feeLiquidity",
            "type": "pubkey"
          },
          {
            "name": "reserve",
            "type": "pubkey"
          },
          {
            "name": "keepLiquidityAmount",
            "type": "u64"
          },
          {
            "name": "routedAmount",
            "type": "u64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "depositedAmount",
            "type": "u64"
          },
          {
            "name": "mintedCollateral",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "routeDepositArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "keepLiquidityAmount",
            "type": "u64"
          },
          {
            "name": "minimumDepositAmount",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
