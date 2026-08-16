/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/telegram_verification.json`.
 */
export type TelegramVerification = {
  "address": "9yiphKYd4b69tR1ZPP8rNwtMeUwWgjYXaXdEzyNziNhz",
  "metadata": {
    "name": "telegramVerification",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "store",
      "discriminator": [
        220,
        28,
        207,
        235,
        0,
        234,
        193,
        246
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  103,
                  95,
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "validationBytes",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "verifyTelegramInitData",
      "discriminator": [
        209,
        162,
        185,
        176,
        5,
        219,
        142,
        219
      ],
      "accounts": [
        {
          "name": "session",
          "writable": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "telegramSession",
      "discriminator": [
        166,
        166,
        101,
        241,
        97,
        253,
        72,
        138
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidValidationBytesLength",
      "msg": "Invalid validation string length"
    },
    {
      "code": 6001,
      "name": "notVerified",
      "msg": "Not Verified"
    },
    {
      "code": 6002,
      "name": "invalidEd25519",
      "msg": "Invalid Ed25519"
    },
    {
      "code": 6003,
      "name": "invalidTelegramPk",
      "msg": "Invalid Telegram PK"
    },
    {
      "code": 6004,
      "name": "invalidTelegramMessage",
      "msg": "Invalid Telegram message"
    },
    {
      "code": 6005,
      "name": "invalidTelegramSignature",
      "msg": "Invalid Telegram signature"
    },
    {
      "code": 6006,
      "name": "invalidTelegramPublicKey",
      "msg": "Invalid Telegram public key"
    },
    {
      "code": 6007,
      "name": "invalidTelegramUsername",
      "msg": "Invalid Telegram username"
    },
    {
      "code": 6008,
      "name": "invalidTelegramAuthDate",
      "msg": "Invalid Telegram auth date"
    }
  ],
  "types": [
    {
      "name": "telegramSession",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "userWallet",
            "type": "pubkey"
          },
          {
            "name": "username",
            "type": "string"
          },
          {
            "name": "validationBytes",
            "type": "bytes"
          },
          {
            "name": "verified",
            "type": "bool"
          },
          {
            "name": "authAt",
            "type": "u64"
          },
          {
            "name": "verifiedAt",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    }
  ]
};
