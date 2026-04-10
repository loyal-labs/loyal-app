// src/LoyalPrivateTransactionsClient.ts
import {
  Connection,
  PublicKey as PublicKey4,
  SystemProgram
} from "@solana/web3.js";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import {
  verifyTeeRpcIntegrity,
  getAuthToken
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { sign } from "tweetnacl";
// src/idl/telegram_private_transfer.json
var telegram_private_transfer_default = {
  address: "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV",
  metadata: {
    name: "telegram_private_transfer",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Created with Anchor"
  },
  instructions: [
    {
      name: "claim_username_deposit_to_deposit",
      docs: [
        "Claim tokens and transfer from username deposit to deposit"
      ],
      discriminator: [
        147,
        77,
        235,
        126,
        72,
        182,
        30,
        12
      ],
      accounts: [
        {
          name: "user",
          relations: [
            "destination_deposit"
          ]
        },
        {
          name: "source_username_deposit",
          writable: true
        },
        {
          name: "destination_deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                kind: "account",
                path: "destination_deposit.user",
                account: "Deposit"
              },
              {
                kind: "account",
                path: "destination_deposit.token_mint",
                account: "Deposit"
              }
            ]
          }
        },
        {
          name: "token_mint",
          relations: [
            "source_username_deposit",
            "destination_deposit"
          ]
        },
        {
          name: "session"
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      args: [
        {
          name: "amount",
          type: "u64"
        }
      ]
    },
    {
      name: "create_permission",
      docs: [
        "Creates a permission for a deposit account using the external permission program.",
        "",
        "Calls out to the permission program to create a permission for the deposit account."
      ],
      discriminator: [
        190,
        182,
        26,
        164,
        156,
        221,
        8,
        0
      ],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true
        },
        {
          name: "user",
          signer: true
        },
        {
          name: "deposit",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                kind: "account",
                path: "user"
              },
              {
                kind: "account",
                path: "deposit.token_mint",
                account: "Deposit"
              }
            ]
          }
        },
        {
          name: "permission",
          writable: true
        },
        {
          name: "permission_program"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        }
      ],
      args: []
    },
    {
      name: "create_username_permission",
      docs: [
        "Creates a permission for a username-based deposit account."
      ],
      discriminator: [
        130,
        137,
        147,
        121,
        57,
        217,
        102,
        40
      ],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true
        },
        {
          name: "authority",
          signer: true
        },
        {
          name: "deposit"
        },
        {
          name: "session"
        },
        {
          name: "permission",
          writable: true
        },
        {
          name: "permission_program"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        }
      ],
      args: []
    },
    {
      name: "delegate",
      docs: [
        "Delegates the deposit account to the ephemeral rollups delegate program.",
        "",
        "Uses the ephemeral rollups delegate CPI to delegate the deposit account."
      ],
      discriminator: [
        90,
        147,
        75,
        178,
        85,
        88,
        4,
        137
      ],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true
        },
        {
          name: "validator",
          optional: true
        },
        {
          name: "buffer_deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                kind: "account",
                path: "deposit"
              }
            ],
            program: {
              kind: "const",
              value: [
                120,
                119,
                237,
                228,
                109,
                110,
                60,
                47,
                140,
                61,
                153,
                86,
                183,
                54,
                59,
                48,
                46,
                44,
                189,
                35,
                126,
                97,
                173,
                95,
                156,
                209,
                177,
                123,
                98,
                164,
                128,
                252
              ]
            }
          }
        },
        {
          name: "delegation_record_deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                kind: "account",
                path: "deposit"
              }
            ],
            program: {
              kind: "account",
              path: "delegation_program"
            }
          }
        },
        {
          name: "delegation_metadata_deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                kind: "account",
                path: "deposit"
              }
            ],
            program: {
              kind: "account",
              path: "delegation_program"
            }
          }
        },
        {
          name: "deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                kind: "arg",
                path: "user"
              },
              {
                kind: "arg",
                path: "token_mint"
              }
            ]
          }
        },
        {
          name: "owner_program",
          address: "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV"
        },
        {
          name: "delegation_program",
          address: "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        }
      ],
      args: [
        {
          name: "user",
          type: "pubkey"
        },
        {
          name: "token_mint",
          type: "pubkey"
        }
      ]
    },
    {
      name: "delegate_username_deposit",
      docs: [
        "Delegates the username-based deposit account to the ephemeral rollups delegate program."
      ],
      discriminator: [
        26,
        82,
        4,
        176,
        221,
        64,
        84,
        178
      ],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true
        },
        {
          name: "validator",
          optional: true
        },
        {
          name: "buffer_deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                kind: "account",
                path: "deposit"
              }
            ],
            program: {
              kind: "const",
              value: [
                120,
                119,
                237,
                228,
                109,
                110,
                60,
                47,
                140,
                61,
                153,
                86,
                183,
                54,
                59,
                48,
                46,
                44,
                189,
                35,
                126,
                97,
                173,
                95,
                156,
                209,
                177,
                123,
                98,
                164,
                128,
                252
              ]
            }
          }
        },
        {
          name: "delegation_record_deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                kind: "account",
                path: "deposit"
              }
            ],
            program: {
              kind: "account",
              path: "delegation_program"
            }
          }
        },
        {
          name: "delegation_metadata_deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                kind: "account",
                path: "deposit"
              }
            ],
            program: {
              kind: "account",
              path: "delegation_program"
            }
          }
        },
        {
          name: "deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  110,
                  97,
                  109,
                  101,
                  95,
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                kind: "arg",
                path: "username_hash"
              },
              {
                kind: "arg",
                path: "token_mint"
              }
            ]
          }
        },
        {
          name: "owner_program",
          address: "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV"
        },
        {
          name: "delegation_program",
          address: "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        }
      ],
      args: [
        {
          name: "username_hash",
          type: {
            array: [
              "u8",
              32
            ]
          }
        },
        {
          name: "token_mint",
          type: "pubkey"
        }
      ]
    },
    {
      name: "initialize_deposit",
      docs: [
        "Initializes a deposit account for a user and token mint if it does not exist.",
        "",
        "Sets up a new deposit account with zero balance for the user and token mint.",
        "If the account is already initialized, this instruction is a no-op."
      ],
      discriminator: [
        171,
        65,
        93,
        225,
        61,
        109,
        31,
        227
      ],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true
        },
        {
          name: "user"
        },
        {
          name: "deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                kind: "account",
                path: "user"
              },
              {
                kind: "account",
                path: "token_mint"
              }
            ]
          }
        },
        {
          name: "token_mint"
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        }
      ],
      args: []
    },
    {
      name: "initialize_username_deposit",
      discriminator: [
        125,
        255,
        77,
        198,
        75,
        226,
        85,
        91
      ],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true
        },
        {
          name: "deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  110,
                  97,
                  109,
                  101,
                  95,
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                kind: "arg",
                path: "username_hash"
              },
              {
                kind: "account",
                path: "token_mint"
              }
            ]
          }
        },
        {
          name: "token_mint"
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        }
      ],
      args: [
        {
          name: "username_hash",
          type: {
            array: [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      name: "modify_balance",
      docs: [
        "Modifies the balance of a user's deposit account by transferring tokens in or out.",
        "",
        "If `args.increase` is true, tokens are transferred from the user's token account to the deposit account.",
        "If false, tokens are transferred from the deposit account back to the user's token account."
      ],
      discriminator: [
        148,
        232,
        7,
        240,
        55,
        51,
        121,
        115
      ],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true
        },
        {
          name: "user",
          signer: true,
          relations: [
            "deposit"
          ]
        },
        {
          name: "vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "deposit.token_mint",
                account: "Deposit"
              }
            ]
          }
        },
        {
          name: "deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                kind: "account",
                path: "deposit.user",
                account: "Deposit"
              },
              {
                kind: "account",
                path: "deposit.token_mint",
                account: "Deposit"
              }
            ]
          }
        },
        {
          name: "user_token_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "user"
              },
              {
                kind: "const",
                value: [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                kind: "account",
                path: "token_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
          name: "vault_token_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "vault"
              },
              {
                kind: "const",
                value: [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                kind: "account",
                path: "token_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
          name: "token_mint",
          relations: [
            "deposit"
          ]
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          name: "associated_token_program",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        }
      ],
      args: [
        {
          name: "args",
          type: {
            defined: {
              name: "ModifyDepositArgs"
            }
          }
        }
      ]
    },
    {
      name: "process_undelegation",
      discriminator: [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      accounts: [
        {
          name: "base_account",
          writable: true
        },
        {
          name: "buffer"
        },
        {
          name: "payer",
          writable: true
        },
        {
          name: "system_program"
        }
      ],
      args: [
        {
          name: "account_seeds",
          type: {
            vec: "bytes"
          }
        }
      ]
    },
    {
      name: "transfer_deposit",
      docs: [
        "Transfers a specified amount from one user's deposit account to another's for the same token mint.",
        "",
        "Only updates the internal accounting; does not move actual tokens."
      ],
      discriminator: [
        20,
        20,
        147,
        223,
        41,
        63,
        204,
        111
      ],
      accounts: [
        {
          name: "user",
          relations: [
            "source_deposit"
          ]
        },
        {
          name: "payer",
          writable: true,
          signer: true
        },
        {
          name: "session_token",
          optional: true
        },
        {
          name: "source_deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                kind: "account",
                path: "source_deposit.user",
                account: "Deposit"
              },
              {
                kind: "account",
                path: "source_deposit.token_mint",
                account: "Deposit"
              }
            ]
          }
        },
        {
          name: "destination_deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                kind: "account",
                path: "destination_deposit.user",
                account: "Deposit"
              },
              {
                kind: "account",
                path: "destination_deposit.token_mint",
                account: "Deposit"
              }
            ]
          }
        },
        {
          name: "token_mint",
          relations: [
            "source_deposit",
            "destination_deposit"
          ]
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        }
      ],
      args: [
        {
          name: "amount",
          type: "u64"
        }
      ]
    },
    {
      name: "transfer_to_username_deposit",
      docs: [
        "Transfers a specified amount from a user's deposit account to a username-based deposit.",
        "",
        "Only updates the internal accounting; does not move actual tokens."
      ],
      discriminator: [
        224,
        228,
        188,
        234,
        232,
        153,
        75,
        96
      ],
      accounts: [
        {
          name: "user",
          relations: [
            "source_deposit"
          ]
        },
        {
          name: "payer",
          writable: true,
          signer: true
        },
        {
          name: "session_token",
          optional: true
        },
        {
          name: "source_deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                kind: "account",
                path: "source_deposit.user",
                account: "Deposit"
              },
              {
                kind: "account",
                path: "source_deposit.token_mint",
                account: "Deposit"
              }
            ]
          }
        },
        {
          name: "destination_deposit",
          writable: true
        },
        {
          name: "token_mint",
          relations: [
            "source_deposit",
            "destination_deposit"
          ]
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        }
      ],
      args: [
        {
          name: "amount",
          type: "u64"
        }
      ]
    },
    {
      name: "undelegate",
      docs: [
        "Commits and undelegates the deposit account from the ephemeral rollups program.",
        "",
        "Uses the ephemeral rollups SDK to commit and undelegate the deposit account."
      ],
      discriminator: [
        131,
        148,
        180,
        198,
        91,
        104,
        42,
        238
      ],
      accounts: [
        {
          name: "user"
        },
        {
          name: "payer",
          writable: true,
          signer: true
        },
        {
          name: "session_token",
          optional: true
        },
        {
          name: "deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                kind: "account",
                path: "user"
              },
              {
                kind: "account",
                path: "deposit.token_mint",
                account: "Deposit"
              }
            ]
          }
        },
        {
          name: "magic_program",
          address: "Magic11111111111111111111111111111111111111"
        },
        {
          name: "magic_context",
          writable: true,
          address: "MagicContext1111111111111111111111111111111"
        }
      ],
      args: []
    },
    {
      name: "undelegate_username_deposit",
      docs: [
        "Commits and undelegates the username-based deposit account from the ephemeral rollups program."
      ],
      discriminator: [
        169,
        131,
        184,
        97,
        218,
        190,
        134,
        4
      ],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true
        },
        {
          name: "session"
        },
        {
          name: "deposit",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  110,
                  97,
                  109,
                  101,
                  95,
                  100,
                  101,
                  112,
                  111,
                  115,
                  105,
                  116,
                  95,
                  118,
                  50
                ]
              },
              {
                kind: "arg",
                path: "username_hash"
              },
              {
                kind: "arg",
                path: "token_mint"
              }
            ]
          }
        },
        {
          name: "magic_program",
          address: "Magic11111111111111111111111111111111111111"
        },
        {
          name: "magic_context",
          writable: true,
          address: "MagicContext1111111111111111111111111111111"
        }
      ],
      args: [
        {
          name: "username_hash",
          type: {
            array: [
              "u8",
              32
            ]
          }
        },
        {
          name: "token_mint",
          type: "pubkey"
        }
      ]
    }
  ],
  accounts: [
    {
      name: "Deposit",
      discriminator: [
        148,
        146,
        121,
        66,
        207,
        173,
        21,
        227
      ]
    },
    {
      name: "SessionToken",
      discriminator: [
        233,
        4,
        115,
        14,
        46,
        21,
        1,
        15
      ]
    },
    {
      name: "TelegramSession",
      discriminator: [
        166,
        166,
        101,
        241,
        97,
        253,
        72,
        138
      ]
    },
    {
      name: "UsernameDeposit",
      discriminator: [
        242,
        23,
        53,
        35,
        55,
        192,
        177,
        246
      ]
    },
    {
      name: "Vault",
      discriminator: [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  errors: [
    {
      code: 6000,
      name: "Unauthorized",
      msg: "Unauthorized"
    },
    {
      code: 6001,
      name: "Overflow",
      msg: "Overflow"
    },
    {
      code: 6002,
      name: "InvalidMint",
      msg: "Invalid Mint"
    },
    {
      code: 6003,
      name: "InsufficientVault",
      msg: "Insufficient Vault"
    },
    {
      code: 6004,
      name: "InsufficientDeposit",
      msg: "Insufficient Deposit"
    },
    {
      code: 6005,
      name: "NotVerified",
      msg: "Not Verified"
    },
    {
      code: 6006,
      name: "ExpiredSignature",
      msg: "Expired Signature"
    },
    {
      code: 6007,
      name: "Replay",
      msg: "Replay"
    },
    {
      code: 6008,
      name: "InvalidEd25519",
      msg: "Invalid Ed25519"
    },
    {
      code: 6009,
      name: "InvalidUsername",
      msg: "Invalid Username"
    },
    {
      code: 6010,
      name: "InvalidRecipient",
      msg: "Invalid Recipient"
    },
    {
      code: 6011,
      name: "InvalidDepositor",
      msg: "Invalid Depositor"
    }
  ],
  types: [
    {
      name: "Deposit",
      docs: [
        "A deposit account for a user and token mint."
      ],
      type: {
        kind: "struct",
        fields: [
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "token_mint",
            type: "pubkey"
          },
          {
            name: "amount",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "ModifyDepositArgs",
      type: {
        kind: "struct",
        fields: [
          {
            name: "amount",
            type: "u64"
          },
          {
            name: "increase",
            type: "bool"
          }
        ]
      }
    },
    {
      name: "SessionToken",
      type: {
        kind: "struct",
        fields: [
          {
            name: "authority",
            type: "pubkey"
          },
          {
            name: "target_program",
            type: "pubkey"
          },
          {
            name: "session_signer",
            type: "pubkey"
          },
          {
            name: "valid_until",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "TelegramSession",
      type: {
        kind: "struct",
        fields: [
          {
            name: "user_wallet",
            type: "pubkey"
          },
          {
            name: "username_hash",
            type: {
              array: [
                "u8",
                32
              ]
            }
          },
          {
            name: "validation_bytes",
            type: "bytes"
          },
          {
            name: "verified",
            type: "bool"
          },
          {
            name: "auth_at",
            type: "u64"
          },
          {
            name: "verified_at",
            type: {
              option: "u64"
            }
          }
        ]
      }
    },
    {
      name: "UsernameDeposit",
      docs: [
        "A deposit account for a telegram username sha256 hash and token mint."
      ],
      type: {
        kind: "struct",
        fields: [
          {
            name: "username_hash",
            type: {
              array: [
                "u8",
                32
              ]
            }
          },
          {
            name: "token_mint",
            type: "pubkey"
          },
          {
            name: "amount",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "Vault",
      docs: [
        "A vault storing deposited tokens.",
        "Has a dummy field because Anchor requires it."
      ],
      type: {
        kind: "struct",
        fields: [
          {
            name: "_dummy",
            type: "u8"
          }
        ]
      }
    }
  ]
};

// src/constants.ts
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
var ER_VALIDATOR_DEVNET = new PublicKey("FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA");
var ER_VALIDATOR_MAINNET = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
var ER_VALIDATOR = ER_VALIDATOR_DEVNET;
function getErValidatorForSolanaEnv(env) {
  return env === "mainnet" ? ER_VALIDATOR_MAINNET : ER_VALIDATOR_DEVNET;
}
function getErValidatorForRpcEndpoint(rpcEndpoint) {
  return rpcEndpoint.includes("mainnet-tee") ? ER_VALIDATOR_MAINNET : ER_VALIDATOR_DEVNET;
}
var PROGRAM_ID = new PublicKey("97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV");
var DELEGATION_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
var PERMISSION_PROGRAM_ID = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
var MAGIC_PROGRAM_ID = new PublicKey("Magic11111111111111111111111111111111111111");
var MAGIC_CONTEXT_ID = new PublicKey("MagicContext1111111111111111111111111111111");
var DEPOSIT_SEED = "deposit_v2";
var DEPOSIT_SEED_BYTES = Buffer.from(DEPOSIT_SEED);
var USERNAME_DEPOSIT_SEED = "username_deposit_v2";
var USERNAME_DEPOSIT_SEED_BYTES = Buffer.from(USERNAME_DEPOSIT_SEED);
var VAULT_SEED = "vault";
var VAULT_SEED_BYTES = Buffer.from(VAULT_SEED);
var PERMISSION_SEED = "permission:";
var PERMISSION_SEED_BYTES = Buffer.from(PERMISSION_SEED);
function solToLamports(sol) {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}
function lamportsToSol(lamports) {
  return lamports / LAMPORTS_PER_SOL;
}

// src/pda.ts
import { PublicKey as PublicKey2 } from "@solana/web3.js";

// src/utils.ts
async function sha256hash(data) {
  const encoded = Uint8Array.from(new TextEncoder().encode(data));
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash));
}

// src/pda.ts
function findDepositPda(user, tokenMint, programId = PROGRAM_ID) {
  return PublicKey2.findProgramAddressSync([DEPOSIT_SEED_BYTES, user.toBuffer(), tokenMint.toBuffer()], programId);
}
async function findUsernameDepositPda(username, tokenMint, programId = PROGRAM_ID) {
  const usernameHash = await sha256hash(username);
  return PublicKey2.findProgramAddressSync([
    USERNAME_DEPOSIT_SEED_BYTES,
    Buffer.from(usernameHash),
    tokenMint.toBuffer()
  ], programId);
}
function findVaultPda(tokenMint, programId = PROGRAM_ID) {
  return PublicKey2.findProgramAddressSync([VAULT_SEED_BYTES, tokenMint.toBuffer()], programId);
}
function findPermissionPda(account, permissionProgramId = PERMISSION_PROGRAM_ID) {
  return PublicKey2.findProgramAddressSync([PERMISSION_SEED_BYTES, account.toBuffer()], permissionProgramId);
}
function findDelegationRecordPda(account, delegationProgramId = DELEGATION_PROGRAM_ID) {
  return PublicKey2.findProgramAddressSync([Buffer.from("delegation"), account.toBuffer()], delegationProgramId);
}
function findDelegationMetadataPda(account, delegationProgramId = DELEGATION_PROGRAM_ID) {
  return PublicKey2.findProgramAddressSync([Buffer.from("delegation-metadata"), account.toBuffer()], delegationProgramId);
}
function findBufferPda(account, ownerProgramId = PROGRAM_ID) {
  return PublicKey2.findProgramAddressSync([Buffer.from("buffer"), account.toBuffer()], ownerProgramId);
}

// src/wallet-adapter.ts
import {
  VersionedTransaction
} from "@solana/web3.js";

// src/types.ts
function isKeypair(signer) {
  return "secretKey" in signer && signer.secretKey instanceof Uint8Array;
}
function isAnchorProvider(signer) {
  return "wallet" in signer && "connection" in signer && "opts" in signer;
}
function isWalletLike(signer) {
  return "publicKey" in signer && "signTransaction" in signer && "signAllTransactions" in signer && !isKeypair(signer) && !isAnchorProvider(signer);
}

// src/wallet-adapter.ts
class InternalWalletAdapter {
  signer;
  publicKey;
  constructor(signer, publicKey) {
    this.signer = signer;
    this.publicKey = publicKey;
  }
  static from(signer) {
    const publicKey = InternalWalletAdapter.getPublicKey(signer);
    return new InternalWalletAdapter(signer, publicKey);
  }
  static getPublicKey(signer) {
    if (isKeypair(signer)) {
      return signer.publicKey;
    }
    if (isAnchorProvider(signer)) {
      return signer.wallet.publicKey;
    }
    return signer.publicKey;
  }
  async signTransaction(tx) {
    if (isKeypair(this.signer)) {
      return this.signWithKeypair(tx, this.signer);
    }
    if (isAnchorProvider(this.signer)) {
      return this.signer.wallet.signTransaction(tx);
    }
    return this.signer.signTransaction(tx);
  }
  async signAllTransactions(txs) {
    if (isKeypair(this.signer)) {
      return txs.map((tx) => this.signWithKeypair(tx, this.signer));
    }
    if (isAnchorProvider(this.signer)) {
      return this.signer.wallet.signAllTransactions(txs);
    }
    return this.signer.signAllTransactions(txs);
  }
  signWithKeypair(tx, keypair) {
    if (tx instanceof VersionedTransaction) {
      tx.sign([keypair]);
    } else {
      tx.partialSign(keypair);
    }
    return tx;
  }
}

// src/LoyalPrivateTransactionsClient.ts
function prettyStringify(obj) {
  const json = JSON.stringify(obj, (_key, value) => {
    if (value instanceof PublicKey4)
      return value.toBase58();
    if (typeof value === "bigint")
      return value.toString();
    return value;
  }, 2);
  return json.replace(/\[\s+(\d[\d,\s]*\d)\s+\]/g, (_match, inner) => {
    const items = inner.split(/,\s*/).map((s) => s.trim());
    return `[${items.join(", ")}]`;
  });
}
function programFromRpc(signer, commitment, rpcEndpoint, wsEndpoint) {
  const adapter = InternalWalletAdapter.from(signer);
  const baseConnection = new Connection(rpcEndpoint, {
    wsEndpoint,
    commitment
  });
  const baseProvider = new AnchorProvider(baseConnection, adapter, {
    commitment
  });
  return new Program(telegram_private_transfer_default, baseProvider);
}
function deriveMessageSigner(signer) {
  if (isKeypair(signer)) {
    return (message) => Promise.resolve(sign.detached(message, signer.secretKey));
  }
  if (isAnchorProvider(signer)) {
    const wallet = signer.wallet;
    if (typeof wallet.signMessage === "function") {
      return (message) => wallet.signMessage(message);
    }
    throw new Error("AnchorProvider wallet does not support signMessage, required for PER auth");
  }
  const walletLike = signer;
  if (typeof walletLike.signMessage === "function") {
    return (message) => walletLike.signMessage(message);
  }
  throw new Error("Wallet does not support signMessage, required for PER auth");
}
function waitForAccountOwnerChange(connection, account, expectedOwner, timeoutMs = 15000, intervalMs = 1000) {
  let skipWait;
  const subId = connection.onAccountChange(account, (accountInfo) => {
    if (accountInfo.owner.equals(expectedOwner) && skipWait) {
      console.log(`waitForAccountOwnerChange: ${account.toString()} – short-circuit polling wait`);
      skipWait();
    }
  }, { commitment: "confirmed" });
  const cleanup = async () => {
    await connection.removeAccountChangeListener(subId);
  };
  const wait = async () => {
    try {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const info = await connection.getAccountInfo(account, "confirmed");
        if (info && info.owner.equals(expectedOwner)) {
          console.log(`waitForAccountOwnerChange: ${account.toString()} appeared with owner ${expectedOwner.toString()} after ${Date.now() - start}ms`);
          return;
        }
        if (info) {
          console.log(`waitForAccountOwnerChange: ${account.toString()} exists but owner is ${info.owner.toString()}, expected ${expectedOwner.toString()}`);
        }
        await new Promise((r) => {
          skipWait = r;
          setTimeout(r, intervalMs);
        });
      }
      throw new Error(`waitForAccountOwnerChange: ${account.toString()} did not appear with owner ${expectedOwner.toString()} after ${timeoutMs}ms`);
    } finally {
      await cleanup();
    }
  };
  return { wait, cancel: cleanup };
}

class LoyalPrivateTransactionsClient {
  baseProgram;
  ephemeralProgram;
  wallet;
  constructor(baseProgram, ephemeralProgram, wallet) {
    this.baseProgram = baseProgram;
    this.ephemeralProgram = ephemeralProgram;
    this.wallet = wallet;
  }
  getExpectedErValidator() {
    return getErValidatorForRpcEndpoint(this.ephemeralProgram.provider.connection.rpcEndpoint);
  }
  getExpectedValidator() {
    return this.getExpectedErValidator();
  }
  async getAccountDelegationStatus(account) {
    return this.getDelegationStatus(account);
  }
  static async fromConfig(config) {
    const {
      signer,
      baseRpcEndpoint,
      baseWsEndpoint,
      ephemeralRpcEndpoint,
      ephemeralWsEndpoint,
      commitment = "confirmed",
      authToken
    } = config;
    const adapter = InternalWalletAdapter.from(signer);
    const baseProgram = programFromRpc(signer, commitment, baseRpcEndpoint, baseWsEndpoint);
    let finalEphemeralRpcEndpoint = ephemeralRpcEndpoint;
    let finalEphemeralWsEndpoint = ephemeralWsEndpoint;
    if (ephemeralRpcEndpoint.includes("tee")) {
      let token;
      let expiresAt;
      if (!authToken) {
        try {
          const isVerified = await verifyTeeRpcIntegrity(ephemeralRpcEndpoint);
          if (!isVerified) {
            console.error("[LoyalClient] TEE RPC integrity verification returned false");
          }
        } catch (e) {
          console.error("[LoyalClient] TEE RPC integrity verification error:", e);
        }
        const signMessage = deriveMessageSigner(signer);
        ({ token, expiresAt } = await getAuthToken(ephemeralRpcEndpoint, adapter.publicKey, signMessage));
      } else {
        token = authToken.token;
      }
      finalEphemeralRpcEndpoint = `${ephemeralRpcEndpoint}?token=${token}`;
      finalEphemeralWsEndpoint = ephemeralWsEndpoint ? `${ephemeralWsEndpoint}?token=${token}` : undefined;
    }
    const ephemeralProgram = programFromRpc(signer, commitment, finalEphemeralRpcEndpoint, finalEphemeralWsEndpoint);
    return new LoyalPrivateTransactionsClient(baseProgram, ephemeralProgram, adapter);
  }
  async initializeDeposit(params) {
    const { user, tokenMint, payer, rpcOptions } = params;
    const [depositPda] = findDepositPda(user, tokenMint);
    await this.ensureNotDelegated(depositPda, "modifyBalance-depositPda", true);
    const signature = await this.baseProgram.methods.initializeDeposit().accountsPartial({
      payer,
      user,
      tokenMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId
    }).rpc(rpcOptions);
    return signature;
  }
  async initializeUsernameDeposit(params) {
    const { username, tokenMint, payer, rpcOptions } = params;
    this.validateUsername(username);
    const [usernameDepositPda] = await findUsernameDepositPda(username, tokenMint);
    await this.ensureNotDelegated(usernameDepositPda, "modifyBalance-depositPda", true);
    const usernameHash = await sha256hash(username);
    const signature = await this.baseProgram.methods.initializeUsernameDeposit(usernameHash).accountsPartial({
      payer,
      tokenMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId
    }).rpc(rpcOptions);
    return signature;
  }
  async modifyBalance(params) {
    const {
      user,
      tokenMint,
      amount,
      increase,
      payer,
      userTokenAccount,
      rpcOptions
    } = params;
    const [depositPda] = findDepositPda(user, tokenMint);
    await this.ensureNotDelegated(depositPda, "modifyBalance-depositPda");
    const [vaultPda] = findVaultPda(tokenMint);
    const vaultTokenAccount = getAssociatedTokenAddressSync(tokenMint, vaultPda, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    console.log("modifyBalance", {
      payer: payer.toString(),
      user: user.toString(),
      vault: vaultPda.toString(),
      deposit: depositPda.toString(),
      userTokenAccount: userTokenAccount.toString(),
      vaultTokenAccount: vaultTokenAccount.toString(),
      tokenMint: tokenMint.toString()
    });
    const signature = await this.baseProgram.methods.modifyBalance({ amount: new BN(amount.toString()), increase }).accountsPartial({
      payer,
      user,
      vault: vaultPda,
      deposit: depositPda,
      userTokenAccount,
      vaultTokenAccount,
      tokenMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId
    }).rpc(rpcOptions);
    const deposit = await this.getBaseDeposit(user, tokenMint);
    if (!deposit) {
      throw new Error("Failed to fetch deposit after modification");
    }
    return { signature, deposit };
  }
  async claimUsernameDepositToDeposit(params) {
    const { username, tokenMint, amount, recipient, session, rpcOptions } = params;
    this.validateUsername(username);
    const [sourceUsernameDeposit] = await findUsernameDepositPda(username, tokenMint);
    const [destinationDeposit] = findDepositPda(recipient, tokenMint);
    await this.ensureDelegated(sourceUsernameDeposit, "claimUsernameDepositToDeposit-sourceUsernameDeposit");
    await this.ensureDelegated(destinationDeposit, "claimUsernameDepositToDeposit-destinationDeposit");
    const accounts = {
      user: recipient,
      sourceUsernameDeposit,
      destinationDeposit,
      tokenMint,
      session,
      tokenProgram: TOKEN_PROGRAM_ID
    };
    console.log("claimUsernameDepositToDeposit accounts:", prettyStringify(accounts));
    const connection = this.baseProgram.provider.connection;
    const [srcInfo, dstInfo, sessionInfo] = await Promise.all([
      connection.getAccountInfo(sourceUsernameDeposit),
      connection.getAccountInfo(destinationDeposit),
      connection.getAccountInfo(session)
    ]);
    console.log("claimUsernameDepositToDeposit sourceUsernameDeposit accountInfo:", prettyStringify({
      address: sourceUsernameDeposit.toBase58(),
      exists: !!srcInfo,
      owner: srcInfo?.owner?.toBase58(),
      lamports: srcInfo?.lamports,
      dataLen: srcInfo?.data?.length,
      executable: srcInfo?.executable
    }));
    console.log("claimUsernameDepositToDeposit destinationDeposit accountInfo:", prettyStringify({
      address: destinationDeposit.toBase58(),
      exists: !!dstInfo,
      owner: dstInfo?.owner?.toBase58(),
      lamports: dstInfo?.lamports,
      dataLen: dstInfo?.data?.length,
      executable: dstInfo?.executable
    }));
    console.log("claimUsernameDepositToDeposit session accountInfo:", prettyStringify({
      address: session.toBase58(),
      exists: !!sessionInfo,
      owner: sessionInfo?.owner?.toBase58(),
      lamports: sessionInfo?.lamports,
      dataLen: sessionInfo?.data?.length,
      executable: sessionInfo?.executable
    }));
    try {
      const sim = await this.ephemeralProgram.methods.claimUsernameDepositToDeposit(new BN(amount.toString())).accountsPartial(accounts).simulate();
      console.log("claimUsernameDepositToDeposit simulation logs:", sim.raw);
    } catch (simErr) {
      const simResponse = simErr.simulationResponse;
      console.error("claimUsernameDepositToDeposit simulate FAILED");
      console.error("  error message:", simErr instanceof Error ? simErr.message : String(simErr));
      if (simResponse) {
        console.error("  simulation err:", prettyStringify(simResponse.err));
        console.error("  simulation logs:", prettyStringify(simResponse.logs));
        console.error("  unitsConsumed:", simResponse.unitsConsumed);
      }
      throw simErr;
    }
    const signature = await this.ephemeralProgram.methods.claimUsernameDepositToDeposit(new BN(amount.toString())).accountsPartial(accounts).rpc({ skipPreflight: true, commitment: "confirmed" });
    return signature;
  }
  async createPermission(params) {
    const { user, tokenMint, payer, rpcOptions } = params;
    const [depositPda] = findDepositPda(user, tokenMint);
    const [permissionPda] = findPermissionPda(depositPda);
    await this.ensureNotDelegated(depositPda, "createPermission-depositPda");
    if (await this.permissionAccountExists(permissionPda)) {
      return null;
    }
    try {
      const signature = await this.baseProgram.methods.createPermission().accountsPartial({
        payer,
        user,
        deposit: depositPda,
        permission: permissionPda,
        permissionProgram: PERMISSION_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      }).rpc(rpcOptions);
      return signature;
    } catch (err) {
      if (this.isAccountAlreadyInUse(err)) {
        return "permission-exists";
      }
      throw err;
    }
  }
  async createUsernamePermission(params) {
    const { username, tokenMint, session, authority, payer, rpcOptions } = params;
    this.validateUsername(username);
    const [depositPda] = await findUsernameDepositPda(username, tokenMint);
    const [permissionPda] = findPermissionPda(depositPda);
    await this.ensureNotDelegated(depositPda, "createUsernamePermission-depositPda");
    if (await this.permissionAccountExists(permissionPda)) {
      return null;
    }
    try {
      const signature = await this.baseProgram.methods.createUsernamePermission().accountsPartial({
        payer,
        authority,
        deposit: depositPda,
        session,
        permission: permissionPda,
        permissionProgram: PERMISSION_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      }).rpc(rpcOptions);
      return signature;
    } catch (err) {
      if (this.isAccountAlreadyInUse(err)) {
        return "permission-exists";
      }
      throw err;
    }
  }
  async delegateDeposit(params) {
    const { user, tokenMint, payer, validator, rpcOptions } = params;
    const [depositPda] = findDepositPda(user, tokenMint);
    const [bufferPda] = findBufferPda(depositPda);
    const [delegationRecordPda] = findDelegationRecordPda(depositPda);
    const [delegationMetadataPda] = findDelegationMetadataPda(depositPda);
    await this.ensureNotDelegated(depositPda, "delegateDeposit-depositPda");
    const accounts = {
      payer,
      bufferDeposit: bufferPda,
      delegationRecordDeposit: delegationRecordPda,
      delegationMetadataDeposit: delegationMetadataPda,
      deposit: depositPda,
      validator,
      ownerProgram: PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId
    };
    const delegationWatcher = waitForAccountOwnerChange(this.baseProgram.provider.connection, depositPda, DELEGATION_PROGRAM_ID);
    let signature;
    try {
      console.log("delegateDeposit Accounts:", prettyStringify(accounts));
      signature = await this.baseProgram.methods.delegate(user, tokenMint).accountsPartial(accounts).rpc(rpcOptions);
      console.log("delegateDeposit: waiting for depositPda owner to be DELEGATION_PROGRAM_ID on base connection...");
      await delegationWatcher.wait();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }
    return signature;
  }
  async delegateUsernameDeposit(params) {
    const {
      username,
      tokenMint,
      payer,
      validator,
      rpcOptions
    } = params;
    this.validateUsername(username);
    const [depositPda] = await findUsernameDepositPda(username, tokenMint);
    const [bufferPda] = findBufferPda(depositPda);
    const [delegationRecordPda] = findDelegationRecordPda(depositPda);
    const [delegationMetadataPda] = findDelegationMetadataPda(depositPda);
    const usernameHash = await sha256hash(username);
    await this.ensureNotDelegated(depositPda, "delegateUsernameDeposit-depositPda");
    const accounts = {
      payer,
      bufferDeposit: bufferPda,
      delegationRecordDeposit: delegationRecordPda,
      delegationMetadataDeposit: delegationMetadataPda,
      deposit: depositPda,
      ownerProgram: PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId
    };
    accounts.validator = validator ?? null;
    const delegationWatcher = waitForAccountOwnerChange(this.baseProgram.provider.connection, depositPda, DELEGATION_PROGRAM_ID);
    let signature;
    try {
      console.log("delegateUsernameDeposit Accounts:", prettyStringify(accounts));
      signature = await this.baseProgram.methods.delegateUsernameDeposit(usernameHash, tokenMint).accountsPartial(accounts).rpc(rpcOptions);
      console.log("delegateUsernameDeposit: waiting for depositPda owner to be DELEGATION_PROGRAM_ID on base connection...");
      await delegationWatcher.wait();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }
    return signature;
  }
  async undelegateDeposit(params) {
    const {
      user,
      tokenMint,
      payer,
      sessionToken,
      magicProgram,
      magicContext,
      rpcOptions
    } = params;
    const [depositPda] = findDepositPda(user, tokenMint);
    await this.ensureDelegated(depositPda, "undelegateDeposit-depositPda", true);
    const accounts = {
      user,
      payer,
      deposit: depositPda,
      magicProgram,
      magicContext
    };
    accounts.sessionToken = sessionToken ?? null;
    const delegationWatcher = waitForAccountOwnerChange(this.baseProgram.provider.connection, depositPda, PROGRAM_ID);
    let signature;
    try {
      console.log("undelegateDeposit Accounts:", prettyStringify(accounts));
      signature = await this.ephemeralProgram.methods.undelegate().accountsPartial(accounts).rpc(rpcOptions);
      console.log("undelegateDeposit: waiting for depositPda owner to be PROGRAM_ID on base connection...");
      await delegationWatcher.wait();
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }
    return signature;
  }
  async undelegateUsernameDeposit(params) {
    const {
      username,
      tokenMint,
      session,
      payer,
      magicProgram,
      magicContext,
      rpcOptions
    } = params;
    this.validateUsername(username);
    const [depositPda] = await findUsernameDepositPda(username, tokenMint);
    await this.ensureDelegated(depositPda, "undelegateUsernameDeposit-depositPda");
    const usernameHash = await sha256hash(username);
    const signature = await this.ephemeralProgram.methods.undelegateUsernameDeposit(usernameHash, tokenMint).accountsPartial({
      payer,
      session,
      deposit: depositPda,
      magicProgram,
      magicContext
    }).rpc(rpcOptions);
    return signature;
  }
  async transferDeposit(params) {
    const {
      user,
      tokenMint,
      destinationUser,
      amount,
      payer,
      sessionToken,
      rpcOptions
    } = params;
    const [sourceDepositPda] = findDepositPda(user, tokenMint);
    const [destinationDepositPda] = findDepositPda(destinationUser, tokenMint);
    await this.ensureDelegated(sourceDepositPda, "transferDeposit-sourceDepositPda");
    await this.ensureDelegated(destinationDepositPda, "transferDeposit-destinationDepositPda");
    const accounts = {
      user,
      payer,
      sourceDeposit: sourceDepositPda,
      destinationDeposit: destinationDepositPda,
      tokenMint,
      systemProgram: SystemProgram.programId
    };
    accounts.sessionToken = sessionToken ?? null;
    console.log("transferDeposit Accounts:");
    Object.entries(accounts).forEach(([key, value]) => {
      console.log(key, value && value.toString());
    });
    console.log("-----");
    const signature = await this.ephemeralProgram.methods.transferDeposit(new BN(amount.toString())).accountsPartial(accounts).rpc(rpcOptions);
    return signature;
  }
  async transferToUsernameDeposit(params) {
    const {
      username,
      tokenMint,
      amount,
      user,
      payer,
      sessionToken,
      rpcOptions
    } = params;
    this.validateUsername(username);
    const [sourceDepositPda] = findDepositPda(user, tokenMint);
    const [destinationDepositPda] = await findUsernameDepositPda(username, tokenMint);
    await this.ensureDelegated(sourceDepositPda, "transferToUsernameDeposit-sourceDepositPda");
    await this.ensureDelegated(destinationDepositPda, "transferToUsernameDeposit-destinationDepositPda");
    const accounts = {
      user,
      payer,
      sourceDeposit: sourceDepositPda,
      destinationDeposit: destinationDepositPda,
      tokenMint,
      systemProgram: SystemProgram.programId
    };
    accounts.sessionToken = sessionToken ?? null;
    const signature = await this.ephemeralProgram.methods.transferToUsernameDeposit(new BN(amount.toString())).accountsPartial(accounts).rpc(rpcOptions);
    return signature;
  }
  async getBaseDeposit(user, tokenMint) {
    const [depositPda] = findDepositPda(user, tokenMint);
    try {
      const account = await this.baseProgram.account.deposit.fetch(depositPda);
      return {
        user: account.user,
        tokenMint: account.tokenMint,
        amount: BigInt(account.amount.toString()),
        address: depositPda
      };
    } catch {
      return null;
    }
  }
  async getEphemeralDeposit(user, tokenMint) {
    const [depositPda] = findDepositPda(user, tokenMint);
    try {
      const account = await this.ephemeralProgram.account.deposit.fetch(depositPda);
      return {
        user: account.user,
        tokenMint: account.tokenMint,
        amount: BigInt(account.amount.toString()),
        address: depositPda
      };
    } catch {
      return null;
    }
  }
  async getBaseUsernameDeposit(username, tokenMint) {
    const [depositPda] = await findUsernameDepositPda(username, tokenMint);
    try {
      const account = await this.baseProgram.account.usernameDeposit.fetch(depositPda);
      return {
        usernameHash: account.usernameHash,
        tokenMint: account.tokenMint,
        amount: BigInt(account.amount.toString()),
        address: depositPda
      };
    } catch {
      return null;
    }
  }
  async getEphemeralUsernameDeposit(username, tokenMint) {
    const [depositPda] = await findUsernameDepositPda(username, tokenMint);
    try {
      const account = await this.ephemeralProgram.account.usernameDeposit.fetch(depositPda);
      return {
        usernameHash: account.usernameHash,
        tokenMint: account.tokenMint,
        amount: BigInt(account.amount.toString()),
        address: depositPda
      };
    } catch {
      return null;
    }
  }
  get publicKey() {
    return this.wallet.publicKey;
  }
  getBaseProgram() {
    return this.baseProgram;
  }
  getEphemeralProgram() {
    return this.ephemeralProgram;
  }
  getProgramId() {
    return PROGRAM_ID;
  }
  validateUsername(username) {
    if (!username || username.length < 5 || username.length > 32) {
      throw new Error("Username must be between 5 and 32 characters");
    }
    if (!/^[a-z0-9_]+$/.test(username)) {
      throw new Error("Username can only contain lowercase alphanumeric characters and underscores");
    }
  }
  async permissionAccountExists(permission) {
    const info = await this.baseProgram.provider.connection.getAccountInfo(permission);
    return !!info && info.owner.equals(PERMISSION_PROGRAM_ID);
  }
  isAccountAlreadyInUse(error) {
    const message = error?.message ?? "";
    if (message.includes("already in use")) {
      return true;
    }
    const logs = error?.logs ?? error?.transactionLogs;
    if (Array.isArray(logs)) {
      return logs.some((log) => log.includes("already in use"));
    }
    return false;
  }
  async ensureNotDelegated(account, name, passNotExist) {
    const baseAccountInfo = await this.baseProgram.provider.connection.getAccountInfo(account);
    if (!baseAccountInfo) {
      if (passNotExist) {
        return;
      }
      const displayName2 = name ? `${name} - ` : "";
      throw new Error(`Account is not exists: ${displayName2}${account.toString()}`);
    }
    const ephemeralAccountInfo = await this.ephemeralProgram.provider.connection.getAccountInfo(account);
    const isDelegated = baseAccountInfo.owner.equals(DELEGATION_PROGRAM_ID);
    const displayName = name ? `${name} - ` : "";
    if (isDelegated) {
      console.error(`Account is delegated to ER: ${displayName}${account.toString()}`);
      const delegationStatus = await this.getDelegationStatus(account);
      console.error("/getDelegationStatus", JSON.stringify(delegationStatus, null, 2));
      console.error("baseAccountInfo", prettyStringify(baseAccountInfo));
      console.error("ephemeralAccountInfo", prettyStringify(ephemeralAccountInfo));
      const expectedValidator = this.getExpectedErValidator();
      const authority = delegationStatus.result?.delegationRecord?.authority;
      if (authority && authority !== expectedValidator.toString()) {
        console.error(`Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${authority}`);
      }
      throw new Error(`Account is delegated to ER: ${displayName}${account.toString()}`);
    }
  }
  async ensureDelegated(account, name, skipValidatorCheck) {
    const baseAccountInfo = await this.baseProgram.provider.connection.getAccountInfo(account);
    const ephemeralAccountInfo = await this.ephemeralProgram.provider.connection.getAccountInfo(account);
    if (!baseAccountInfo) {
      const displayName2 = name ? `${name} - ` : "";
      throw new Error(`Account is not exists: ${displayName2}${account.toString()}`);
    }
    const isDelegated = baseAccountInfo.owner.equals(DELEGATION_PROGRAM_ID);
    const displayName = name ? `${name} - ` : "";
    const delegationStatus = await this.getDelegationStatus(account);
    if (!isDelegated) {
      console.error(`Account is not delegated to ER: ${displayName}${account.toString()}`);
      console.error("/getDelegationStatus:", JSON.stringify(delegationStatus, null, 2));
      console.error("baseAccountInfo", prettyStringify(baseAccountInfo));
      console.error("ephemeralAccountInfo", prettyStringify(ephemeralAccountInfo));
      throw new Error(`Account is not delegated to ER: ${displayName}${account.toString()}`);
    } else if (!skipValidatorCheck && delegationStatus.result.delegationRecord.authority !== this.getExpectedErValidator().toString()) {
      console.error(`Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${delegationStatus.result.delegationRecord.authority}`);
      console.error("/getDelegationStatus:", JSON.stringify(delegationStatus, null, 2));
      console.error("baseAccountInfo", prettyStringify(baseAccountInfo));
      console.error("ephemeralAccountInfo", prettyStringify(ephemeralAccountInfo));
      throw new Error(`Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${delegationStatus.result.delegationRecord.authority}`);
    }
  }
  async getDelegationStatus(account) {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getDelegationStatus",
      params: [account.toString()]
    });
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    };
    const expectedValidator = this.getExpectedErValidator();
    const ephemeralUrl = this.ephemeralProgram.provider.connection.rpcEndpoint;
    const teeBaseUrl = ephemeralUrl.includes("mainnet-tee") ? "https://mainnet-tee.magicblock.app/" : "https://tee.magicblock.app/";
    try {
      const teeRes = await fetch(teeBaseUrl, options);
      const teeData = await teeRes.json();
      if (teeData.result?.isDelegated) {
        return {
          ...teeData,
          result: {
            ...teeData.result,
            delegationRecord: {
              authority: expectedValidator.toString()
            }
          }
        };
      }
    } catch (e) {
      console.error("[getDelegationStatus] TEE fetch failed, falling back to devnet-router: Options:", options, "Error:", e);
    }
    const routerBaseUrl = ephemeralUrl.includes("mainnet-tee") ? "https://router.magicblock.app/" : "https://devnet-router.magicblock.app/";
    const res = await fetch(routerBaseUrl, options);
    const routerData = await res.json();
    if (routerData.error?.message?.includes(expectedValidator.toString())) {
      return {
        ...routerData,
        result: {
          isDelegated: true,
          delegationRecord: {
            authority: expectedValidator.toString()
          }
        }
      };
    }
    return routerData;
  }
}
// index.ts
var IDL = telegram_private_transfer_default;
export {
  waitForAccountOwnerChange,
  solToLamports,
  lamportsToSol,
  isWalletLike,
  isKeypair,
  isAnchorProvider,
  getErValidatorForSolanaEnv,
  getErValidatorForRpcEndpoint,
  findVaultPda,
  findUsernameDepositPda,
  findPermissionPda,
  findDepositPda,
  findDelegationRecordPda,
  findDelegationMetadataPda,
  findBufferPda,
  VAULT_SEED_BYTES,
  VAULT_SEED,
  USERNAME_DEPOSIT_SEED_BYTES,
  USERNAME_DEPOSIT_SEED,
  PROGRAM_ID,
  PERMISSION_SEED_BYTES,
  PERMISSION_SEED,
  PERMISSION_PROGRAM_ID,
  MAGIC_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  LoyalPrivateTransactionsClient,
  LAMPORTS_PER_SOL,
  IDL,
  ER_VALIDATOR_MAINNET,
  ER_VALIDATOR_DEVNET,
  ER_VALIDATOR,
  DEPOSIT_SEED_BYTES,
  DEPOSIT_SEED,
  DELEGATION_PROGRAM_ID
};
