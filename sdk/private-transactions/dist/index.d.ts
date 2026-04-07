/**
 * @loyal-labs/private-transactions - SDK for private Solana deposits with MagicBlock PER
 *
 * This SDK provides an interface for managing private token deposits using
 * MagicBlock's Private Ephemeral Rollups (PER) for confidential transactions.
 *
 * @example
 * // Create one client that has base + ephemeral program access
 * import { Keypair, PublicKey } from "@solana/web3.js";
 * import {
 *   ER_VALIDATOR,
 *   ER_VALIDATOR_MAINNET,
 *   LoyalPrivateTransactionsClient,
 *   MAGIC_CONTEXT_ID,
 *   MAGIC_PROGRAM_ID,
 * } from "@loyal-labs/private-transactions";
 *
 * const signer = Keypair.fromSecretKey(Uint8Array.from([...secretBytes]));
 * const tokenMint = new PublicKey("<token-mint>");
 *
 * const client = await LoyalPrivateTransactionsClient.fromConfig({
 *   signer,
 *   baseRpcEndpoint: "https://api.devnet.solana.com",
 *   ephemeralRpcEndpoint: "https://mainnet-tee.magicblock.app",
 *   ephemeralWsEndpoint: "wss://mainnet-tee.magicblock.app",
 * });
 *
 * await client.createPermission({ user: signer.publicKey, tokenMint, payer: signer.publicKey });
 * await client.delegateDeposit({ user: signer.publicKey, tokenMint, payer: signer.publicKey, validator: ER_VALIDATOR_MAINNET });
 * await client.transferToUsernameDeposit({ username: "alice_user", tokenMint, amount: 100_000, user: signer.publicKey, payer: signer.publicKey, sessionToken: null });
 * await client.undelegateDeposit({ user: signer.publicKey, tokenMint, payer: signer.publicKey, sessionToken: null, magicProgram: MAGIC_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID });
 */
