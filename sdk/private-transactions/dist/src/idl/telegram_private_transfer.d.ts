/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/telegram_private_transfer.json`.
 */
export type TelegramPrivateTransfer = {
    "address": "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV";
    "metadata": {
        "name": "telegramPrivateTransfer";
        "version": "0.1.0";
        "spec": "0.1.0";
        "description": "Created with Anchor";
    };
    "instructions": [
        {
            "name": "claimUsernameDepositToDeposit";
            "docs": [
                "Claim tokens and transfer from username deposit to deposit"
            ];
            "discriminator": [
                147,
                77,
                235,
                126,
                72,
                182,
                30,
                12
            ];
            "accounts": [
                {
                    "name": "user";
                    "relations": [
                        "destinationDeposit"
                    ];
                },
                {
                    "name": "sourceUsernameDeposit";
                    "writable": true;
                },
                {
                    "name": "destinationDeposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "destination_deposit.user";
                                "account": "deposit";
                            },
                            {
                                "kind": "account";
                                "path": "destination_deposit.token_mint";
                                "account": "deposit";
                            }
                        ];
                    };
                },
                {
                    "name": "tokenMint";
                    "relations": [
                        "sourceUsernameDeposit",
                        "destinationDeposit"
                    ];
                },
                {
                    "name": "session";
                },
                {
                    "name": "tokenProgram";
                    "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
                }
            ];
            "args": [
                {
                    "name": "amount";
                    "type": "u64";
                }
            ];
        },
        {
            "name": "createPermission";
            "docs": [
                "Creates a permission for a deposit account using the external permission program.",
                "",
                "Calls out to the permission program to create a permission for the deposit account."
            ];
            "discriminator": [
                190,
                182,
                26,
                164,
                156,
                221,
                8,
                0
            ];
            "accounts": [
                {
                    "name": "payer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "user";
                    "signer": true;
                },
                {
                    "name": "deposit";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "user";
                            },
                            {
                                "kind": "account";
                                "path": "deposit.token_mint";
                                "account": "deposit";
                            }
                        ];
                    };
                },
                {
                    "name": "permission";
                    "writable": true;
                },
                {
                    "name": "permissionProgram";
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                }
            ];
            "args": [];
        },
        {
            "name": "createUsernamePermission";
            "docs": [
                "Creates a permission for a username-based deposit account."
            ];
            "discriminator": [
                130,
                137,
                147,
                121,
                57,
                217,
                102,
                40
            ];
            "accounts": [
                {
                    "name": "payer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "authority";
                    "signer": true;
                },
                {
                    "name": "deposit";
                },
                {
                    "name": "session";
                },
                {
                    "name": "permission";
                    "writable": true;
                },
                {
                    "name": "permissionProgram";
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                }
            ];
            "args": [];
        },
        {
            "name": "delegate";
            "docs": [
                "Delegates the deposit account to the ephemeral rollups delegate program.",
                "",
                "Uses the ephemeral rollups delegate CPI to delegate the deposit account."
            ];
            "discriminator": [
                90,
                147,
                75,
                178,
                85,
                88,
                4,
                137
            ];
            "accounts": [
                {
                    "name": "payer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "validator";
                    "optional": true;
                },
                {
                    "name": "bufferDeposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    98,
                                    117,
                                    102,
                                    102,
                                    101,
                                    114
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "deposit";
                            }
                        ];
                        "program": {
                            "kind": "const";
                            "value": [
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
                            ];
                        };
                    };
                },
                {
                    "name": "delegationRecordDeposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "deposit";
                            }
                        ];
                        "program": {
                            "kind": "account";
                            "path": "delegationProgram";
                        };
                    };
                },
                {
                    "name": "delegationMetadataDeposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "deposit";
                            }
                        ];
                        "program": {
                            "kind": "account";
                            "path": "delegationProgram";
                        };
                    };
                },
                {
                    "name": "deposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "arg";
                                "path": "user";
                            },
                            {
                                "kind": "arg";
                                "path": "tokenMint";
                            }
                        ];
                    };
                },
                {
                    "name": "ownerProgram";
                    "address": "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV";
                },
                {
                    "name": "delegationProgram";
                    "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                }
            ];
            "args": [
                {
                    "name": "user";
                    "type": "pubkey";
                },
                {
                    "name": "tokenMint";
                    "type": "pubkey";
                }
            ];
        },
        {
            "name": "delegateUsernameDeposit";
            "docs": [
                "Delegates the username-based deposit account to the ephemeral rollups delegate program."
            ];
            "discriminator": [
                26,
                82,
                4,
                176,
                221,
                64,
                84,
                178
            ];
            "accounts": [
                {
                    "name": "payer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "validator";
                    "optional": true;
                },
                {
                    "name": "bufferDeposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    98,
                                    117,
                                    102,
                                    102,
                                    101,
                                    114
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "deposit";
                            }
                        ];
                        "program": {
                            "kind": "const";
                            "value": [
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
                            ];
                        };
                    };
                },
                {
                    "name": "delegationRecordDeposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "deposit";
                            }
                        ];
                        "program": {
                            "kind": "account";
                            "path": "delegationProgram";
                        };
                    };
                },
                {
                    "name": "delegationMetadataDeposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "deposit";
                            }
                        ];
                        "program": {
                            "kind": "account";
                            "path": "delegationProgram";
                        };
                    };
                },
                {
                    "name": "deposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "arg";
                                "path": "usernameHash";
                            },
                            {
                                "kind": "arg";
                                "path": "tokenMint";
                            }
                        ];
                    };
                },
                {
                    "name": "ownerProgram";
                    "address": "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV";
                },
                {
                    "name": "delegationProgram";
                    "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                }
            ];
            "args": [
                {
                    "name": "usernameHash";
                    "type": {
                        "array": [
                            "u8",
                            32
                        ];
                    };
                },
                {
                    "name": "tokenMint";
                    "type": "pubkey";
                }
            ];
        },
        {
            "name": "initializeDeposit";
            "docs": [
                "Initializes a deposit account for a user and token mint if it does not exist.",
                "",
                "Sets up a new deposit account with zero balance for the user and token mint.",
                "If the account is already initialized, this instruction is a no-op."
            ];
            "discriminator": [
                171,
                65,
                93,
                225,
                61,
                109,
                31,
                227
            ];
            "accounts": [
                {
                    "name": "payer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "user";
                },
                {
                    "name": "deposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "user";
                            },
                            {
                                "kind": "account";
                                "path": "tokenMint";
                            }
                        ];
                    };
                },
                {
                    "name": "tokenMint";
                },
                {
                    "name": "tokenProgram";
                    "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                }
            ];
            "args": [];
        },
        {
            "name": "initializeUsernameDeposit";
            "discriminator": [
                125,
                255,
                77,
                198,
                75,
                226,
                85,
                91
            ];
            "accounts": [
                {
                    "name": "payer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "deposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "arg";
                                "path": "usernameHash";
                            },
                            {
                                "kind": "account";
                                "path": "tokenMint";
                            }
                        ];
                    };
                },
                {
                    "name": "tokenMint";
                },
                {
                    "name": "tokenProgram";
                    "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                }
            ];
            "args": [
                {
                    "name": "usernameHash";
                    "type": {
                        "array": [
                            "u8",
                            32
                        ];
                    };
                }
            ];
        },
        {
            "name": "modifyBalance";
            "docs": [
                "Modifies the balance of a user's deposit account by transferring tokens in or out.",
                "",
                "If `args.increase` is true, tokens are transferred from the user's token account to the deposit account.",
                "If false, tokens are transferred from the deposit account back to the user's token account."
            ];
            "discriminator": [
                148,
                232,
                7,
                240,
                55,
                51,
                121,
                115
            ];
            "accounts": [
                {
                    "name": "payer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "user";
                    "signer": true;
                    "relations": [
                        "deposit"
                    ];
                },
                {
                    "name": "vault";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    118,
                                    97,
                                    117,
                                    108,
                                    116
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "deposit.token_mint";
                                "account": "deposit";
                            }
                        ];
                    };
                },
                {
                    "name": "deposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "deposit.user";
                                "account": "deposit";
                            },
                            {
                                "kind": "account";
                                "path": "deposit.token_mint";
                                "account": "deposit";
                            }
                        ];
                    };
                },
                {
                    "name": "userTokenAccount";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "account";
                                "path": "user";
                            },
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "tokenMint";
                            }
                        ];
                        "program": {
                            "kind": "const";
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
                            ];
                        };
                    };
                },
                {
                    "name": "vaultTokenAccount";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "account";
                                "path": "vault";
                            },
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "tokenMint";
                            }
                        ];
                        "program": {
                            "kind": "const";
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
                            ];
                        };
                    };
                },
                {
                    "name": "tokenMint";
                    "relations": [
                        "deposit"
                    ];
                },
                {
                    "name": "tokenProgram";
                    "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
                },
                {
                    "name": "associatedTokenProgram";
                    "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                }
            ];
            "args": [
                {
                    "name": "args";
                    "type": {
                        "defined": {
                            "name": "modifyDepositArgs";
                        };
                    };
                }
            ];
        },
        {
            "name": "processUndelegation";
            "discriminator": [
                196,
                28,
                41,
                206,
                48,
                37,
                51,
                167
            ];
            "accounts": [
                {
                    "name": "baseAccount";
                    "writable": true;
                },
                {
                    "name": "buffer";
                },
                {
                    "name": "payer";
                    "writable": true;
                },
                {
                    "name": "systemProgram";
                }
            ];
            "args": [
                {
                    "name": "accountSeeds";
                    "type": {
                        "vec": "bytes";
                    };
                }
            ];
        },
        {
            "name": "transferDeposit";
            "docs": [
                "Transfers a specified amount from one user's deposit account to another's for the same token mint.",
                "",
                "Only updates the internal accounting; does not move actual tokens."
            ];
            "discriminator": [
                20,
                20,
                147,
                223,
                41,
                63,
                204,
                111
            ];
            "accounts": [
                {
                    "name": "user";
                    "relations": [
                        "sourceDeposit"
                    ];
                },
                {
                    "name": "payer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "sessionToken";
                    "optional": true;
                },
                {
                    "name": "sourceDeposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "source_deposit.user";
                                "account": "deposit";
                            },
                            {
                                "kind": "account";
                                "path": "source_deposit.token_mint";
                                "account": "deposit";
                            }
                        ];
                    };
                },
                {
                    "name": "destinationDeposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "destination_deposit.user";
                                "account": "deposit";
                            },
                            {
                                "kind": "account";
                                "path": "destination_deposit.token_mint";
                                "account": "deposit";
                            }
                        ];
                    };
                },
                {
                    "name": "tokenMint";
                    "relations": [
                        "sourceDeposit",
                        "destinationDeposit"
                    ];
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                }
            ];
            "args": [
                {
                    "name": "amount";
                    "type": "u64";
                }
            ];
        },
        {
            "name": "transferToUsernameDeposit";
            "docs": [
                "Transfers a specified amount from a user's deposit account to a username-based deposit.",
                "",
                "Only updates the internal accounting; does not move actual tokens."
            ];
            "discriminator": [
                224,
                228,
                188,
                234,
                232,
                153,
                75,
                96
            ];
            "accounts": [
                {
                    "name": "user";
                    "relations": [
                        "sourceDeposit"
                    ];
                },
                {
                    "name": "payer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "sessionToken";
                    "optional": true;
                },
                {
                    "name": "sourceDeposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "source_deposit.user";
                                "account": "deposit";
                            },
                            {
                                "kind": "account";
                                "path": "source_deposit.token_mint";
                                "account": "deposit";
                            }
                        ];
                    };
                },
                {
                    "name": "destinationDeposit";
                    "writable": true;
                },
                {
                    "name": "tokenMint";
                    "relations": [
                        "sourceDeposit",
                        "destinationDeposit"
                    ];
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                }
            ];
            "args": [
                {
                    "name": "amount";
                    "type": "u64";
                }
            ];
        },
        {
            "name": "undelegate";
            "docs": [
                "Commits and undelegates the deposit account from the ephemeral rollups program.",
                "",
                "Uses the ephemeral rollups SDK to commit and undelegate the deposit account."
            ];
            "discriminator": [
                131,
                148,
                180,
                198,
                91,
                104,
                42,
                238
            ];
            "accounts": [
                {
                    "name": "user";
                },
                {
                    "name": "payer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "sessionToken";
                    "optional": true;
                },
                {
                    "name": "deposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "user";
                            },
                            {
                                "kind": "account";
                                "path": "deposit.token_mint";
                                "account": "deposit";
                            }
                        ];
                    };
                },
                {
                    "name": "magicProgram";
                    "address": "Magic11111111111111111111111111111111111111";
                },
                {
                    "name": "magicContext";
                    "writable": true;
                    "address": "MagicContext1111111111111111111111111111111";
                }
            ];
            "args": [];
        },
        {
            "name": "undelegateUsernameDeposit";
            "docs": [
                "Commits and undelegates the username-based deposit account from the ephemeral rollups program."
            ];
            "discriminator": [
                169,
                131,
                184,
                97,
                218,
                190,
                134,
                4
            ];
            "accounts": [
                {
                    "name": "payer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "session";
                },
                {
                    "name": "deposit";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
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
                                ];
                            },
                            {
                                "kind": "arg";
                                "path": "usernameHash";
                            },
                            {
                                "kind": "arg";
                                "path": "tokenMint";
                            }
                        ];
                    };
                },
                {
                    "name": "magicProgram";
                    "address": "Magic11111111111111111111111111111111111111";
                },
                {
                    "name": "magicContext";
                    "writable": true;
                    "address": "MagicContext1111111111111111111111111111111";
                }
            ];
            "args": [
                {
                    "name": "usernameHash";
                    "type": {
                        "array": [
                            "u8",
                            32
                        ];
                    };
                },
                {
                    "name": "tokenMint";
                    "type": "pubkey";
                }
            ];
        }
    ];
    "accounts": [
        {
            "name": "deposit";
            "discriminator": [
                148,
                146,
                121,
                66,
                207,
                173,
                21,
                227
            ];
        },
        {
            "name": "sessionToken";
            "discriminator": [
                233,
                4,
                115,
                14,
                46,
                21,
                1,
                15
            ];
        },
        {
            "name": "telegramSession";
            "discriminator": [
                166,
                166,
                101,
                241,
                97,
                253,
                72,
                138
            ];
        },
        {
            "name": "usernameDeposit";
            "discriminator": [
                242,
                23,
                53,
                35,
                55,
                192,
                177,
                246
            ];
        },
        {
            "name": "vault";
            "discriminator": [
                211,
                8,
                232,
                43,
                2,
                152,
                117,
                119
            ];
        }
    ];
    "errors": [
        {
            "code": 6000;
            "name": "unauthorized";
            "msg": "unauthorized";
        },
        {
            "code": 6001;
            "name": "overflow";
            "msg": "overflow";
        },
        {
            "code": 6002;
            "name": "invalidMint";
            "msg": "Invalid Mint";
        },
        {
            "code": 6003;
            "name": "insufficientVault";
            "msg": "Insufficient Vault";
        },
        {
            "code": 6004;
            "name": "insufficientDeposit";
            "msg": "Insufficient Deposit";
        },
        {
            "code": 6005;
            "name": "notVerified";
            "msg": "Not Verified";
        },
        {
            "code": 6006;
            "name": "expiredSignature";
            "msg": "Expired Signature";
        },
        {
            "code": 6007;
            "name": "replay";
            "msg": "replay";
        },
        {
            "code": 6008;
            "name": "invalidEd25519";
            "msg": "Invalid Ed25519";
        },
        {
            "code": 6009;
            "name": "invalidUsername";
            "msg": "Invalid Username";
        },
        {
            "code": 6010;
            "name": "invalidRecipient";
            "msg": "Invalid Recipient";
        },
        {
            "code": 6011;
            "name": "invalidDepositor";
            "msg": "Invalid Depositor";
        }
    ];
    "types": [
        {
            "name": "deposit";
            "docs": [
                "A deposit account for a user and token mint."
            ];
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "user";
                        "type": "pubkey";
                    },
                    {
                        "name": "tokenMint";
                        "type": "pubkey";
                    },
                    {
                        "name": "amount";
                        "type": "u64";
                    }
                ];
            };
        },
        {
            "name": "modifyDepositArgs";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "amount";
                        "type": "u64";
                    },
                    {
                        "name": "increase";
                        "type": "bool";
                    }
                ];
            };
        },
        {
            "name": "sessionToken";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "authority";
                        "type": "pubkey";
                    },
                    {
                        "name": "targetProgram";
                        "type": "pubkey";
                    },
                    {
                        "name": "sessionSigner";
                        "type": "pubkey";
                    },
                    {
                        "name": "validUntil";
                        "type": "i64";
                    }
                ];
            };
        },
        {
            "name": "telegramSession";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "userWallet";
                        "type": "pubkey";
                    },
                    {
                        "name": "usernameHash";
                        "type": {
                            "array": [
                                "u8",
                                32
                            ];
                        };
                    },
                    {
                        "name": "validationBytes";
                        "type": "bytes";
                    },
                    {
                        "name": "verified";
                        "type": "bool";
                    },
                    {
                        "name": "authAt";
                        "type": "u64";
                    },
                    {
                        "name": "verifiedAt";
                        "type": {
                            "option": "u64";
                        };
                    }
                ];
            };
        },
        {
            "name": "usernameDeposit";
            "docs": [
                "A deposit account for a telegram username sha256 hash and token mint."
            ];
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "usernameHash";
                        "type": {
                            "array": [
                                "u8",
                                32
                            ];
                        };
                    },
                    {
                        "name": "tokenMint";
                        "type": "pubkey";
                    },
                    {
                        "name": "amount";
                        "type": "u64";
                    }
                ];
            };
        },
        {
            "name": "vault";
            "docs": [
                "A vault storing deposited tokens.",
                "Has a dummy field because Anchor requires it."
            ];
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "dummy";
                        "type": "u8";
                    }
                ];
            };
        }
    ];
};
