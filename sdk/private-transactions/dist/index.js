// src/LoyalPrivateTransactionsClient.ts
import {
  Connection as Connection3,
  PublicKey as PublicKey6,
  SystemProgram as SystemProgram5,
  Transaction as Transaction7
} from "@solana/web3.js";
import { AnchorProvider, BN as BN2, Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID as TOKEN_PROGRAM_ID4 } from "@solana/spl-token";
import {
  verifyTeeIntegrity,
  getAuthToken
} from "@magicblock-labs/ephemeral-rollups-sdk";
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
    },
    {
      code: 6012,
      name: "InvalidKaminoAccounts",
      msg: "Invalid Kamino accounts"
    },
    {
      code: 6013,
      name: "InvalidAmount",
      msg: "Invalid amount"
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
            docs: [
              "For USDC deposits, this stores the Kamino share token amount.",
              "For all other mints, this stores the deposited liquidity token amount."
            ],
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
            docs: [
              "For USDC deposits, this stores the Kamino share token amount.",
              "For all other mints, this stores the deposited liquidity token amount."
            ],
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
import {
  PublicKey,
  LAMPORTS_PER_SOL,
  SYSVAR_INSTRUCTIONS_PUBKEY
} from "@solana/web3.js";
var ER_VALIDATOR_DEVNET = new PublicKey("FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA");
var ER_VALIDATOR_MAINNET = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
var ER_VALIDATOR = ER_VALIDATOR_DEVNET;
function getErValidatorForSolanaEnv(env) {
  return env === "mainnet" ? ER_VALIDATOR_MAINNET : ER_VALIDATOR_DEVNET;
}
function getErValidatorForRpcEndpoint(perRpcEndpoint) {
  return perRpcEndpoint.includes("mainnet-tee") ? ER_VALIDATOR_MAINNET : ER_VALIDATOR_DEVNET;
}
function getKaminoModifyBalanceAccountsForTokenMint(tokenMint) {
  if (tokenMint.equals(USDC_MINT_MAINNET)) {
    return KAMINO_MODIFY_BALANCE_ACCOUNTS_MAINNET;
  }
  if (tokenMint.equals(USDC_MINT_DEVNET)) {
    return KAMINO_MODIFY_BALANCE_ACCOUNTS_DEVNET;
  }
  return null;
}
var PROGRAM_ID = new PublicKey("97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV");
var USDC_MINT_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
var USDC_MINT_MAINNET = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
var KLEND_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
var DEVNET_LENDING_MARKET = new PublicKey("27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J");
var MAINNET_LENDING_MARKET = new PublicKey("CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA");
var KAMINO_MODIFY_BALANCE_ACCOUNTS_DEVNET = {
  lendingMarket: DEVNET_LENDING_MARKET,
  lendingMarketAuthority: PublicKey.findProgramAddressSync([Buffer.from("lma"), DEVNET_LENDING_MARKET.toBuffer()], KLEND_PROGRAM_ID)[0],
  reserve: new PublicKey("9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy"),
  reserveLiquiditySupply: new PublicKey("Bh45cPkpfRvz9hAs23ye5TowsGbhbh4BXT4AGww8JfES"),
  reserveCollateralMint: new PublicKey("8GoBXfEq3aTiWTxEP2tAaygJMx3LhG764iN5e6gqaLA"),
  liquidityDecimals: 6,
  instructionSysvarAccount: SYSVAR_INSTRUCTIONS_PUBKEY,
  klendProgram: KLEND_PROGRAM_ID
};
var KAMINO_MODIFY_BALANCE_ACCOUNTS_MAINNET = {
  lendingMarket: MAINNET_LENDING_MARKET,
  lendingMarketAuthority: PublicKey.findProgramAddressSync([Buffer.from("lma"), MAINNET_LENDING_MARKET.toBuffer()], KLEND_PROGRAM_ID)[0],
  reserve: new PublicKey("9GJ9GBRwCp4pHmWrQ43L5xpc9Vykg7jnfwcFGN8FoHYu"),
  reserveLiquiditySupply: new PublicKey("H6JUwz8c61eQnYUx8avGXydKztKPyGvgWAUjmZUPS3BC"),
  reserveCollateralMint: new PublicKey("DKaVQFXD6Qz4USTkRWyPun3oU6r1RfYsWJ8YqLpnSnN5"),
  liquidityDecimals: 6,
  instructionSysvarAccount: SYSVAR_INSTRUCTIONS_PUBKEY,
  klendProgram: KLEND_PROGRAM_ID
};
function isKaminoMainnetModifyBalanceAccounts(accounts) {
  return accounts.lendingMarket.equals(MAINNET_LENDING_MARKET);
}
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

// src/kamino.ts
var KAMINO_RESERVE_DISCRIMINATOR = Buffer.from([
  43,
  242,
  204,
  202,
  26,
  247,
  59,
  127
]);
var KAMINO_FRACTION_BITS = 60n;
var KAMINO_FRACTION_SCALE = 1n << KAMINO_FRACTION_BITS;
function bytesEqual(a, b) {
  if (a.length !== b.length)
    return false;
  for (let i = 0;i < a.length; i++) {
    if (a[i] !== b[i])
      return false;
  }
  return true;
}
var KAMINO_DISCRIMINATOR_OFFSET = 8;
var KAMINO_RESERVE_LAYOUT_OFFSETS = {
  liquidityAvailableAmount: KAMINO_DISCRIMINATOR_OFFSET + 216,
  liquidityBorrowedAmountSf: KAMINO_DISCRIMINATOR_OFFSET + 224,
  liquidityMintDecimals: KAMINO_DISCRIMINATOR_OFFSET + 264,
  liquidityAccumulatedProtocolFeesSf: KAMINO_DISCRIMINATOR_OFFSET + 336,
  liquidityAccumulatedReferrerFeesSf: KAMINO_DISCRIMINATOR_OFFSET + 352,
  liquidityPendingReferrerFeesSf: KAMINO_DISCRIMINATOR_OFFSET + 368,
  collateralMintTotalSupply: KAMINO_DISCRIMINATOR_OFFSET + 2584
};
function readUint64LE(data, offset) {
  return data.readBigUInt64LE(offset);
}
function readUint128LE(data, offset) {
  const low = data.readBigUInt64LE(offset);
  const high = data.readBigUInt64LE(offset + 8);
  return low + (high << 64n);
}
function toRawBigInt(value) {
  return typeof value === "bigint" ? value : BigInt(value);
}
function divCeil(numerator, denominator) {
  if (denominator === 0n) {
    throw new Error("Cannot divide by zero");
  }
  return (numerator + denominator - 1n) / denominator;
}
function parseKaminoReserveSnapshotFromAccountData(args) {
  const { reserve, tokenMint } = args;
  const data = Buffer.isBuffer(args.data) ? args.data : Buffer.from(args.data);
  if (data.length < 8 || !bytesEqual(data.subarray(0, 8), KAMINO_RESERVE_DISCRIMINATOR)) {
    throw new Error(`Kamino reserve ${reserve.toBase58()} has an invalid discriminator`);
  }
  const requiredLength = KAMINO_RESERVE_LAYOUT_OFFSETS.collateralMintTotalSupply + 8;
  if (data.length < requiredLength) {
    throw new Error(`Kamino reserve ${reserve.toBase58()} is too small: expected at least ${requiredLength} bytes`);
  }
  const liquidityAvailableAmount = readUint64LE(data, KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityAvailableAmount);
  const liquidityBorrowedAmountSf = readUint128LE(data, KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityBorrowedAmountSf);
  const liquidityAccumulatedProtocolFeesSf = readUint128LE(data, KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityAccumulatedProtocolFeesSf);
  const liquidityAccumulatedReferrerFeesSf = readUint128LE(data, KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityAccumulatedReferrerFeesSf);
  const liquidityPendingReferrerFeesSf = readUint128LE(data, KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityPendingReferrerFeesSf);
  const collateralSupplyRaw = readUint64LE(data, KAMINO_RESERVE_LAYOUT_OFFSETS.collateralMintTotalSupply);
  const liquidityDecimals = Number(readUint64LE(data, KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityMintDecimals));
  const grossLiquiditySupplyScaled = (liquidityAvailableAmount << KAMINO_FRACTION_BITS) + liquidityBorrowedAmountSf;
  const totalFeeAmountScaled = liquidityAccumulatedProtocolFeesSf + liquidityAccumulatedReferrerFeesSf + liquidityPendingReferrerFeesSf;
  return {
    reserve,
    tokenMint,
    liquidityDecimals,
    collateralSupplyRaw,
    totalLiquiditySupplyScaled: grossLiquiditySupplyScaled > totalFeeAmountScaled ? grossLiquiditySupplyScaled - totalFeeAmountScaled : 0n,
    collateralExchangeRateSf: collateralSupplyRaw === 0n || grossLiquiditySupplyScaled <= totalFeeAmountScaled ? KAMINO_FRACTION_SCALE : collateralSupplyRaw * KAMINO_FRACTION_SCALE * KAMINO_FRACTION_SCALE / (grossLiquiditySupplyScaled - totalFeeAmountScaled)
  };
}
function calculateKaminoRedeemableLiquidityAmountRaw(snapshot, shareAmountRaw) {
  const shareAmount = toRawBigInt(shareAmountRaw);
  if (shareAmount <= 0n) {
    return 0n;
  }
  if (snapshot.collateralSupplyRaw === 0n || snapshot.totalLiquiditySupplyScaled === 0n) {
    return shareAmount;
  }
  const numerator = shareAmount * snapshot.totalLiquiditySupplyScaled;
  const denominator = snapshot.collateralSupplyRaw * KAMINO_FRACTION_SCALE;
  return numerator / denominator;
}
function calculateKaminoShareAmountForLiquidityAmountRaw(args) {
  const liquidityAmount = toRawBigInt(args.liquidityAmountRaw);
  if (liquidityAmount <= 0n) {
    return 0n;
  }
  if (args.snapshot.collateralSupplyRaw === 0n || args.snapshot.totalLiquiditySupplyScaled === 0n) {
    return liquidityAmount;
  }
  const numerator = liquidityAmount * args.snapshot.collateralSupplyRaw * KAMINO_FRACTION_SCALE;
  return args.rounding === "ceil" ? divCeil(numerator, args.snapshot.totalLiquiditySupplyScaled) : numerator / args.snapshot.totalLiquiditySupplyScaled;
}
function calculateKaminoCollateralExchangeRateSfFromAmounts(args) {
  const collateralAmount = toRawBigInt(args.collateralAmount);
  const liquidityAmount = toRawBigInt(args.liquidityAmount);
  if (collateralAmount <= 0n || liquidityAmount <= 0n) {
    return null;
  }
  return collateralAmount * KAMINO_FRACTION_SCALE / liquidityAmount;
}
function calculateKaminoCollateralValuation(args) {
  const currentLiquidityAmount = calculateKaminoRedeemableLiquidityAmountRaw(args.snapshot, args.collateralAmount);
  let principalLiquidityAmount = args.principalLiquidityAmount == null ? null : toRawBigInt(args.principalLiquidityAmount);
  if (principalLiquidityAmount === null && args.shieldCollateralExchangeRateSf != null) {
    const shieldRate = toRawBigInt(args.shieldCollateralExchangeRateSf);
    if (shieldRate > 0n) {
      principalLiquidityAmount = toRawBigInt(args.collateralAmount) * KAMINO_FRACTION_SCALE / shieldRate;
    }
  }
  return {
    currentLiquidityAmount,
    principalLiquidityAmount,
    earnedLiquidityAmount: principalLiquidityAmount === null ? null : currentLiquidityAmount - principalLiquidityAmount
  };
}
async function fetchKaminoReserveSnapshot(args) {
  const kaminoAccounts = args.kaminoAccounts ?? getKaminoModifyBalanceAccountsForTokenMint(args.tokenMint);
  if (!kaminoAccounts) {
    return null;
  }
  const accountInfo = await args.connection.getAccountInfo(kaminoAccounts.reserve, "confirmed");
  if (!accountInfo) {
    throw new Error(`Kamino reserve ${kaminoAccounts.reserve.toBase58()} was not found`);
  }
  return parseKaminoReserveSnapshotFromAccountData({
    data: accountInfo.data,
    reserve: kaminoAccounts.reserve,
    tokenMint: args.tokenMint
  });
}

// src/pda.ts
import { PublicKey as PublicKey3 } from "@solana/web3.js";

// src/utils.ts
import { PublicKey as PublicKey2 } from "@solana/web3.js";
function prettyStringify(obj) {
  const json = JSON.stringify(obj, (_key, value) => {
    if (value instanceof PublicKey2)
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
function waitForAccountOwnerChange(connection, account, expectedOwner, timeoutMs = 15000, intervalMs = 1000) {
  let skipWait;
  const subId = connection.onAccountChange(account, (accountInfo) => {
    if (accountInfo.owner.equals(expectedOwner) && skipWait) {
      console.log(`waitForAccountOwnerChange: ${account.toString()} - short-circuit polling wait`);
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
async function sha256hash(data) {
  const encoded = Uint8Array.from(new TextEncoder().encode(data));
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash));
}
function validateUsername(username) {
  if (!username || username.length < 5 || username.length > 32) {
    throw new Error("Username must be between 5 and 32 characters");
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    throw new Error("Username can only contain lowercase alphanumeric characters and underscores");
  }
}

// src/pda.ts
function findDepositPda(user, tokenMint, programId = PROGRAM_ID) {
  return PublicKey3.findProgramAddressSync([DEPOSIT_SEED_BYTES, user.toBuffer(), tokenMint.toBuffer()], programId);
}
async function findUsernameDepositPda(username, tokenMint, programId = PROGRAM_ID) {
  const usernameHash = await sha256hash(username);
  return PublicKey3.findProgramAddressSync([
    USERNAME_DEPOSIT_SEED_BYTES,
    Buffer.from(usernameHash),
    tokenMint.toBuffer()
  ], programId);
}
function findVaultPda(tokenMint, programId = PROGRAM_ID) {
  return PublicKey3.findProgramAddressSync([VAULT_SEED_BYTES, tokenMint.toBuffer()], programId);
}
function findPermissionPda(account, permissionProgramId = PERMISSION_PROGRAM_ID) {
  return PublicKey3.findProgramAddressSync([PERMISSION_SEED_BYTES, account.toBuffer()], permissionProgramId);
}
function findDelegationRecordPda(account, delegationProgramId = DELEGATION_PROGRAM_ID) {
  return PublicKey3.findProgramAddressSync([Buffer.from("delegation"), account.toBuffer()], delegationProgramId);
}
function findDelegationMetadataPda(account, delegationProgramId = DELEGATION_PROGRAM_ID) {
  return PublicKey3.findProgramAddressSync([Buffer.from("delegation-metadata"), account.toBuffer()], delegationProgramId);
}
function findBufferPda(account, ownerProgramId = PROGRAM_ID) {
  return PublicKey3.findProgramAddressSync([Buffer.from("buffer"), account.toBuffer()], ownerProgramId);
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

// src/webcrypto.ts
var ED25519_ALGORITHM = { name: "Ed25519" };
var NODE_CRYPTO_SPECIFIER = "node:crypto";
var subtleCryptoPromise = null;
function getNodeProcess() {
  return globalThis.process;
}
async function loadNodeWebCrypto() {
  if (typeof getNodeProcess()?.versions?.node !== "string") {
    return null;
  }
  const nodeCrypto = await import(NODE_CRYPTO_SPECIFIER);
  return nodeCrypto.webcrypto ?? null;
}
async function loadSubtleCrypto() {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  const nodeWebCrypto = await loadNodeWebCrypto();
  if (nodeWebCrypto?.subtle) {
    return nodeWebCrypto.subtle;
  }
  throw new Error("Web Crypto Ed25519 signing is not available in this runtime");
}
async function getSubtleCrypto() {
  subtleCryptoPromise ??= loadSubtleCrypto();
  return subtleCryptoPromise;
}
function bytesToBase64Url(bytes) {
  let base64;
  if (typeof Buffer !== "undefined") {
    base64 = Buffer.from(bytes).toString("base64");
  } else {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
async function importKeypairPrivateKey(keypair) {
  const privateScalar = keypair.secretKey.slice(0, 32);
  if (privateScalar.byteLength !== 32) {
    throw new Error("Expected Keypair secret key to contain a 32-byte seed");
  }
  const subtle = await getSubtleCrypto();
  return subtle.importKey("jwk", {
    crv: "Ed25519",
    d: bytesToBase64Url(privateScalar),
    ext: false,
    kty: "OKP",
    x: bytesToBase64Url(keypair.publicKey.toBytes())
  }, ED25519_ALGORITHM, false, ["sign"]);
}
function createKeypairMessageSigner(keypair) {
  let privateKeyPromise = null;
  const getPrivateKey = () => {
    privateKeyPromise ??= importKeypairPrivateKey(keypair);
    return privateKeyPromise;
  };
  return async (message) => {
    const [subtle, privateKey] = await Promise.all([
      getSubtleCrypto(),
      getPrivateKey()
    ]);
    const signature = await subtle.sign(ED25519_ALGORITHM, privateKey, message);
    return new Uint8Array(signature);
  };
}

// src/actions/shieldTokens.ts
import { NATIVE_MINT as NATIVE_MINT2 } from "@solana/spl-token";
import {
  Transaction as Transaction4
} from "@solana/web3.js";

// src/rent-estimate.ts
import { ACCOUNT_SIZE, getAssociatedTokenAddressSync } from "@solana/spl-token";
var DISCRIMINATOR_SIZE = 8;
var PUBLIC_KEY_SIZE = 32;
var U64_SIZE = 8;
var U8_SIZE = 1;
var BOOL_SIZE = 1;
var VEC_PREFIX_SIZE = 4;
var DEPOSIT_ACCOUNT_SIZE = DISCRIMINATOR_SIZE + PUBLIC_KEY_SIZE + PUBLIC_KEY_SIZE + U64_SIZE;
var VAULT_ACCOUNT_SIZE = DISCRIMINATOR_SIZE + U8_SIZE;
var PERMISSION_ACCOUNT_SIZE = 567;
var DELEGATION_RECORD_ACCOUNT_SIZE = DISCRIMINATOR_SIZE + PUBLIC_KEY_SIZE + PUBLIC_KEY_SIZE + U64_SIZE * 3;
function getDelegationMetadataAccountSize(seeds) {
  return DISCRIMINATOR_SIZE + U64_SIZE + BOOL_SIZE + PUBLIC_KEY_SIZE + VEC_PREFIX_SIZE + seeds.reduce((total, seed) => total + VEC_PREFIX_SIZE + seed.byteLength, 0);
}
async function estimateNewAccountRentLamports(params) {
  if (params.accounts.length === 0) {
    return 0;
  }
  const spaces = Array.from(new Set(params.accounts.map((account) => account.space)));
  const [accountInfos, rentEntries] = await Promise.all([
    params.connection.getMultipleAccountsInfo(params.accounts.map((account) => account.address)),
    Promise.all(spaces.map(async (space) => [
      space,
      await params.connection.getMinimumBalanceForRentExemption(space)
    ]))
  ]);
  const rentBySpace = new Map(rentEntries);
  return params.accounts.reduce((total, account, index) => {
    if (!account.forceCreate && accountInfos[index]) {
      return total;
    }
    return total + (rentBySpace.get(account.space) ?? 0);
  }, 0);
}
async function estimateDepositRentLamports(params) {
  return estimateNewAccountRentLamports({
    connection: params.connection,
    accounts: [
      {
        address: params.depositPda,
        space: DEPOSIT_ACCOUNT_SIZE,
        forceCreate: params.forceCreate
      }
    ]
  });
}
async function estimateModifyBalanceRentLamports(params) {
  const [vaultPda] = findVaultPda(params.tokenMint);
  const userTokenAccount = getAssociatedTokenAddressSync(params.tokenMint, params.user);
  const vaultTokenAccount = getAssociatedTokenAddressSync(params.tokenMint, vaultPda, true);
  const accounts = [
    { address: vaultPda, space: VAULT_ACCOUNT_SIZE },
    { address: vaultTokenAccount, space: ACCOUNT_SIZE }
  ];
  if (!params.isNativeSol) {
    accounts.push({ address: userTokenAccount, space: ACCOUNT_SIZE });
  }
  return estimateNewAccountRentLamports({
    connection: params.connection,
    accounts
  });
}
async function estimatePermissionRentLamports(params) {
  return estimateNewAccountRentLamports({
    connection: params.connection,
    accounts: [
      {
        address: params.permissionPda,
        space: PERMISSION_ACCOUNT_SIZE,
        forceCreate: params.forceCreate
      }
    ]
  });
}
async function estimateDepositDelegationRentLamports(params) {
  const [delegationRecordPda] = findDelegationRecordPda(params.depositPda);
  const [delegationMetadataPda] = findDelegationMetadataPda(params.depositPda);
  const metadataSize = getDelegationMetadataAccountSize([
    DEPOSIT_SEED_BYTES,
    params.user.toBuffer(),
    params.tokenMint.toBuffer()
  ]);
  return estimateNewAccountRentLamports({
    connection: params.connection,
    accounts: [
      {
        address: delegationRecordPda,
        space: DELEGATION_RECORD_ACCOUNT_SIZE,
        forceCreate: params.forceCreate
      },
      {
        address: delegationMetadataPda,
        space: metadataSize,
        forceCreate: params.forceCreate
      }
    ]
  });
}

// src/checks/enshureChecks.ts
import { DELEGATION_PROGRAM_ID as DELEGATION_PROGRAM_ID2 } from "@magicblock-labs/ephemeral-rollups-sdk";
var ENSURE_FETCH_MAX_ATTEMPTS = 3;
var ENSURE_FETCH_INITIAL_DELAY_MS = 150;
var ENSURE_FETCH_MAX_DELAY_MS = 1000;
var ENSURE_FETCH_BACKOFF_MULTIPLIER = 2;
var ENSURE_FETCH_JITTER_RATIO = 0.2;
var MULTIPLE_ACCOUNTS_CHUNK_SIZE = 5;
async function processEnsureChecks(baseConnection, perConnection, ensure) {
  const mergedChecks = new Map;
  for (const { address, delegated, passNotExist, label } of ensure) {
    const addressKey = address.toBase58();
    const existing = mergedChecks.get(addressKey);
    if (!existing) {
      mergedChecks.set(addressKey, {
        address,
        delegated,
        passNotExist,
        labels: [label]
      });
      continue;
    }
    existing.labels.push(label);
    if (existing.delegated !== delegated) {
      throw new Error(`Conflicting ensure delegation requirements: ${existing.labels.join(", ")} - ${addressKey}`);
    }
    existing.passNotExist = existing.passNotExist && passNotExist;
  }
  const cache = {
    baseAccountInfos: new Map,
    delegationStatuses: new Map,
    ephemeralAccountInfos: new Map
  };
  const uniqueChecks = [...mergedChecks.values()];
  await primeEnsureBatchCache(baseConnection, perConnection, uniqueChecks, cache);
  for (const { address, delegated, passNotExist, labels } of uniqueChecks) {
    const displayLabels = labels.join(", ");
    if (delegated) {
      await ensureDelegated(baseConnection, perConnection, address, displayLabels, undefined, cache);
    } else {
      await ensureNotDelegated(baseConnection, perConnection, address, displayLabels, passNotExist, cache);
    }
  }
}
async function primeEnsureBatchCache(baseConnection, perConnection, checks, cache) {
  const addresses = checks.map((check) => check.address);
  const [baseAccountInfos, ephemeralAccountInfos] = await Promise.all([
    getMultipleAccountsInfoWithRetry(baseConnection, addresses, "base-getMultipleAccountsInfo"),
    getMultipleAccountsInfoWithRetry(perConnection, addresses, "ephemeral-getMultipleAccountsInfo")
  ]);
  for (let index = 0;index < checks.length; index += 1) {
    const addressKey = checks[index].address.toBase58();
    cache.baseAccountInfos.set(addressKey, baseAccountInfos[index] ?? null);
    cache.ephemeralAccountInfos.set(addressKey, ephemeralAccountInfos[index] ?? null);
  }
}
async function getMultipleAccountsInfoWithRetry(connection, accounts, label) {
  if (accounts.length === 0) {
    return [];
  }
  const chunks = [];
  for (let start = 0;start < accounts.length; start += MULTIPLE_ACCOUNTS_CHUNK_SIZE) {
    chunks.push(accounts.slice(start, start + MULTIPLE_ACCOUNTS_CHUNK_SIZE));
  }
  const chunkResults = await Promise.all(chunks.map((chunk, index) => runEnsureFetchWithRetry(`${label}-chunk-${index + 1}`, () => connection.getMultipleAccountsInfo(chunk))));
  return chunkResults.flat();
}
async function ensureNotDelegated(baseConnection, perConnection, account, name, passNotExist, cache) {
  const baseAccountInfo = await getEnsureBaseAccountInfo(baseConnection, account, cache);
  if (!baseAccountInfo) {
    if (passNotExist) {
      return;
    }
    const displayName2 = formatEnsureDisplayName(name);
    throw new Error(`Account is not exists: ${displayName2}${account.toString()}`);
  }
  const isDelegated = baseAccountInfo.owner.equals(DELEGATION_PROGRAM_ID2);
  const displayName = formatEnsureDisplayName(name);
  if (isDelegated) {
    const [ephemeralAccountInfo, delegationStatus] = await Promise.all([
      getEnsureEphemeralAccountInfo(perConnection, account, cache),
      getEnsureDelegationStatus(perConnection.rpcEndpoint, account, cache)
    ]);
    console.error(`Account is delegated to ER: ${displayName}${account.toString()}`);
    console.error("/getDelegationStatus", JSON.stringify(delegationStatus, null, 2));
    console.error("baseAccountInfo", prettyStringify(baseAccountInfo));
    console.error("ephemeralAccountInfo", prettyStringify(ephemeralAccountInfo));
    const expectedValidator = getErValidatorForRpcEndpoint(perConnection.rpcEndpoint);
    const authority = delegationStatus.result?.delegationRecord?.authority;
    if (authority && authority !== expectedValidator.toString()) {
      console.error(`Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${authority}`);
    }
    throw new Error(`Account is delegated to ER: ${displayName}${account.toString()}`);
  }
}
async function ensureDelegated(baseConnection, perConnection, account, name, skipValidatorCheck, cache) {
  const baseAccountInfo = await getEnsureBaseAccountInfo(baseConnection, account, cache);
  if (!baseAccountInfo) {
    const displayName2 = formatEnsureDisplayName(name);
    throw new Error(`Account is not exists: ${displayName2}${account.toString()}`);
  }
  const isDelegated = baseAccountInfo.owner.equals(DELEGATION_PROGRAM_ID2);
  const displayName = formatEnsureDisplayName(name);
  if (!isDelegated) {
    const [ephemeralAccountInfo, delegationStatus] = await Promise.all([
      getEnsureEphemeralAccountInfo(perConnection, account, cache),
      getEnsureDelegationStatus(perConnection.rpcEndpoint, account, cache)
    ]);
    console.error(`Account is not delegated to ER: ${displayName}${account.toString()}`);
    console.error("/getDelegationStatus:", JSON.stringify(delegationStatus, null, 2));
    console.error("baseAccountInfo", prettyStringify(baseAccountInfo));
    console.error("ephemeralAccountInfo", prettyStringify(ephemeralAccountInfo));
    throw new Error(`Account is not delegated to ER: ${displayName}${account.toString()}`);
  }
  if (!skipValidatorCheck) {
    const [ephemeralAccountInfo, delegationStatus] = await Promise.all([
      getEnsureEphemeralAccountInfo(perConnection, account, cache),
      getEnsureDelegationStatus(perConnection.rpcEndpoint, account, cache)
    ]);
    if (delegationStatus.result.delegationRecord.authority !== getErValidatorForRpcEndpoint(perConnection.rpcEndpoint).toString()) {
      console.error(`Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${delegationStatus.result.delegationRecord.authority}`);
      console.error("/getDelegationStatus:", JSON.stringify(delegationStatus, null, 2));
      console.error("baseAccountInfo", prettyStringify(baseAccountInfo));
      console.error("ephemeralAccountInfo", prettyStringify(ephemeralAccountInfo));
      throw new Error(`Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${delegationStatus.result.delegationRecord.authority}`);
    }
  }
}
async function getEnsureBaseAccountInfo(baseConnection, account, cache) {
  const addressKey = account.toBase58();
  if (cache?.baseAccountInfos.has(addressKey)) {
    return cache.baseAccountInfos.get(addressKey) ?? null;
  }
  const baseAccountInfo = await baseConnection.getAccountInfo(account);
  cache?.baseAccountInfos.set(addressKey, baseAccountInfo);
  return baseAccountInfo;
}
async function getEnsureEphemeralAccountInfo(perConnection, account, cache) {
  const addressKey = account.toBase58();
  if (cache?.ephemeralAccountInfos.has(addressKey)) {
    return cache.ephemeralAccountInfos.get(addressKey) ?? null;
  }
  const ephemeralAccountInfo = await perConnection.getAccountInfo(account);
  cache?.ephemeralAccountInfos.set(addressKey, ephemeralAccountInfo);
  return ephemeralAccountInfo;
}
async function getEnsureDelegationStatus(perRpcEndpoint, account, cache) {
  const addressKey = account.toBase58();
  const cachedPromise = cache?.delegationStatuses.get(addressKey);
  if (cachedPromise) {
    return cachedPromise;
  }
  const request = getDelegationStatus(perRpcEndpoint, account);
  cache?.delegationStatuses.set(addressKey, request);
  return request;
}
async function runEnsureFetchWithRetry(label, task) {
  let nextDelayMs = ENSURE_FETCH_INITIAL_DELAY_MS;
  let lastError;
  for (let attempt = 1;attempt <= ENSURE_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === ENSURE_FETCH_MAX_ATTEMPTS) {
        break;
      }
      console.warn(`[ensure] ${label} attempt ${attempt}/${ENSURE_FETCH_MAX_ATTEMPTS} failed: ${error?.message ?? String(error)}`);
      const jitter = nextDelayMs * ENSURE_FETCH_JITTER_RATIO;
      const jitteredDelay = Math.max(0, Math.round(nextDelayMs + (Math.random() * 2 - 1) * jitter));
      await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
      nextDelayMs = Math.min(ENSURE_FETCH_MAX_DELAY_MS, Math.round(nextDelayMs * ENSURE_FETCH_BACKOFF_MULTIPLIER));
    }
  }
  throw new Error(`[ensure] ${label} failed after ${ENSURE_FETCH_MAX_ATTEMPTS} attempts: ${lastError?.message ?? String(lastError)}`);
}
async function getDelegationStatus(perRpcEndpoint, account) {
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
  const expectedValidator = getErValidatorForRpcEndpoint(perRpcEndpoint);
  const isMainnet = perRpcEndpoint.includes("mainnet-tee");
  const teeBaseUrl = isMainnet ? "https://mainnet-tee.magicblock.app/" : "https://tee.magicblock.app/";
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
  const routerBaseUrl = isMainnet ? "https://router.magicblock.app/" : "https://devnet-router.magicblock.app/";
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
function formatEnsureDisplayName(name) {
  return name ? `${name} - ` : "";
}

// src/wsol.ts
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync as getAssociatedTokenAddressSync2,
  NATIVE_MINT
} from "@solana/spl-token";
import {
  SystemProgram
} from "@solana/web3.js";
function wrapSolToWsolIx({
  user,
  payer,
  lamports
}) {
  const wsolAta = getAssociatedTokenAddressSync2(NATIVE_MINT, user);
  return [
    createAssociatedTokenAccountIdempotentInstruction(payer, wsolAta, user, NATIVE_MINT),
    SystemProgram.transfer({
      fromPubkey: user,
      toPubkey: wsolAta,
      lamports
    }),
    createSyncNativeInstruction(wsolAta)
  ];
}
function closeWsolAta({
  user,
  destination
}) {
  const wsolAta = getAssociatedTokenAddressSync2(NATIVE_MINT, user);
  return createCloseAccountInstruction(wsolAta, destination, user);
}

// src/transaction-debug.ts
import {
  SendTransactionError
} from "@solana/web3.js";
var MULTIPLE_ACCOUNTS_CHUNK_SIZE2 = 10;
function describeAccountInfo(accountInfo) {
  if (!accountInfo) {
    return {
      exists: false,
      owner: null,
      executable: null,
      lamports: null,
      dataLength: null,
      rentEpoch: null
    };
  }
  return {
    exists: true,
    owner: accountInfo.owner.toBase58(),
    executable: accountInfo.executable,
    lamports: accountInfo.lamports,
    dataLength: accountInfo.data?.length ?? null,
    rentEpoch: accountInfo.rentEpoch ?? null
  };
}
function extractInlineTransactionLogs(error) {
  const logs = error?.logs ?? error?.transactionLogs;
  return Array.isArray(logs) ? logs : undefined;
}
async function getTransactionErrorLogs(error, connection) {
  const inlineLogs = extractInlineTransactionLogs(error);
  if (inlineLogs) {
    return inlineLogs;
  }
  if (error instanceof SendTransactionError) {
    try {
      const fetchedLogs = await error.getLogs(connection);
      if (Array.isArray(fetchedLogs)) {
        return fetchedLogs;
      }
    } catch (fetchError) {
      console.error("[tx-debug] failed to fetch logs via SendTransactionError.getLogs()", {
        errorName: fetchError?.name ?? "UnknownError",
        errorMessage: fetchError?.message ?? String(fetchError)
      });
    }
  }
  return;
}
function collectTransactionAccounts(tx) {
  const uniqueAccounts = new Map;
  if (tx.feePayer) {
    uniqueAccounts.set(tx.feePayer.toBase58(), tx.feePayer);
  }
  for (const instruction of tx.instructions) {
    uniqueAccounts.set(instruction.programId.toBase58(), instruction.programId);
    for (const key of instruction.keys) {
      uniqueAccounts.set(key.pubkey.toBase58(), key.pubkey);
    }
  }
  return [...uniqueAccounts.values()];
}
function describeTransaction(tx) {
  const compiledMessage = tx.compileMessage();
  const accountKeys = compiledMessage.accountKeys;
  const signedWritableCount = compiledMessage.header.numRequiredSignatures - compiledMessage.header.numReadonlySignedAccounts;
  const unsignedWritableEndExclusive = accountKeys.length - compiledMessage.header.numReadonlyUnsignedAccounts;
  const isAccountWritable = (index) => {
    if (index < compiledMessage.header.numRequiredSignatures) {
      return index < signedWritableCount;
    }
    return index < unsignedWritableEndExclusive;
  };
  return {
    feePayer: tx.feePayer?.toBase58() ?? null,
    recentBlockhash: tx.recentBlockhash ?? null,
    lastValidBlockHeight: tx.lastValidBlockHeight,
    signatureBase64: tx.signature ? Buffer.from(tx.signature).toString("base64") : null,
    instructionCount: tx.instructions.length,
    accountKeys: accountKeys.map((account, index) => ({
      index,
      pubkey: account.toBase58(),
      isSigner: index < compiledMessage.header.numRequiredSignatures,
      isWritable: isAccountWritable(index)
    })),
    instructions: tx.instructions.map((instruction, index) => ({
      index,
      programId: instruction.programId.toBase58(),
      programIdIndex: accountKeys.findIndex((account) => account.equals(instruction.programId)),
      dataLength: instruction.data.length,
      dataBase64: Buffer.from(instruction.data).toString("base64"),
      keys: instruction.keys.map((key, keyIndex) => ({
        index: keyIndex,
        accountIndex: accountKeys.findIndex((account) => account.equals(key.pubkey)),
        pubkey: key.pubkey.toBase58(),
        isSigner: key.isSigner,
        isWritable: key.isWritable
      }))
    }))
  };
}
async function getMultipleAccountsInfoInChunks(connection, accounts) {
  if (accounts.length === 0) {
    return [];
  }
  const chunks = [];
  for (let start = 0;start < accounts.length; start += MULTIPLE_ACCOUNTS_CHUNK_SIZE2) {
    chunks.push(accounts.slice(start, start + MULTIPLE_ACCOUNTS_CHUNK_SIZE2));
  }
  const results = await Promise.all(chunks.map((chunk) => connection.getMultipleAccountsInfo(chunk)));
  return results.flat();
}
async function logFailedTransactionDiagnostics(params) {
  const { label, connection, tx, error, extraContext } = params;
  const txAccounts = collectTransactionAccounts(tx);
  const [errorLogs, accountInfos] = await Promise.all([
    getTransactionErrorLogs(error, connection),
    getMultipleAccountsInfoInChunks(connection, txAccounts)
  ]);
  console.error(`[${label}] sendAndConfirm failed`, prettyStringify({
    errorName: error?.name ?? "UnknownError",
    errorMessage: error?.message ?? String(error),
    errorLogs,
    extraContext,
    transaction: describeTransaction(tx),
    accountSnapshots: txAccounts.map((account, index) => ({
      pubkey: account,
      ...describeAccountInfo(accountInfos[index] ?? null)
    }))
  }));
  try {
    const simulation = await connection.simulateTransaction(tx);
    console.error(`[${label}] simulateTransaction result`, prettyStringify({
      contextSlot: simulation.context.slot,
      err: simulation.value.err,
      logs: simulation.value.logs,
      unitsConsumed: simulation.value.unitsConsumed,
      returnData: simulation.value.returnData
    }));
  } catch (simulationError) {
    const simulationLogs = await getTransactionErrorLogs(simulationError, connection);
    console.error(`[${label}] simulateTransaction failed`, prettyStringify({
      errorName: simulationError?.name ?? "UnknownError",
      errorMessage: simulationError?.message ?? String(simulationError),
      logs: simulationLogs
    }));
  }
}
var COMMITMENT_ORDER = {
  processed: 0,
  confirmed: 1,
  finalized: 2
};
function meetsCommitment(observed, required) {
  if (!observed)
    return false;
  const o = COMMITMENT_ORDER[observed];
  const r = COMMITMENT_ORDER[required];
  return o !== undefined && r !== undefined && o >= r;
}
async function pollForLanding(connection, signature, lastValidBlockHeight, commitment) {
  const pollIntervalMs = 1500;
  const maxWallClockMs = 90000;
  const start = Date.now();
  while (Date.now() - start < maxWallClockMs) {
    let status = null;
    try {
      const res = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true
      });
      status = res.value[0];
    } catch {}
    if (status?.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
    }
    if (meetsCommitment(status?.confirmationStatus, commitment)) {
      return signature;
    }
    try {
      const currentHeight = await connection.getBlockHeight(commitment);
      if (currentHeight > lastValidBlockHeight && !status) {
        throw new Error(`Transaction dropped: ${signature} (blockhash expired without landing)`);
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Transaction confirmation timed out after 90s: ${signature}`);
}
async function sendAndConfirmWithDiagnostics(params) {
  const { label, provider, tx, signers, rpcOptions, extraContext } = params;
  const connection = provider.connection;
  const wallet = provider.wallet;
  if (!wallet) {
    throw new Error(`[${label}] Provider has no wallet`);
  }
  const preflightCommitment = rpcOptions?.preflightCommitment ?? "confirmed";
  const confirmCommitment = preflightCommitment;
  const blockhashInfo = await connection.getLatestBlockhash(preflightCommitment);
  if (!tx.feePayer)
    tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = blockhashInfo.blockhash;
  tx.lastValidBlockHeight = blockhashInfo.lastValidBlockHeight;
  let signedTx;
  try {
    signedTx = await wallet.signTransaction(tx);
  } catch (error) {
    throw error;
  }
  for (const extraSigner of signers ?? []) {
    signedTx.partialSign(extraSigner);
  }
  let signature;
  try {
    signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: rpcOptions?.skipPreflight ?? false,
      preflightCommitment,
      maxRetries: rpcOptions?.maxRetries ?? 3
    });
  } catch (error) {
    await logFailedTransactionDiagnostics({
      label,
      connection,
      tx: signedTx,
      error,
      extraContext
    }).catch((debugError) => {
      console.error(`[${label}] failed to log transaction diagnostics`, {
        errorName: debugError?.name ?? "UnknownError",
        errorMessage: debugError?.message ?? String(debugError)
      });
    });
    throw error;
  }
  try {
    return await pollForLanding(connection, signature, blockhashInfo.lastValidBlockHeight, confirmCommitment);
  } catch (error) {
    await logFailedTransactionDiagnostics({
      label,
      connection,
      tx: signedTx,
      error,
      extraContext: { ...extraContext, signature }
    }).catch((debugError) => {
      console.error(`[${label}] failed to log transaction diagnostics`, {
        errorName: debugError?.name ?? "UnknownError",
        errorMessage: debugError?.message ?? String(debugError)
      });
    });
    throw error;
  }
}

// src/instructions/modifyBalance.ts
import { BN } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync as getAssociatedTokenAddressSync3,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { SystemProgram as SystemProgram2 } from "@solana/web3.js";
async function modifyBalanceIx(program, params) {
  const { user, tokenMint, amount, increase, payer, passNotExist } = params;
  const [depositPda] = findDepositPda(user, tokenMint);
  const [vaultPda] = findVaultPda(tokenMint);
  const userTokenAccount = getAssociatedTokenAddressSync3(tokenMint, user);
  const vaultTokenAccount = getAssociatedTokenAddressSync3(tokenMint, vaultPda, true);
  const kaminoAccounts = getKaminoModifyBalanceAccountsForTokenMint(tokenMint);
  const vaultCollateralTokenAccount = kaminoAccounts ? getAssociatedTokenAddressSync3(kaminoAccounts.reserveCollateralMint, vaultPda, true) : null;
  const accounts = {
    payer,
    user,
    vault: vaultPda,
    deposit: depositPda,
    userTokenAccount,
    vaultTokenAccount,
    tokenMint,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram2.programId
  };
  const remainingAccounts = kaminoAccounts && vaultCollateralTokenAccount ? [
    {
      pubkey: kaminoAccounts.lendingMarket,
      isSigner: false,
      isWritable: false
    },
    {
      pubkey: kaminoAccounts.lendingMarketAuthority,
      isSigner: false,
      isWritable: false
    },
    {
      pubkey: kaminoAccounts.reserve,
      isSigner: false,
      isWritable: true
    },
    {
      pubkey: kaminoAccounts.reserveLiquiditySupply,
      isSigner: false,
      isWritable: true
    },
    {
      pubkey: kaminoAccounts.reserveCollateralMint,
      isSigner: false,
      isWritable: true
    },
    {
      pubkey: vaultCollateralTokenAccount,
      isSigner: false,
      isWritable: true
    },
    {
      pubkey: kaminoAccounts.instructionSysvarAccount,
      isSigner: false,
      isWritable: false
    },
    {
      pubkey: kaminoAccounts.klendProgram,
      isSigner: false,
      isWritable: false
    }
  ] : [];
  const ix = await program.methods.modifyBalance({ amount: new BN(amount.toString()), increase }).accountsPartial(accounts).remainingAccounts(remainingAccounts).instruction();
  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: false,
        passNotExist: passNotExist === undefined ? false : passNotExist,
        label: "modifyBalance-depositPda"
      }
    ]
  };
}

// src/instructions/initializeDeposit.ts
import { TOKEN_PROGRAM_ID as TOKEN_PROGRAM_ID2 } from "@solana/spl-token";
import { SystemProgram as SystemProgram3 } from "@solana/web3.js";
async function initializeDepositIx(program, params) {
  const { user, tokenMint, payer } = params;
  const [depositPda] = findDepositPda(user, tokenMint);
  const ix = await program.methods.initializeDeposit().accountsPartial({
    payer,
    user,
    tokenMint,
    tokenProgram: TOKEN_PROGRAM_ID2,
    systemProgram: SystemProgram3.programId
  }).instruction();
  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: false,
        passNotExist: true,
        label: "initializeDeposit-depositPda"
      }
    ]
  };
}

// src/instructions/createPermission.ts
import { PERMISSION_PROGRAM_ID as PERMISSION_PROGRAM_ID2 } from "@magicblock-labs/ephemeral-rollups-sdk";
async function createPermissionIx(program, params) {
  const { user, tokenMint, payer, passNotExist } = params;
  const [depositPda] = findDepositPda(user, tokenMint);
  const [permissionPda] = findPermissionPda(depositPda);
  const ix = await program.methods.createPermission().accountsPartial({
    payer,
    user,
    deposit: depositPda,
    permission: permissionPda,
    permissionProgram: PERMISSION_PROGRAM_ID2
  }).instruction();
  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: false,
        passNotExist: passNotExist === undefined ? true : passNotExist,
        label: "createPermission-depositPda"
      },
      {
        address: permissionPda,
        delegated: false,
        passNotExist: true,
        label: "createPermission-permissionPda"
      }
    ]
  };
}

// src/instructions/delegateDeposit.ts
async function delegateDepositIx(program, params) {
  const { user, tokenMint, payer, validator, passNotExist } = params;
  const [depositPda] = findDepositPda(user, tokenMint);
  const [bufferPda] = findBufferPda(depositPda);
  const [delegationRecordPda] = findDelegationRecordPda(depositPda);
  const [delegationMetadataPda] = findDelegationMetadataPda(depositPda);
  const ix = await program.methods.delegate(user, tokenMint).accountsPartial({
    payer,
    bufferDeposit: bufferPda,
    delegationRecordDeposit: delegationRecordPda,
    delegationMetadataDeposit: delegationMetadataPda,
    deposit: depositPda,
    validator,
    ownerProgram: PROGRAM_ID,
    delegationProgram: DELEGATION_PROGRAM_ID
  }).instruction();
  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: false,
        passNotExist: passNotExist === undefined ? false : passNotExist,
        label: "delegateDeposit-depositPda"
      }
    ]
  };
}

// src/instructions/undelegateDeposit.ts
async function undelegateDepositIx(perProgram, params) {
  const { user, tokenMint, payer, sessionToken, magicProgram, magicContext } = params;
  const [depositPda] = findDepositPda(user, tokenMint);
  const accounts = {
    user,
    payer,
    deposit: depositPda,
    magicProgram,
    magicContext
  };
  accounts.sessionToken = sessionToken ?? null;
  const ix = await perProgram.methods.undelegate().accountsPartial(accounts).instruction();
  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: true,
        passNotExist: false,
        label: "undelegateDeposit-depositPda"
      }
    ]
  };
}

// src/actions/undelegateDeposit.ts
import {
  Transaction as Transaction3
} from "@solana/web3.js";
async function sendPlannedUndelegateDepositTransaction(params) {
  const { baseProgram, perProgram, transaction, user, tokenMint, rpcOptions } = params;
  await processEnsureChecks(baseProgram.provider.connection, perProgram.provider.connection, transaction.checks);
  const [depositPda] = findDepositPda(user, tokenMint);
  const delegationWatcher = waitForAccountOwnerChange(baseProgram.provider.connection, depositPda, PROGRAM_ID);
  const tx = new Transaction3().add(...transaction.instructions.map(({ ix }) => ix));
  let signature;
  try {
    signature = await sendAndConfirmWithDiagnostics({
      label: transaction.label,
      provider: perProgram.provider,
      tx,
      rpcOptions,
      extraContext: {
        user,
        tokenMint,
        depositPda
      }
    });
  } catch (e) {
    await delegationWatcher.cancel();
    throw e;
  }
  try {
    await delegationWatcher.wait();
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } catch (err) {
    console.warn(`[${transaction.label}] delegation watcher did not observe owner change (signature=${signature}); continuing`, err);
  }
  return signature;
}
async function undelegateDeposit(baseProgram, perProgram, params) {
  const { user, tokenMint } = params;
  const { ix, ensure } = await undelegateDepositIx(perProgram, params);
  return sendPlannedUndelegateDepositTransaction({
    baseProgram,
    perProgram,
    transaction: {
      label: "undelegateDeposit",
      instructions: [{ ix }],
      checks: ensure
    },
    user,
    tokenMint,
    rpcOptions: params.rpcOptions
  });
}

// src/actions/shieldTokens.ts
function labelTransactionInstructions(prefix, instructions) {
  const labels = [
    `${prefix}:createAssociatedTokenAccount`,
    `${prefix}:transfer`,
    `${prefix}:syncNative`
  ];
  return instructions.map((ix, index) => ({
    label: labels[index] ?? `${prefix}:${index}`,
    ix
  }));
}
async function buildShieldTokensInstructionPlan(params) {
  const { user, payer, tokenMint, amount, baseProgram, perProgram } = params;
  const baseConnection = baseProgram.provider.connection;
  const perRpcEndpoint = perProgram.provider.connection.rpcEndpoint;
  const isNativeSol = tokenMint.equals(NATIVE_MINT2);
  const validator = params.validator ?? getErValidatorForRpcEndpoint(perRpcEndpoint);
  const [depositPda] = findDepositPda(user, tokenMint);
  const [permissionPda] = findPermissionPda(depositPda);
  const accountInfos = await getMultipleAccountsInfoWithRetry(baseConnection, [depositPda, permissionPda], "base-getMultipleAccountsInfo");
  const depositAccountInfo = accountInfos[0] ?? null;
  const permissionAccountInfo = accountInfos[1] ?? null;
  const needsUndelegate = depositAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID) ?? false;
  const [
    depositRentLamports,
    modifyBalanceRentLamports,
    permissionRentLamports,
    delegationRentLamports
  ] = await Promise.all([
    !depositAccountInfo ? estimateDepositRentLamports({ connection: baseConnection, depositPda }) : Promise.resolve(0),
    estimateModifyBalanceRentLamports({
      connection: baseConnection,
      user,
      tokenMint,
      isNativeSol
    }),
    !permissionAccountInfo ? estimatePermissionRentLamports({
      connection: baseConnection,
      permissionPda
    }) : Promise.resolve(0),
    estimateDepositDelegationRentLamports({
      connection: baseConnection,
      user,
      tokenMint,
      depositPda,
      forceCreate: needsUndelegate
    })
  ]);
  const instructions = [];
  const checks = [];
  if (isNativeSol) {
    instructions.push(...labelTransactionInstructions("wrapSol", wrapSolToWsolIx({
      user,
      payer,
      lamports: amount
    })));
  }
  if (!depositAccountInfo) {
    const initializeDepositIxs = await initializeDepositIx(baseProgram, {
      tokenMint,
      user,
      payer
    });
    instructions.push({
      label: "initializeDeposit",
      ix: initializeDepositIxs.ix,
      rentLamports: depositRentLamports
    });
    checks.push(...initializeDepositIxs.ensure);
  }
  const modifyBalanceIxs = await modifyBalanceIx(baseProgram, {
    tokenMint,
    user,
    payer,
    amount,
    increase: true,
    passNotExist: true
  });
  instructions.push({
    label: "modifyBalanceIncrease",
    ix: modifyBalanceIxs.ix,
    rentLamports: modifyBalanceRentLamports
  });
  checks.push(...modifyBalanceIxs.ensure);
  if (!permissionAccountInfo) {
    const createPermissionIxs = await createPermissionIx(baseProgram, {
      tokenMint,
      user,
      payer,
      passNotExist: true
    });
    instructions.push({
      label: "createPermission",
      ix: createPermissionIxs.ix,
      rentLamports: permissionRentLamports
    });
    checks.push(...createPermissionIxs.ensure);
  }
  const delegateDepositIxs = await delegateDepositIx(baseProgram, {
    tokenMint,
    user,
    payer,
    validator,
    passNotExist: true
  });
  instructions.push({
    label: "delegateDeposit",
    ix: delegateDepositIxs.ix,
    rentLamports: delegationRentLamports
  });
  checks.push(...delegateDepositIxs.ensure);
  if (isNativeSol) {
    instructions.push({
      label: "closeWsolAta",
      ix: closeWsolAta({
        user,
        destination: user
      })
    });
  }
  return {
    instructions,
    checks,
    needsUndelegate,
    context: {
      isNativeSol,
      validator,
      depositPda,
      permissionPda,
      depositAccountInfo,
      permissionAccountInfo
    }
  };
}
async function buildShieldTokensTransactionPlan(params) {
  const instructionPlan = await buildShieldTokensInstructionPlan(params);
  let preUndelegateTransaction = null;
  if (instructionPlan.needsUndelegate) {
    const undelegateIxs = await undelegateDepositIx(params.perProgram, {
      user: params.user,
      payer: params.payer,
      tokenMint: params.tokenMint,
      sessionToken: params.sessionToken,
      magicProgram: params.magicProgram ?? MAGIC_PROGRAM_ID,
      magicContext: params.magicContext ?? MAGIC_CONTEXT_ID
    });
    preUndelegateTransaction = {
      label: "shield:preUndelegate",
      cluster: "ephemeral",
      instructions: [{ label: "undelegateDeposit", ix: undelegateIxs.ix }],
      checks: undelegateIxs.ensure
    };
  }
  return {
    preUndelegateTransaction,
    baseTransaction: {
      label: "shield",
      cluster: "base",
      instructions: instructionPlan.instructions,
      checks: instructionPlan.checks
    },
    context: instructionPlan.context
  };
}
async function shieldTokens(params) {
  const {
    user,
    payer,
    tokenMint,
    amount,
    baseProgram,
    perProgram,
    rpcOptions
  } = params;
  const baseConnection = baseProgram.provider.connection;
  const perConnection = perProgram.provider.connection;
  const plan = await buildShieldTokensTransactionPlan({
    user,
    payer,
    tokenMint,
    amount,
    baseProgram,
    perProgram,
    validator: params.validator,
    sessionToken: params.sessionToken,
    magicProgram: params.magicProgram,
    magicContext: params.magicContext
  });
  const {
    context: {
      validator,
      depositPda,
      permissionPda,
      depositAccountInfo,
      permissionAccountInfo,
      isNativeSol
    }
  } = plan;
  if (plan.preUndelegateTransaction) {
    await sendPlannedUndelegateDepositTransaction({
      baseProgram,
      perProgram,
      transaction: plan.preUndelegateTransaction,
      user,
      tokenMint,
      rpcOptions
    });
  }
  await processEnsureChecks(baseConnection, perConnection, plan.baseTransaction.checks);
  const delegationWatcher = waitForAccountOwnerChange(baseConnection, depositPda, DELEGATION_PROGRAM_ID);
  const tx = new Transaction4().add(...plan.baseTransaction.instructions.map(({ ix }) => ix));
  let signature;
  try {
    signature = await sendAndConfirmWithDiagnostics({
      label: "shieldTokens",
      provider: baseProgram.provider,
      tx,
      rpcOptions,
      extraContext: {
        user,
        payer,
        tokenMint,
        amount,
        isNativeSol,
        validator,
        depositPda,
        permissionPda,
        depositAccountInfo,
        permissionAccountInfo
      }
    });
  } catch (e) {
    await delegationWatcher.cancel();
    throw e;
  }
  try {
    await delegationWatcher.wait();
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } catch (err) {
    console.warn(`[shieldTokens] delegation watcher did not observe owner change (signature=${signature}); continuing`, err);
  }
  return signature;
}

// src/actions/unshieldTokens.ts
import { NATIVE_MINT as NATIVE_MINT3 } from "@solana/spl-token";
import { Transaction as Transaction5 } from "@solana/web3.js";
async function buildUnshieldTokensInstructionPlan(params) {
  const { user, payer, tokenMint, amount, baseProgram, perProgram } = params;
  const baseConnection = baseProgram.provider.connection;
  const perRpcEndpoint = perProgram.provider.connection.rpcEndpoint;
  const isNativeSol = tokenMint.equals(NATIVE_MINT3);
  const validator = params.validator ?? getErValidatorForRpcEndpoint(perRpcEndpoint);
  const [depositPda] = findDepositPda(user, tokenMint);
  const depositAccountInfoPromise = baseConnection.getAccountInfo(depositPda);
  const modifyBalanceRentLamportsPromise = estimateModifyBalanceRentLamports({
    connection: baseConnection,
    user,
    tokenMint,
    isNativeSol
  });
  const depositAccountInfo = await depositAccountInfoPromise;
  const needsUndelegate = depositAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID) ?? false;
  const currentDepositAccount = needsUndelegate ? await perProgram.account.deposit.fetchNullable(depositPda) : depositAccountInfo?.owner.equals(PROGRAM_ID) ? await baseProgram.account.deposit.fetchNullable(depositPda) : null;
  const currentDepositAmount = currentDepositAccount ? BigInt(currentDepositAccount.amount.toString()) : null;
  const shouldRedelegate = currentDepositAmount !== null && currentDepositAmount - amount > 0n;
  const [modifyBalanceRentLamports, delegationRentLamports] = await Promise.all([
    modifyBalanceRentLamportsPromise,
    shouldRedelegate ? estimateDepositDelegationRentLamports({
      connection: baseConnection,
      user,
      tokenMint,
      depositPda,
      forceCreate: needsUndelegate
    }) : Promise.resolve(0)
  ]);
  const instructions = [];
  const checks = [];
  if (isNativeSol) {
    instructions.push(...labelTransactionInstructions("ensureWsolAta", wrapSolToWsolIx({
      user,
      payer,
      lamports: 0n
    })));
  }
  const modifyBalanceIxs = await modifyBalanceIx(baseProgram, {
    tokenMint,
    user,
    payer,
    amount,
    increase: false
  });
  instructions.push({
    label: "modifyBalanceDecrease",
    ix: modifyBalanceIxs.ix,
    rentLamports: modifyBalanceRentLamports
  });
  checks.push(...modifyBalanceIxs.ensure);
  if (isNativeSol) {
    instructions.push({
      label: "closeWsolAta",
      ix: closeWsolAta({
        user,
        destination: user
      })
    });
  }
  if (shouldRedelegate) {
    const delegateDepositIxs = await delegateDepositIx(baseProgram, {
      tokenMint,
      user,
      payer,
      validator
    });
    instructions.push({
      label: "redelegateDeposit",
      ix: delegateDepositIxs.ix,
      rentLamports: delegationRentLamports
    });
    checks.push(...delegateDepositIxs.ensure);
  }
  return {
    instructions,
    checks,
    needsUndelegate,
    shouldRedelegate,
    context: {
      isNativeSol,
      validator,
      depositPda,
      currentDepositAmount
    }
  };
}
async function buildUnshieldTokensTransactionPlan(params) {
  const instructionPlan = await buildUnshieldTokensInstructionPlan(params);
  let preUndelegateTransaction = null;
  if (instructionPlan.needsUndelegate) {
    const undelegateIxs = await undelegateDepositIx(params.perProgram, {
      user: params.user,
      payer: params.payer,
      tokenMint: params.tokenMint,
      sessionToken: params.sessionToken,
      magicProgram: params.magicProgram ?? MAGIC_PROGRAM_ID,
      magicContext: params.magicContext ?? MAGIC_CONTEXT_ID
    });
    preUndelegateTransaction = {
      label: "unshield:undelegate",
      cluster: "ephemeral",
      instructions: [{ label: "undelegateDeposit", ix: undelegateIxs.ix }],
      checks: undelegateIxs.ensure
    };
  }
  return {
    preUndelegateTransaction,
    baseTransaction: {
      label: "unshield",
      cluster: "base",
      instructions: instructionPlan.instructions,
      checks: instructionPlan.checks
    },
    shouldRedelegate: instructionPlan.shouldRedelegate,
    context: instructionPlan.context
  };
}
async function unshieldTokens(params) {
  const {
    user,
    payer,
    tokenMint,
    amount,
    baseProgram,
    perProgram,
    rpcOptions
  } = params;
  const baseConnection = baseProgram.provider.connection;
  const perConnection = perProgram.provider.connection;
  const plan = await buildUnshieldTokensTransactionPlan({
    user,
    payer,
    tokenMint,
    amount,
    baseProgram,
    perProgram,
    validator: params.validator,
    sessionToken: params.sessionToken,
    magicProgram: params.magicProgram,
    magicContext: params.magicContext
  });
  const {
    shouldRedelegate,
    context: { validator, depositPda, isNativeSol, currentDepositAmount }
  } = plan;
  if (plan.preUndelegateTransaction) {
    await sendPlannedUndelegateDepositTransaction({
      baseProgram,
      perProgram,
      transaction: plan.preUndelegateTransaction,
      user,
      tokenMint,
      rpcOptions
    });
  }
  await processEnsureChecks(baseConnection, perConnection, plan.baseTransaction.checks);
  const delegationWatcher = shouldRedelegate ? waitForAccountOwnerChange(baseConnection, depositPda, DELEGATION_PROGRAM_ID) : null;
  const tx = new Transaction5().add(...plan.baseTransaction.instructions.map(({ ix }) => ix));
  let signature;
  try {
    signature = await sendAndConfirmWithDiagnostics({
      label: "unshieldTokens",
      provider: baseProgram.provider,
      tx,
      rpcOptions,
      extraContext: {
        user,
        payer,
        tokenMint,
        amount,
        isNativeSol,
        validator,
        depositPda,
        currentDepositAmount,
        shouldRedelegate
      }
    });
    if (delegationWatcher) {
      await delegationWatcher.wait();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } catch (e) {
    await delegationWatcher?.cancel();
    throw e;
  }
  return signature;
}

// src/instructions/initializeUsernameDeposit.ts
import { TOKEN_PROGRAM_ID as TOKEN_PROGRAM_ID3 } from "@solana/spl-token";
import { SystemProgram as SystemProgram4 } from "@solana/web3.js";
async function initializeUsernameDepositIx(program, params) {
  const { username, tokenMint, payer } = params;
  validateUsername(username);
  const [usernameDepositPda] = await findUsernameDepositPda(username, tokenMint);
  const usernameHash = await sha256hash(username);
  const ix = await program.methods.initializeUsernameDeposit(usernameHash).accountsPartial({
    payer,
    tokenMint,
    tokenProgram: TOKEN_PROGRAM_ID3,
    systemProgram: SystemProgram4.programId
  }).instruction();
  return {
    ix,
    ensure: [
      {
        address: usernameDepositPda,
        delegated: false,
        passNotExist: true,
        label: "initializeUsernameDeposit-usernameDepositPda"
      }
    ]
  };
}

// src/fee-estimate.ts
import {
  Transaction as Transaction6
} from "@solana/web3.js";
function createUnsignedTransaction(params) {
  return new Transaction6({
    feePayer: params.feePayer,
    recentBlockhash: params.blockhash
  }).add(...params.instructions);
}
async function getMessageFeeLamports(params) {
  const fee = await params.connection.getFeeForMessage(params.transaction.compileMessage(), params.commitment);
  if (fee.value === null) {
    throw new Error("RPC returned null fee for transaction message");
  }
  return fee.value;
}
async function estimatePlannedTransactionFees(params) {
  const transactionEstimates = await Promise.all(params.transactions.map(async (transactionPlan, index) => {
    if (transactionPlan.instructions.length === 0) {
      throw new Error(`Cannot estimate empty transaction: ${transactionPlan.label}`);
    }
    const blockhash = await transactionPlan.connection.getLatestBlockhash(params.commitment);
    const transaction = createUnsignedTransaction({
      feePayer: transactionPlan.feePayer,
      blockhash: blockhash.blockhash,
      instructions: transactionPlan.instructions.map(({ ix }) => ix)
    });
    const feeLamports = await getMessageFeeLamports({
      connection: transactionPlan.connection,
      transaction,
      commitment: params.commitment
    });
    const instructions = transactionPlan.instructions.map((instructionPlan, instructionIndex) => ({
      transactionIndex: index,
      instructionIndex,
      label: instructionPlan.label,
      programId: instructionPlan.ix.programId,
      rentLamports: instructionPlan.rentLamports ?? 0
    }));
    const rentLamports = instructions.reduce((total, instruction) => total + instruction.rentLamports, 0);
    return {
      index,
      label: transactionPlan.label,
      cluster: transactionPlan.cluster,
      feePayer: transactionPlan.feePayer,
      blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      instructionCount: transactionPlan.instructions.length,
      feeLamports,
      rentLamports,
      instructions
    };
  }));
  const instructionEstimates = transactionEstimates.flatMap((transaction) => transaction.instructions);
  return {
    transactions: transactionEstimates,
    instructions: instructionEstimates,
    totalFeeLamports: transactionEstimates.reduce((total, transaction) => total + transaction.feeLamports, 0),
    totalRentLamports: instructionEstimates.reduce((total, instruction) => total + instruction.rentLamports, 0)
  };
}

// src/LoyalPrivateTransactionsClient.ts
var KAMINO_API_BASE_URL = "https://api.kamino.finance";
var KAMINO_MAINNET_ENV = "mainnet-beta";
var KAMINO_DEVNET_ENV = "devnet";
function prettyStringify2(obj) {
  const json = JSON.stringify(obj, (_key, value) => {
    if (value instanceof PublicKey6)
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
  const baseConnection = new Connection3(rpcEndpoint, {
    wsEndpoint,
    commitment
  });
  const baseProvider = new AnchorProvider(baseConnection, adapter, {
    commitment
  });
  return new Program(telegram_private_transfer_default, baseProvider);
}
function getKaminoApiEnv(accounts) {
  return accounts && isKaminoMainnetModifyBalanceAccounts(accounts) ? KAMINO_MAINNET_ENV : KAMINO_DEVNET_ENV;
}
function normalizeBigInt(value) {
  if (typeof value === "bigint") {
    return value;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Expected a non-negative integer amount, received ${value}`);
  }
  return BigInt(value);
}
function toShieldFlowTransactionPlan(plan) {
  return {
    label: plan.label,
    cluster: plan.cluster,
    instructions: plan.instructions
  };
}
async function fetchKaminoReserveMetrics(args) {
  const url = new URL(`/kamino-market/${args.lendingMarket.toBase58()}/reserves/metrics`, KAMINO_API_BASE_URL);
  url.searchParams.set("env", args.env);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Kamino reserve metrics request failed with status ${response.status}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Kamino reserve metrics response was not an array");
  }
  const reserveAddress = args.reserve.toBase58();
  const reserveMetrics = payload.find((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const candidate = item;
    return candidate.reserve === reserveAddress && (typeof candidate.supplyApy === "number" || typeof candidate.supplyApy === "string");
  });
  if (!reserveMetrics) {
    throw new Error(`Kamino reserve metrics not found for reserve ${reserveAddress}`);
  }
  return reserveMetrics;
}
async function fetchKaminoReserveSupplyApyBps(args) {
  const reserveMetrics = await fetchKaminoReserveMetrics(args);
  const supplyApy = Number(reserveMetrics.supplyApy);
  if (!Number.isFinite(supplyApy) || supplyApy < 0) {
    throw new Error(`Kamino reserve metrics returned an invalid supplyApy for reserve ${args.reserve.toBase58()}`);
  }
  return Math.round(supplyApy * 1e4);
}
function deriveMessageSigner(signer) {
  if (isKeypair(signer)) {
    return createKeypairMessageSigner(signer);
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
function waitForAccountOwnerChange2(connection, account, expectedOwner, timeoutMs = 15000, intervalMs = 1000) {
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
          await verifyTeeIntegrity(ephemeralRpcEndpoint);
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
  async shieldTokens(params) {
    const payer = params.payer ?? params.user;
    return shieldTokens({
      user: params.user,
      payer,
      tokenMint: params.tokenMint,
      amount: normalizeBigInt(params.amount),
      baseProgram: this.baseProgram,
      perProgram: this.ephemeralProgram,
      validator: params.validator,
      sessionToken: params.sessionToken,
      magicProgram: params.magicProgram,
      magicContext: params.magicContext,
      rpcOptions: params.rpcOptions
    });
  }
  async unshieldTokens(params) {
    const payer = params.payer ?? params.user;
    return unshieldTokens({
      user: params.user,
      payer,
      tokenMint: params.tokenMint,
      amount: normalizeBigInt(params.amount),
      baseProgram: this.baseProgram,
      perProgram: this.ephemeralProgram,
      validator: params.validator,
      sessionToken: params.sessionToken,
      magicProgram: params.magicProgram,
      magicContext: params.magicContext,
      rpcOptions: params.rpcOptions
    });
  }
  async buildShieldFlowTransactionPlan(params) {
    const amount = normalizeBigInt(params.amount);
    const payer = params.payer ?? params.user;
    const validator = params.validator ?? this.getExpectedErValidator();
    const magicProgram = params.magicProgram ?? MAGIC_PROGRAM_ID;
    const magicContext = params.magicContext ?? MAGIC_CONTEXT_ID;
    const transactions = [];
    if (params.kind === "shield") {
      const shieldPlan = await buildShieldTokensTransactionPlan({
        user: params.user,
        payer,
        tokenMint: params.tokenMint,
        amount,
        baseProgram: this.baseProgram,
        perProgram: this.ephemeralProgram,
        validator,
        sessionToken: params.sessionToken,
        magicProgram,
        magicContext
      });
      if (shieldPlan.preUndelegateTransaction) {
        transactions.push(toShieldFlowTransactionPlan(shieldPlan.preUndelegateTransaction));
      }
      transactions.push(toShieldFlowTransactionPlan(shieldPlan.baseTransaction));
    } else {
      const unshieldPlan = await buildUnshieldTokensTransactionPlan({
        user: params.user,
        payer,
        tokenMint: params.tokenMint,
        amount,
        baseProgram: this.baseProgram,
        perProgram: this.ephemeralProgram,
        validator,
        sessionToken: params.sessionToken,
        magicProgram,
        magicContext
      });
      if (unshieldPlan.preUndelegateTransaction) {
        transactions.push(toShieldFlowTransactionPlan(unshieldPlan.preUndelegateTransaction));
      }
      transactions.push(toShieldFlowTransactionPlan(unshieldPlan.baseTransaction));
    }
    return {
      kind: params.kind,
      user: params.user,
      payer,
      tokenMint: params.tokenMint,
      amount,
      transactions
    };
  }
  async buildShieldTokensTransactionPlan(params) {
    return this.buildShieldFlowTransactionPlan({
      ...params,
      kind: "shield"
    });
  }
  async buildUnshieldTokensTransactionPlan(params) {
    return this.buildShieldFlowTransactionPlan({
      ...params,
      kind: "unshield"
    });
  }
  async estimateShieldFlowFee(params) {
    const transactions = params.plan.transactions.map((transaction) => ({
      label: transaction.label,
      cluster: transaction.cluster,
      connection: transaction.cluster === "base" ? this.baseProgram.provider.connection : this.ephemeralProgram.provider.connection,
      feePayer: params.plan.payer,
      instructions: transaction.instructions
    }));
    if (transactions.length === 0) {
      throw new Error("Cannot estimate an empty shield flow plan");
    }
    const estimate = await estimatePlannedTransactionFees({
      transactions,
      commitment: params.commitment
    });
    return {
      kind: params.plan.kind,
      user: params.plan.user,
      payer: params.plan.payer,
      tokenMint: params.plan.tokenMint,
      amount: params.plan.amount,
      totalFeeLamports: estimate.totalFeeLamports,
      totalRentLamports: estimate.totalRentLamports,
      totalLamports: estimate.totalFeeLamports + estimate.totalRentLamports,
      transactions: estimate.transactions,
      instructions: estimate.instructions,
      note: "Solana charges protocol fees per transaction message. Instruction rows expose attributable rent for newly created accounts; totalFeeLamports is the expected network fee for the planned SDK transaction flow."
    };
  }
  async estimateShieldTokensFee(params) {
    if (params.plan.kind !== "shield") {
      throw new Error("estimateShieldTokensFee expected a shield plan");
    }
    return this.estimateShieldFlowFee(params);
  }
  async estimateUnshieldTokensFee(params) {
    if (params.plan.kind !== "unshield") {
      throw new Error("estimateUnshieldTokensFee expected an unshield plan");
    }
    return this.estimateShieldFlowFee(params);
  }
  async initializeDeposit(params) {
    const { ix, ensure } = await initializeDepositIx(this.baseProgram, params);
    await processEnsureChecks(this.baseProgram.provider.connection, this.ephemeralProgram.provider.connection, ensure);
    const tx = new Transaction7().add(ix);
    return await sendAndConfirmWithDiagnostics({
      label: "initializeDeposit",
      provider: this.baseProgram.provider,
      tx,
      rpcOptions: params.rpcOptions,
      extraContext: {
        user: params.user,
        tokenMint: params.tokenMint
      }
    });
  }
  async initializeUsernameDeposit(params) {
    const { ix, ensure } = await initializeUsernameDepositIx(this.baseProgram, params);
    await processEnsureChecks(this.baseProgram.provider.connection, this.ephemeralProgram.provider.connection, ensure);
    const tx = new Transaction7().add(ix);
    return await sendAndConfirmWithDiagnostics({
      label: "initializeUsernameDeposit",
      provider: this.baseProgram.provider,
      tx,
      rpcOptions: params.rpcOptions,
      extraContext: {
        username: params.username,
        tokenMint: params.tokenMint
      }
    });
  }
  async modifyBalance(params) {
    const { user, tokenMint } = params;
    const { ix, ensure } = await modifyBalanceIx(this.baseProgram, params);
    await processEnsureChecks(this.baseProgram.provider.connection, this.ephemeralProgram.provider.connection, ensure);
    const tx = new Transaction7().add(ix);
    const signature = await sendAndConfirmWithDiagnostics({
      label: "modifyBalance",
      provider: this.baseProgram.provider,
      tx,
      rpcOptions: params.rpcOptions,
      extraContext: {
        user,
        tokenMint,
        amount: params.amount,
        increase: params.increase
      }
    });
    const deposit = await this.getBaseDeposit(user, tokenMint);
    if (!deposit) {
      throw new Error("Failed to fetch deposit after modification");
    }
    return { signature, deposit };
  }
  async claimUsernameDepositToDeposit(params) {
    const { username, tokenMint, amount, recipient, session, rpcOptions } = params;
    validateUsername(username);
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
      tokenProgram: TOKEN_PROGRAM_ID4
    };
    console.log("claimUsernameDepositToDeposit accounts:", prettyStringify2(accounts));
    const connection = this.baseProgram.provider.connection;
    const [srcInfo, dstInfo, sessionInfo] = await Promise.all([
      connection.getAccountInfo(sourceUsernameDeposit),
      connection.getAccountInfo(destinationDeposit),
      connection.getAccountInfo(session)
    ]);
    console.log("claimUsernameDepositToDeposit sourceUsernameDeposit accountInfo:", prettyStringify2({
      address: sourceUsernameDeposit.toBase58(),
      exists: !!srcInfo,
      owner: srcInfo?.owner?.toBase58(),
      lamports: srcInfo?.lamports,
      dataLen: srcInfo?.data?.length,
      executable: srcInfo?.executable
    }));
    console.log("claimUsernameDepositToDeposit destinationDeposit accountInfo:", prettyStringify2({
      address: destinationDeposit.toBase58(),
      exists: !!dstInfo,
      owner: dstInfo?.owner?.toBase58(),
      lamports: dstInfo?.lamports,
      dataLen: dstInfo?.data?.length,
      executable: dstInfo?.executable
    }));
    console.log("claimUsernameDepositToDeposit session accountInfo:", prettyStringify2({
      address: session.toBase58(),
      exists: !!sessionInfo,
      owner: sessionInfo?.owner?.toBase58(),
      lamports: sessionInfo?.lamports,
      dataLen: sessionInfo?.data?.length,
      executable: sessionInfo?.executable
    }));
    try {
      const sim = await this.ephemeralProgram.methods.claimUsernameDepositToDeposit(new BN2(amount.toString())).accountsPartial(accounts).simulate();
      console.log("claimUsernameDepositToDeposit simulation logs:", sim.raw);
    } catch (simErr) {
      const simResponse = simErr.simulationResponse;
      console.error("claimUsernameDepositToDeposit simulate FAILED");
      console.error("  error message:", simErr instanceof Error ? simErr.message : String(simErr));
      if (simResponse) {
        console.error("  simulation err:", prettyStringify2(simResponse.err));
        console.error("  simulation logs:", prettyStringify2(simResponse.logs));
        console.error("  unitsConsumed:", simResponse.unitsConsumed);
      }
      throw simErr;
    }
    const signature = await this.ephemeralProgram.methods.claimUsernameDepositToDeposit(new BN2(amount.toString())).accountsPartial(accounts).rpc({ skipPreflight: true, commitment: "confirmed" });
    return signature;
  }
  async createPermission(params) {
    const { ix, ensure } = await createPermissionIx(this.baseProgram, params);
    await processEnsureChecks(this.baseProgram.provider.connection, this.ephemeralProgram.provider.connection, ensure);
    const tx = new Transaction7().add(ix);
    return await sendAndConfirmWithDiagnostics({
      label: "createPermission",
      provider: this.baseProgram.provider,
      tx,
      rpcOptions: params.rpcOptions,
      extraContext: {
        user: params.user,
        tokenMint: params.tokenMint
      }
    });
  }
  async createUsernamePermission(params) {
    const { username, tokenMint, session, authority, payer, rpcOptions } = params;
    validateUsername(username);
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
        systemProgram: SystemProgram5.programId
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
    const { user, tokenMint } = params;
    const { ix, ensure } = await delegateDepositIx(this.baseProgram, params);
    await processEnsureChecks(this.baseProgram.provider.connection, this.ephemeralProgram.provider.connection, ensure);
    const [depositPda] = findDepositPda(user, tokenMint);
    const delegationWatcher = waitForAccountOwnerChange2(this.baseProgram.provider.connection, depositPda, DELEGATION_PROGRAM_ID);
    let signature;
    try {
      const tx = new Transaction7().add(ix);
      signature = await sendAndConfirmWithDiagnostics({
        label: "delegateDeposit",
        provider: this.baseProgram.provider,
        tx,
        rpcOptions: params.rpcOptions,
        extraContext: {
          user,
          tokenMint,
          depositPda
        }
      });
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }
    try {
      await delegationWatcher.wait();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (err) {
      console.warn(`[delegateDeposit] delegation watcher did not observe owner change (signature=${signature}); continuing`, err);
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
    validateUsername(username);
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
      systemProgram: SystemProgram5.programId
    };
    accounts.validator = validator ?? null;
    const delegationWatcher = waitForAccountOwnerChange2(this.baseProgram.provider.connection, depositPda, DELEGATION_PROGRAM_ID);
    let signature;
    try {
      console.log("delegateUsernameDeposit Accounts:", prettyStringify2(accounts));
      signature = await this.baseProgram.methods.delegateUsernameDeposit(usernameHash, tokenMint).accountsPartial(accounts).rpc(rpcOptions);
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }
    try {
      console.log("delegateUsernameDeposit: waiting for depositPda owner to be DELEGATION_PROGRAM_ID on base connection...");
      await delegationWatcher.wait();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (err) {
      console.warn(`[delegateUsernameDeposit] delegation watcher did not observe owner change (signature=${signature}); continuing`, err);
    }
    return signature;
  }
  async undelegateDeposit(params) {
    return await undelegateDeposit(this.baseProgram, this.ephemeralProgram, params);
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
    validateUsername(username);
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
      systemProgram: SystemProgram5.programId
    };
    accounts.sessionToken = sessionToken ?? null;
    console.log("transferDeposit Accounts:");
    Object.entries(accounts).forEach(([key, value]) => {
      console.log(key, value && value.toString());
    });
    console.log("-----");
    const signature = await this.ephemeralProgram.methods.transferDeposit(new BN2(amount.toString())).accountsPartial(accounts).rpc(rpcOptions);
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
    validateUsername(username);
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
      systemProgram: SystemProgram5.programId
    };
    accounts.sessionToken = sessionToken ?? null;
    const signature = await this.ephemeralProgram.methods.transferToUsernameDeposit(new BN2(amount.toString())).accountsPartial(accounts).rpc(rpcOptions);
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
  async getAllDepositsByUser(user) {
    const userFilter = [
      {
        memcmp: {
          offset: 8,
          bytes: user.toBase58()
        }
      }
    ];
    const [baseResults, ephemeralResults] = await Promise.allSettled([
      this.baseProgram.account.deposit.all(userFilter),
      this.ephemeralProgram.account.deposit.all(userFilter)
    ]);
    const byPda = new Map;
    const ingest = (results, preferOverwrite) => {
      for (const { publicKey, account } of results) {
        const key = publicKey.toBase58();
        if (!preferOverwrite && byPda.has(key))
          continue;
        byPda.set(key, {
          user: account.user,
          tokenMint: account.tokenMint,
          amount: BigInt(account.amount.toString()),
          address: publicKey
        });
      }
    };
    if (baseResults.status === "fulfilled") {
      ingest(baseResults.value, false);
    } else {
      console.warn("[getAllDepositsByUser] base program enumeration failed", baseResults.reason);
    }
    if (ephemeralResults.status === "fulfilled") {
      ingest(ephemeralResults.value, true);
    } else {
      console.warn("[getAllDepositsByUser] ephemeral program enumeration failed", ephemeralResults.reason);
    }
    return Array.from(byPda.values());
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
  async getKaminoLendingApyBps(tokenMint) {
    const kaminoAccounts = getKaminoModifyBalanceAccountsForTokenMint(tokenMint);
    if (!kaminoAccounts) {
      return null;
    }
    if (!isKaminoMainnetModifyBalanceAccounts(kaminoAccounts)) {
      return 0;
    }
    return fetchKaminoReserveSupplyApyBps({
      lendingMarket: kaminoAccounts.lendingMarket,
      reserve: kaminoAccounts.reserve,
      env: getKaminoApiEnv(kaminoAccounts)
    });
  }
  async getKaminoReserveSnapshot(tokenMint) {
    const kaminoAccounts = getKaminoModifyBalanceAccountsForTokenMint(tokenMint);
    if (!kaminoAccounts) {
      return null;
    }
    return fetchKaminoReserveSnapshot({
      connection: this.baseProgram.provider.connection,
      tokenMint
    });
  }
  async getKaminoShieldedBalanceQuote(params) {
    const snapshot = await this.getKaminoReserveSnapshot(params.tokenMint);
    if (!snapshot) {
      return null;
    }
    const collateralSharesAmountRaw = normalizeBigInt(params.collateralSharesAmountRaw);
    const principalLiquidityAmountRaw = params.principalLiquidityAmountRaw === undefined || params.principalLiquidityAmountRaw === null ? null : normalizeBigInt(params.principalLiquidityAmountRaw);
    const shieldCollateralExchangeRateSf = params.shieldCollateralExchangeRateSf === undefined || params.shieldCollateralExchangeRateSf === null ? null : normalizeBigInt(params.shieldCollateralExchangeRateSf);
    const valuation = calculateKaminoCollateralValuation({
      snapshot,
      collateralAmount: collateralSharesAmountRaw,
      principalLiquidityAmount: principalLiquidityAmountRaw,
      shieldCollateralExchangeRateSf
    });
    return {
      snapshot,
      collateralSharesAmountRaw,
      redeemableLiquidityAmountRaw: valuation.currentLiquidityAmount,
      principalLiquidityAmountRaw: valuation.principalLiquidityAmount,
      earnedLiquidityAmountRaw: valuation.earnedLiquidityAmount,
      shieldCollateralExchangeRateSf
    };
  }
  async getKaminoCollateralSharesForLiquidityAmount(params) {
    const snapshot = await this.getKaminoReserveSnapshot(params.tokenMint);
    if (!snapshot) {
      return null;
    }
    return calculateKaminoShareAmountForLiquidityAmountRaw({
      snapshot,
      liquidityAmountRaw: normalizeBigInt(params.liquidityAmountRaw),
      rounding: "ceil"
    });
  }
  calculateKaminoCollateralExchangeRateSfFromAmounts(args) {
    return calculateKaminoCollateralExchangeRateSfFromAmounts({
      collateralAmount: normalizeBigInt(args.collateralAmountRaw),
      liquidityAmount: normalizeBigInt(args.liquidityAmountRaw)
    });
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
      console.error("baseAccountInfo", prettyStringify2(baseAccountInfo));
      console.error("ephemeralAccountInfo", prettyStringify2(ephemeralAccountInfo));
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
      console.error("baseAccountInfo", prettyStringify2(baseAccountInfo));
      console.error("ephemeralAccountInfo", prettyStringify2(ephemeralAccountInfo));
      throw new Error(`Account is not delegated to ER: ${displayName}${account.toString()}`);
    } else if (!skipValidatorCheck && delegationStatus.result.delegationRecord.authority !== this.getExpectedErValidator().toString()) {
      console.error(`Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${delegationStatus.result.delegationRecord.authority}`);
      console.error("/getDelegationStatus:", JSON.stringify(delegationStatus, null, 2));
      console.error("baseAccountInfo", prettyStringify2(baseAccountInfo));
      console.error("ephemeralAccountInfo", prettyStringify2(ephemeralAccountInfo));
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
  waitForAccountOwnerChange2 as waitForAccountOwnerChange,
  unshieldTokens,
  solToLamports,
  shieldTokens,
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