export { LoyalPrivateTransactionsClient, waitForAccountOwnerChange, } from "./src/LoyalPrivateTransactionsClient";
export type { WalletSigner, WalletLike, RpcOptions, ClientConfig, DepositData, UsernameDepositData, InitializeDepositParams, ModifyBalanceParams, ModifyBalanceResult, CreatePermissionParams, CreateUsernamePermissionParams, DelegateDepositParams, DelegateUsernameDepositParams, UndelegateDepositParams, UndelegateUsernameDepositParams, TransferDepositParams, TransferToUsernameDepositParams, DelegationRecord, DelegationStatusResult, DelegationStatusResponse, } from "./src/types";
export { isKeypair, isAnchorProvider, isWalletLike } from "./src/types";
export { ER_VALIDATOR, ER_VALIDATOR_DEVNET, ER_VALIDATOR_MAINNET, getErValidatorForSolanaEnv, getErValidatorForRpcEndpoint, PROGRAM_ID, DELEGATION_PROGRAM_ID, PERMISSION_PROGRAM_ID, MAGIC_PROGRAM_ID, MAGIC_CONTEXT_ID, DEPOSIT_SEED, DEPOSIT_SEED_BYTES, USERNAME_DEPOSIT_SEED, USERNAME_DEPOSIT_SEED_BYTES, VAULT_SEED, VAULT_SEED_BYTES, PERMISSION_SEED, PERMISSION_SEED_BYTES, LAMPORTS_PER_SOL, solToLamports, lamportsToSol, } from "./src/constants";
export { findDepositPda, findUsernameDepositPda, findVaultPda, findPermissionPda, findDelegationRecordPda, findDelegationMetadataPda, findBufferPda, } from "./src/pda";
export declare const IDL: {
    address: string;
    metadata: {
        name: string;
        version: string;
        spec: string;
        description: string;
    };
    instructions: ({
        name: string;
        docs: string[];
        discriminator: number[];
        accounts: ({
            name: string;
            relations: string[];
            writable?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            relations?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            pda: {
                seeds: ({
                    kind: string;
                    value: number[];
                    path?: undefined;
                    account?: undefined;
                } | {
                    kind: string;
                    path: string;
                    account: string;
                    value?: undefined;
                })[];
            };
            relations?: undefined;
            address?: undefined;
        } | {
            name: string;
            relations?: undefined;
            writable?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            address: string;
            relations?: undefined;
            writable?: undefined;
            pda?: undefined;
        })[];
        args: {
            name: string;
            type: string;
        }[];
    } | {
        name: string;
        docs: string[];
        discriminator: number[];
        accounts: ({
            name: string;
            writable: boolean;
            signer: boolean;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            signer: boolean;
            writable?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            pda: {
                seeds: ({
                    kind: string;
                    value: number[];
                    path?: undefined;
                    account?: undefined;
                } | {
                    kind: string;
                    path: string;
                    value?: undefined;
                    account?: undefined;
                } | {
                    kind: string;
                    path: string;
                    account: string;
                    value?: undefined;
                })[];
            };
            writable?: undefined;
            signer?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            signer?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable?: undefined;
            signer?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            address: string;
            writable?: undefined;
            signer?: undefined;
            pda?: undefined;
        })[];
        args: never[];
    } | {
        name: string;
        docs: string[];
        discriminator: number[];
        accounts: ({
            name: string;
            writable: boolean;
            signer: boolean;
            optional?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            optional: boolean;
            writable?: undefined;
            signer?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            pda: {
                seeds: ({
                    kind: string;
                    value: number[];
                    path?: undefined;
                } | {
                    kind: string;
                    path: string;
                    value?: undefined;
                })[];
                program: {
                    kind: string;
                    value: number[];
                    path?: undefined;
                };
            };
            signer?: undefined;
            optional?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            pda: {
                seeds: ({
                    kind: string;
                    value: number[];
                    path?: undefined;
                } | {
                    kind: string;
                    path: string;
                    value?: undefined;
                })[];
                program: {
                    kind: string;
                    path: string;
                    value?: undefined;
                };
            };
            signer?: undefined;
            optional?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            pda: {
                seeds: ({
                    kind: string;
                    value: number[];
                    path?: undefined;
                } | {
                    kind: string;
                    path: string;
                    value?: undefined;
                })[];
                program?: undefined;
            };
            signer?: undefined;
            optional?: undefined;
            address?: undefined;
        } | {
            name: string;
            address: string;
            writable?: undefined;
            signer?: undefined;
            optional?: undefined;
            pda?: undefined;
        })[];
        args: ({
            name: string;
            type: {
                array: (string | number)[];
            };
        } | {
            name: string;
            type: string;
        })[];
    } | {
        name: string;
        discriminator: number[];
        accounts: ({
            name: string;
            writable: boolean;
            signer: boolean;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            pda: {
                seeds: ({
                    kind: string;
                    value: number[];
                    path?: undefined;
                } | {
                    kind: string;
                    path: string;
                    value?: undefined;
                })[];
            };
            signer?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable?: undefined;
            signer?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            address: string;
            writable?: undefined;
            signer?: undefined;
            pda?: undefined;
        })[];
        args: {
            name: string;
            type: {
                array: (string | number)[];
            };
        }[];
        docs?: undefined;
    } | {
        name: string;
        docs: string[];
        discriminator: number[];
        accounts: ({
            name: string;
            writable: boolean;
            signer: boolean;
            relations?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            signer: boolean;
            relations: string[];
            writable?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            pda: {
                seeds: ({
                    kind: string;
                    value: number[];
                    path?: undefined;
                    account?: undefined;
                } | {
                    kind: string;
                    path: string;
                    account: string;
                    value?: undefined;
                })[];
                program?: undefined;
            };
            signer?: undefined;
            relations?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            pda: {
                seeds: ({
                    kind: string;
                    path: string;
                    value?: undefined;
                } | {
                    kind: string;
                    value: number[];
                    path?: undefined;
                })[];
                program: {
                    kind: string;
                    value: number[];
                };
            };
            signer?: undefined;
            relations?: undefined;
            address?: undefined;
        } | {
            name: string;
            relations: string[];
            writable?: undefined;
            signer?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            address: string;
            writable?: undefined;
            signer?: undefined;
            relations?: undefined;
            pda?: undefined;
        })[];
        args: {
            name: string;
            type: {
                defined: {
                    name: string;
                };
            };
        }[];
    } | {
        name: string;
        discriminator: number[];
        accounts: ({
            name: string;
            writable: boolean;
        } | {
            name: string;
            writable?: undefined;
        })[];
        args: {
            name: string;
            type: {
                vec: string;
            };
        }[];
        docs?: undefined;
    } | {
        name: string;
        docs: string[];
        discriminator: number[];
        accounts: ({
            name: string;
            relations: string[];
            writable?: undefined;
            signer?: undefined;
            optional?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            signer: boolean;
            relations?: undefined;
            optional?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            optional: boolean;
            relations?: undefined;
            writable?: undefined;
            signer?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            pda: {
                seeds: ({
                    kind: string;
                    value: number[];
                    path?: undefined;
                    account?: undefined;
                } | {
                    kind: string;
                    path: string;
                    account: string;
                    value?: undefined;
                })[];
            };
            relations?: undefined;
            signer?: undefined;
            optional?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            relations?: undefined;
            signer?: undefined;
            optional?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            address: string;
            relations?: undefined;
            writable?: undefined;
            signer?: undefined;
            optional?: undefined;
            pda?: undefined;
        })[];
        args: {
            name: string;
            type: string;
        }[];
    } | {
        name: string;
        docs: string[];
        discriminator: number[];
        accounts: ({
            name: string;
            writable?: undefined;
            signer?: undefined;
            optional?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            signer: boolean;
            optional?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            optional: boolean;
            writable?: undefined;
            signer?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            pda: {
                seeds: ({
                    kind: string;
                    value: number[];
                    path?: undefined;
                    account?: undefined;
                } | {
                    kind: string;
                    path: string;
                    value?: undefined;
                    account?: undefined;
                } | {
                    kind: string;
                    path: string;
                    account: string;
                    value?: undefined;
                })[];
            };
            signer?: undefined;
            optional?: undefined;
            address?: undefined;
        } | {
            name: string;
            address: string;
            writable?: undefined;
            signer?: undefined;
            optional?: undefined;
            pda?: undefined;
        } | {
            name: string;
            writable: boolean;
            address: string;
            signer?: undefined;
            optional?: undefined;
            pda?: undefined;
        })[];
        args: never[];
    } | {
        name: string;
        docs: string[];
        discriminator: number[];
        accounts: ({
            name: string;
            writable: boolean;
            signer: boolean;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable?: undefined;
            signer?: undefined;
            pda?: undefined;
            address?: undefined;
        } | {
            name: string;
            writable: boolean;
            pda: {
                seeds: ({
                    kind: string;
                    value: number[];
                    path?: undefined;
                } | {
                    kind: string;
                    path: string;
                    value?: undefined;
                })[];
            };
            signer?: undefined;
            address?: undefined;
        } | {
            name: string;
            address: string;
            writable?: undefined;
            signer?: undefined;
            pda?: undefined;
        } | {
            name: string;
            writable: boolean;
            address: string;
            signer?: undefined;
            pda?: undefined;
        })[];
        args: ({
            name: string;
            type: {
                array: (string | number)[];
            };
        } | {
            name: string;
            type: string;
        })[];
    })[];
    accounts: {
        name: string;
        discriminator: number[];
    }[];
    errors: {
        code: number;
        name: string;
        msg: string;
    }[];
    types: ({
        name: string;
        type: {
            kind: string;
            fields: ({
                name: string;
                type: string;
            } | {
                name: string;
                type: {
                    array: (string | number)[];
                    option?: undefined;
                };
            } | {
                name: string;
                type: {
                    option: string;
                    array?: undefined;
                };
            })[];
        };
        docs?: undefined;
    } | {
        name: string;
        docs: string[];
        type: {
            kind: string;
            fields: ({
                name: string;
                type: {
                    array: (string | number)[];
                };
                docs?: undefined;
            } | {
                name: string;
                type: string;
                docs?: undefined;
            } | {
                name: string;
                docs: string[];
                type: string;
            })[];
        };
    })[];
};
export type { TelegramPrivateTransfer } from "./src/idl/telegram_private_transfer.ts";
