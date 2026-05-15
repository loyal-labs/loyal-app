/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/kamino_deposit_router.json`.
 */
export type KaminoDepositRouter = {
  "address": "4MDtYRz8fbRfk3AbxdDJ2nCejQrSxcemAyZW9EEZDrtX",
  "metadata": {
    "name": "kaminoDepositRouter",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
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
          "address": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        },
        {
          "name": "feeLiquidity",
          "writable": true
        },
        {
          "name": "lendingMarket",
          "address": "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J"
        },
        {
          "name": "lendingMarketAuthority"
        },
        {
          "name": "reserve",
          "writable": true,
          "address": "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy"
        },
        {
          "name": "reserveLiquiditySupply",
          "writable": true,
          "address": "Bh45cPkpfRvz9hAs23ye5TowsGbhbh4BXT4AGww8JfES"
        },
        {
          "name": "reserveCollateralMint",
          "writable": true,
          "address": "8GoBXfEq3aTiWTxEP2tAaygJMx3LhG764iN5e6gqaLA"
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
      "name": "invalidMint",
      "msg": "Invalid token mint"
    },
    {
      "code": 6001,
      "name": "invalidTokenAccount",
      "msg": "Invalid token account"
    },
    {
      "code": 6002,
      "name": "invalidFeeTokenAccount",
      "msg": "Invalid fee token account"
    },
    {
      "code": 6003,
      "name": "invalidKaminoAccounts",
      "msg": "Invalid Kamino accounts"
    },
    {
      "code": 6004,
      "name": "thresholdNotMet",
      "msg": "Source balance is not above the routing threshold"
    },
    {
      "code": 6005,
      "name": "routeAmountTooSmall",
      "msg": "Route amount is too small"
    },
    {
      "code": 6006,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6007,
      "name": "invalidKaminoDeposit",
      "msg": "Kamino consumed an unexpected liquidity amount"
    },
    {
      "code": 6008,
      "name": "noCollateralMinted",
      "msg": "Kamino deposit minted no collateral shares"
    }
  ],
  "types": [
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
