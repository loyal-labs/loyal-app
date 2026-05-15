/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/kamino_route_crank.json`.
 */
export type KaminoRouteCrank = {
  "address": "4RVMhCMFzQGwtKZFdowuMzChpsHhHFWvt8a7tVb4hqa6",
  "metadata": {
    "name": "kaminoRouteCrank",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Permissionless crank entrypoint for Kamino deposit routing"
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
    }
  ]
};
