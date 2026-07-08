# Earn Sponsored Zero-SOL Verifier Run

- generatedAt: 2026-07-08T18:54:38.358Z
- verdict: PASS
- solanaEnv: mainnet
- walletAddress: 2ghJTZLuobNiVwc1Ebd8uxbXVCfFBqR9VPowNogjCw92
- sponsorFeePayer: HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY
- rpcUrl: https://beta.helius-rpc.com/?api-key=[REDACTED]

## Required Checks

- both sponsored live scripts exit 0 and emit PASS evidence
- safety preflight finds no /prefund/sponsored endpoint literals and no direct wallet-send calls in child sponsored verifiers
- no /prefund/sponsored evidence is present
- no evidence step reports sponsored: false for setup/close
- every emitted signature is confirmed on mainnet
- every emitted transaction fee payer is the sponsor
- the test wallet has zero pre/post SOL balance and zero SOL delta in every emitted transaction
- no emitted transaction transfers SOL to the test wallet

## Verdict

PASS

## Failures

- none

## Prefund Evidence

- none

## Chain Checks

| status  | signature                                                                                | fee payer                                    | wallet pre | wallet post | wallet delta | system transfer to wallet | source                                                                                                                                                                                                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- | ---------: | ----------: | -----------: | ------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| success | 65PT16HkRu4AUysVtx68BvAmpkpAuHF2U1ATBZL5NecQBeX9Fgg78DAdPpTKEsCqHKPmAHCEKFdo3w3V6wA4sTHW | HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY |          0 |           0 |            0 |                         0 | earn-mainnet-sponsored.evidence.steps.depositConfirm.backend.sponsoredConfirmations.deposit.signature, earn-mainnet-sponsored.evidence.steps.depositConfirm.signature, earn-mainnet-sponsored.evidence.steps.depositConfirm.sponsoredConfirmations.deposit.signature                                                                           |
| success | 5kVA9jNg5R2ZBgBer7ffC1ZWXs8ehBMfM7WsvonSitMNCHa222q4sps2aZYCm6bXozvwxfeDCswH73REKEGwNSvw | HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY |          0 |           0 |            0 |                         0 | earn-mainnet-sponsored.evidence.steps.depositConfirm.backend.sponsoredConfirmations.kaminoSetup.signature, earn-mainnet-sponsored.evidence.steps.depositConfirm.sponsoredConfirmations.kaminoSetup.signature                                                                                                                                   |
| success | 3MSmCeuHjM1HYoLWHspENRXvZX1pm2A1AS9MW66KACM3YNLb4ryFgtxXpw5EWDLcUa2eXEFxkystyCPfocJfLoSj | HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY |          0 |           0 |            0 |                         0 | earn-mainnet-sponsored.evidence.steps.depositConfirm.backend.sponsoredConfirmations.policy.signature, earn-mainnet-sponsored.evidence.steps.depositConfirm.sponsoredConfirmations.policy.signature                                                                                                                                             |
| success | 3QT2P86cz9quVMVhunjY22r1w7WceNHbZcvDzJZiv5PqwXsV8QEe6AVEkytyGE881wTWBDTX2CUiNZErLTBwmvK4 | HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY |          0 |           0 |            0 |                         0 | earn-mainnet-sponsored.evidence.steps.withdrawConfirm.backend.sponsoredConfirmations.policyClose.signature, earn-mainnet-sponsored.evidence.steps.withdrawConfirm.sponsoredConfirmations.policyClose.signature                                                                                                                                 |
| success | 3QybFQtbyUizXn1q1TNw926EqGPAtQe7y7Go7x7RSbQgPe7qr4yPSt5TQZW6ZTieQAaibpvcL23BwYsD4oY7xTA  | HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY |          0 |           0 |            0 |                         0 | earn-mainnet-sponsored.evidence.steps.withdrawConfirm.backend.sponsoredConfirmations.withdrawal.signature, earn-mainnet-sponsored.evidence.steps.withdrawConfirm.signature, earn-mainnet-sponsored.evidence.steps.withdrawConfirm.sponsoredConfirmations.withdrawal.signature                                                                  |
| success | 23xUpmYHxirGcYremBfaiCbF3yvc3yK73joirrt6Tt7sMD3Y6dvR3aR6No5Cdsvm7EqTgrUBc8DFtP6YyXJg117R | HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY |          0 |           0 |            0 |                         0 | earn-autodeposit-mainnet-sponsored.evidence.steps.setupConfirmations.backend.0.backend.sponsoredConfirmations.setup.signature, earn-autodeposit-mainnet-sponsored.evidence.steps.setupConfirmations.backend.0.signature, earn-autodeposit-mainnet-sponsored.evidence.steps.setupConfirmations.backend.0.sponsoredConfirmations.setup.signature |
| success | cTPf3MFpszjWXLCxQoKAihvf2veXtiUJJESoPLKSg9KVRjWpQtw1Jm3bjqGEBZFV91Db8Af1jAENmGpQ7VBP6D7  | HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY |          0 |           0 |            0 |                         0 | earn-autodeposit-mainnet-sponsored.evidence.steps.setupConfirmations.backend.1.backend.sponsoredConfirmations.setup.signature, earn-autodeposit-mainnet-sponsored.evidence.steps.setupConfirmations.backend.1.signature, earn-autodeposit-mainnet-sponsored.evidence.steps.setupConfirmations.backend.1.sponsoredConfirmations.setup.signature |
| success | 3KHoCozjZvuhrNxLcwdmgv3A8zD8WSYHkkaghFuzDEMLReNK8hpm8tYaarrwzXC4v4LZvYRcTJP7nkdnWpwpXmYm | HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY |          0 |           0 |            0 |                         0 | earn-autodeposit-mainnet-sponsored.evidence.steps.closeConfirm.backend.sponsoredConfirmations.close.signature, earn-autodeposit-mainnet-sponsored.evidence.steps.closeConfirm.signature, earn-autodeposit-mainnet-sponsored.evidence.steps.closeConfirm.sponsoredConfirmations.close.signature                                                 |

## Flow Logs

### earn-mainnet-sponsored

- exitCode: 0
- ok: true
- first stdout line: [earn-mainnet-sponsored] PASS
- first stderr line: (empty)

stdout:

```
[earn-mainnet-sponsored] PASS
{
  "config": {
    "amountRaw": "10000",
    "frontendBaseUrl": "http://localhost:3004",
    "rpcUrl": "https://beta.helius-rpc.com/?api-key=[REDACTED]",
    "settingsPda": "7RcoGn2PNA1vwNiawXKpDJkvcCva9kji34vtUU6gtGzp",
    "smartAccountAddress": "EkmhqhYjncNzQ1fMAH8YWPVbMdpVRyeKCgXMvQtF6NZQ",
    "solanaEnv": "mainnet",
    "sponsorFeePayer": "HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY",
    "walletAddress": "2ghJTZLuobNiVwc1Ebd8uxbXVCfFBqR9VPowNogjCw92"
  },
  "steps": {
    "policyPrepare": {
      "instructionCount": 2,
      "persistence": {
        "cluster": "mainnet-beta",
        "walletAddress": "2ghJTZLuobNiVwc1Ebd8uxbXVCfFBqR9VPowNogjCw92",
        "delegatedSigner": "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5",
        "settings": "7RcoGn2PNA1vwNiawXKpDJkvcCva9kji34vtUU6gtGzp",
        "vaultIndex": 1,
        "vaultPubkey": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA",
        "policyId": "24",
        "policyAccount": "6hnaHjELxge4vK4TSyUpgGrXkANgkK2pG36qX6wLfRda",
        "policySeed": "24",
        "setupPolicyId": "25",
        "setupPolicyAccount": "2XVa2PkRdwfyMT7zkAu1hV57qgVQ57B9X9rzcpXdrjMK",
        "setupPolicySeed": "25",
        "targetReserve": "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
        "market": "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
        "liquidityMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "riskProfile": "safe",
        "universePreset": "canonical_stable_kamino",
        "routeModes": [
          "same_mint_kamino"
        ],
        "stableMints": [
          "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH",
          "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
          "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
          "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
          "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA"
        ],
        "kaminoMarkets": [
          "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
          "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA",
          "6WEGfej9B9wjxRs6t4BYpb9iCXd8CpTpJ8fVSNzHCC5y",
          "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8",
          "BJnbcRHqvppTyGesLzWASGKnmnF1wq9jZu6ExrjT7wvF"
        ],
        "kaminoLiquidityMints": [
          "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH",
          "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
          "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
          "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
          "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA"
        ],
        "swapLanes": [],
        "threshold": 1
      },
      "status": "success"
    },
    "policySponsoredConfirm": {
      "backend": {
        "policy": {
          "account": "6hnaHjELxge4vK4TSyUpgGrXkANgkK2pG36qX6wLfRda",
          "id": "1514",
          "seed": "24",
          "vaultIndex": 1,
          "vaultPubkey": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA"
        },
        "sponsoredConfirmations": {
          "policy": {
            "confirmedSlot": "431645701",
            "signature": "3MSmCeuHjM1HYoLWHspENRXvZX1pm2A1AS9MW66KACM3YNLb4ryFgtxXpw5EWDLcUa2eXEFxkystyCPfocJfLoSj"
          },
          "setupPolicy": {
            "confirmedSlot": "431645707",
            "signature": "9vLU2tuhbt6UKEGZdoiYSwUTtTJyXJsB1aqKgJL2XjnbfuFXrPKms49XtGCN7TnVnNofmjjNhCdpJnjMsUVNr4E"
          }
        }
      },
      "endpoint": "/api/smart-accounts/yield-optimization/policies/confirm/sponsored",
      "sponsoredConfirmations": {
        "policy": {
          "confirmedSlot": "431645701",
          "signature": "3MSmCeuHjM1HYoLWHspENRXvZX1pm2A1AS9MW66KACM3YNLb4ryFgtxXpw5EWDLcUa2eXEFxkystyCPfocJfLoSj"
        },
        "setupPolicy": {
          "confirmedSlot": "431645707",
          "signature": "9vLU2tuhbt6UKEGZdoiYSwUTtTJyXJsB1aqKgJL2XjnbfuFXrPKms49XtGCN7TnVnNofmjjNhCdpJnjMsUVNr4E"
        }
      },
      "status": "success"
    },
    "postPolicyEarnState": {
      "backend": {
        "autodeposit": null,
        "canonicalVaultPubkey": "EkmhqhYjncNzQ1fMAH8YWPVbMdpVRyeKCgXMvQtF6NZQ",
        "loadErrors": {},
        "onboarding": {
          "nextStep": "deposit",
          "depositConfirmedSlot": null,
          "depositSignature": null,
          "lastErrorCode": null,
          "policy": {
            "account": "6hnaHjELxge4vK4TSyUpgGrXkANgkK2pG36qX6wLfRda",
            "id": "24",
            "lastSeenSignature": "3MSmCeuHjM1HYoLWHspENRXvZX1pm2A1AS9MW66KACM3YNLb4ryFgtxXpw5EWDLcUa2eXEFxkystyCPfocJfLoSj",
            "lastSeenSlot": "431645701",
            "seed": "24"
          },
          "setupPolicy": {
            "account": "2XVa2PkRdwfyMT7zkAu1hV57qgVQ57B9X9rzcpXdrjMK",
            "id": "25",
            "lastSeenSignature": "9vLU2tuhbt6UKEGZdoiYSwUTtTJyXJsB1aqKgJL2XjnbfuFXrPKms49XtGCN7TnVnNofmjjNhCdpJnjMsUVNr4E",
            "lastSeenSlot": "431645707",
            "seed": "25"
          },
          "status": "setup_policy_confirmed",
          "updatedAt": "2026-07-08T18:53:47.847Z"
        },
        "policy": {
          "account": "6hnaHjELxge4vK4TSyUpgGrXkANgkK2pG36qX6wLfRda",
          "delegatedSigners": [
            "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5"
          ],
          "id": "1514",
          "kaminoLiquidityMints": [
            "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH",
            "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
            "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
            "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA"
          ],
          "kaminoMarkets": [
            "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
            "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA",
            "6WEGfej9B9wjxRs6t4BYpb9iCXd8CpTpJ8fVSNzHCC5y",
            "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8",
            "BJnbcRHqvppTyGesLzWASGKnmnF1wq9jZu6ExrjT7wvF"
          ],
          "lastSeenSignature": "3MSmCeuHjM1HYoLWHspENRXvZX1pm2A1AS9MW66KACM3YNLb4ryFgtxXpw5EWDLcUa2eXEFxkystyCPfocJfLoSj",
          "lastSeenSlot": "431645701",
          "riskProfile": "safe",
          "routeModes": [
            "same_mint_kamino"
          ],
          "seed": "24",
          "setupPolicy": {
            "account": "2XVa2PkRdwfyMT7zkAu1hV57qgVQ57B9X9rzcpXdrjMK",
            "delegatedSigners": [
              "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5"
            ],
            "id": "1516",
            "lastSeenSignature": "9vLU2tuhbt6UKEGZdoiYSwUTtTJyXJsB1aqKgJL2XjnbfuFXrPKms49XtGCN7TnVnNofmjjNhCdpJnjMsUVNr4E",
            "lastSeenSlot": "431645707",
            "seed": "25"
          },
          "stableMints": [
            "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH",
            "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
            "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
            "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA"
          ],
          "universePreset": "canonical_stable_kamino",
          "vaultIndex": 1,
          "vaultPubkey": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA"
        },
        "position": null,
        "policySignerPublicKey": "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5",
        "settingsPda": "7RcoGn2PNA1vwNiawXKpDJkvcCva9kji34vtUU6gtGzp",
        "vault": {
          "accountIndex": 1,
          "pubkey": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA"
        }
      },
      "status": "success"
    },
    "depositPrepare": {
      "attempts": [
        {
          "attempt": 1,
          "policyAccount": "6hnaHjELxge4vK4TSyUpgGrXkANgkK2pG36qX6wLfRda",
          "policyInitialization": "reuse",
          "policySeed": "24"
        }
      ],
      "instructionCount": 4,
      "nativeSolRequirement": {
        "balanceLamports": "821193040",
        "balanceSource": "queried",
        "canProceed": true,
        "deficitLamports": "0",
        "items": [
          {
            "kind": "transaction_fee",
            "label": "Estimated transaction fee",
            "lamports": "10000",
            "stage": "earnUsdcDepositKaminoSetup"
          },
          {
            "kind": "transaction_fee",
            "label": "Estimated transaction fee",
            "lamports": "10000",
            "stage": "earnUsdcDeposit"
          }
        ],
        "payer": "HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY",
        "requiredLamports": "20000"
      },
      "persistence": {
        "cluster": "mainnet-beta",
        "walletAddress": "2ghJTZLuobNiVwc1Ebd8uxbXVCfFBqR9VPowNogjCw92",
        "delegatedSigner": "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5",
        "settings": "7RcoGn2PNA1vwNiawXKpDJkvcCva9kji34vtUU6gtGzp",
        "vaultIndex": 1,
        "vaultPubkey": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA",
        "policyId": "24",
        "policyAccount": "6hnaHjELxge4vK4TSyUpgGrXkANgkK2pG36qX6wLfRda",
        "policySeed": "24",
        "setupPolicyId": "25",
        "setupPolicyAccount": "2XVa2PkRdwfyMT7zkAu1hV57qgVQ57B9X9rzcpXdrjMK",
        "setupPolicySeed": "25",
        "targetReserve": "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
        "market": "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
        "liquidityMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "depositMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "principalAmountRaw": "10000",
        "policyInitialization": "reuse",
        "targetSupplyApyBps": null,
        "kaminoLiquidityMints": [
          "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH",
          "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
          "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
          "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
          "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA"
        ],
        "kaminoMarkets": [
          "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
          "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA",
          "6WEGfej9B9wjxRs6t4BYpb9iCXd8CpTpJ8fVSNzHCC5y",
          "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8",
          "BJnbcRHqvppTyGesLzWASGKnmnF1wq9jZu6ExrjT7wvF"
        ],
        "riskProfile": "safe",
        "routeModes": [
          "same_mint_kamino"
        ],
        "stableMints": [
          "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH",
          "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
          "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
          "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
          "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA"
        ],
        "universePreset": "canonical_stable_kamino"
      },
      "status": "success"
    },
    "depositConfirm": {
      "backend": {
        "position": {
          "currentHolding": {
            "amountRaw": "10000",
            "liquidityMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "market": "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
            "observedAt": "2026-07-08T18:53:58.877Z",
            "observedSlot": "431645731",
            "provenance": {
              "lastHoldingEventId": "455666",
              "lastRebalanceDecisionId": null
            },
            "reserve": "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"
          },
          "id": "169",
          "initialHolding": {
            "liquidityMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "market": "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
            "reserve": "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
            "supplyApyBps": null
          },
          "principalAmountRaw": "10000",
          "status": "active"

... truncated 10770 chars ...
```

stderr:

```

```

### earn-autodeposit-mainnet-sponsored

- exitCode: 0
- ok: true
- first stdout line: [earn-autodeposit-mainnet-sponsored] PASS
- first stderr line: (empty)

stdout:

```
[earn-autodeposit-mainnet-sponsored] PASS
{
  "config": {
    "amountRaw": "10000",
    "cluster": "mainnet-beta",
    "frontendBaseUrl": "http://localhost:3004",
    "nonce": "1783536856789",
    "periodLengthSeconds": null,
    "policySigner": "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5",
    "programId": "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG",
    "requestedPolicySeed": null,
    "requestedStartTimestamp": null,
    "settingsPda": "7RcoGn2PNA1vwNiawXKpDJkvcCva9kji34vtUU6gtGzp",
    "smartAccountAddress": "EkmhqhYjncNzQ1fMAH8YWPVbMdpVRyeKCgXMvQtF6NZQ",
    "solanaEnv": "mainnet",
    "sponsorFeePayer": "HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY",
    "walletAddress": "2ghJTZLuobNiVwc1Ebd8uxbXVCfFBqR9VPowNogjCw92",
    "walletBalanceFloorRaw": "0"
  },
  "steps": {
    "initialPrepare": {
      "amountRaw": "10000",
      "instructionCount": 1,
      "nativeSolRequirement": {
        "balanceLamports": "7290160",
        "balanceSource": "assumed_sufficient",
        "canProceed": true,
        "deficitLamports": "0",
        "items": [
          {
            "account": "D1VgmXFGdxruMP7SuY3YNz2YZMbK3HtnhAEqkijn2jMt",
            "kind": "policy_rent",
            "label": "Autodeposit policy account rent",
            "lamports": "7280160",
            "stage": "create_policy"
          },
          {
            "kind": "transaction_fee",
            "label": "Estimated transaction fee",
            "lamports": "10000",
            "stage": "earnUsdcAutodepositCreatePolicy"
          }
        ],
        "payer": "HeivpfCmDQ2xa4A4Nt4uGkimy5mzogDgfi4XrnEDrqdY",
        "requiredLamports": "7290160"
      },
      "persistence": {
        "cluster": "mainnet-beta",
        "walletAddress": "2ghJTZLuobNiVwc1Ebd8uxbXVCfFBqR9VPowNogjCw92",
        "delegatedSigner": "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5",
        "settings": "7RcoGn2PNA1vwNiawXKpDJkvcCva9kji34vtUU6gtGzp",
        "vaultIndex": 1,
        "vaultPubkey": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA",
        "subscriptionDelegatee": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA",
        "amountPerPeriodRaw": "10000",
        "minimumDelegatorBalanceRaw": "0",
        "periodLengthSeconds": "2592000",
        "nonce": "1783536856789",
        "startTimestamp": "1783536858",
        "expiryTimestamp": "0",
        "liquidityMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "subscriptionAuthority": "EuDzuMcs1nmBStoTRRwNqEXHhKx4kFb53PwWDhCxTRMf",
        "recurringDelegation": "Biaqf5KcreuuUF6Db7ADSEqYcrJKVyKhVqCQ2N3UABcR",
        "walletUsdcAta": "4yJJXTdh3gG7E8nd5CvKNKGxXXpRo7rZ7L2t7kU7QdEh",
        "vaultUsdcAta": "GDjXvqtSVnhWGueB69C6RhgDCnRHPjEsvW4msxqL4e4V",
        "policyId": "26",
        "policyAccount": "D1VgmXFGdxruMP7SuY3YNz2YZMbK3HtnhAEqkijn2jMt",
        "policySeed": "26",
        "subscriptionAuthorityInitialization": "exists"
      },
      "stage": "create_policy",
      "status": "success"
    },
    "setupConfirmations": {
      "backend": [
        {
          "backend": {
            "confirmedSlot": "431645788",
            "target": {
              "active": false,
              "balanceSweepPolicyId": "614",
              "id": "619",
              "lifecycleStatus": "pending_delegation",
              "policyAccount": "D1VgmXFGdxruMP7SuY3YNz2YZMbK3HtnhAEqkijn2jMt",
              "recurringDelegation": "Biaqf5KcreuuUF6Db7ADSEqYcrJKVyKhVqCQ2N3UABcR",
              "walletBalanceFloorRaw": "0"
            },
            "sponsoredConfirmations": {
              "setup": {
                "confirmedSlot": "431645788",
                "signature": "23xUpmYHxirGcYremBfaiCbF3yvc3yK73joirrt6Tt7sMD3Y6dvR3aR6No5Cdsvm7EqTgrUBc8DFtP6YyXJg117R"
              }
            }
          },
          "confirmedSlot": "431645788",
          "endpoint": "/api/smart-accounts/yield-optimization/autodeposit/setup/confirm/sponsored",
          "instructionCount": 1,
          "persistence": {
            "cluster": "mainnet-beta",
            "walletAddress": "2ghJTZLuobNiVwc1Ebd8uxbXVCfFBqR9VPowNogjCw92",
            "delegatedSigner": "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5",
            "settings": "7RcoGn2PNA1vwNiawXKpDJkvcCva9kji34vtUU6gtGzp",
            "vaultIndex": 1,
            "vaultPubkey": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA",
            "subscriptionDelegatee": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA",
            "amountPerPeriodRaw": "10000",
            "minimumDelegatorBalanceRaw": "0",
            "periodLengthSeconds": "2592000",
            "nonce": "1783536856789",
            "startTimestamp": "1783536858",
            "expiryTimestamp": "0",
            "liquidityMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "subscriptionAuthority": "EuDzuMcs1nmBStoTRRwNqEXHhKx4kFb53PwWDhCxTRMf",
            "recurringDelegation": "Biaqf5KcreuuUF6Db7ADSEqYcrJKVyKhVqCQ2N3UABcR",
            "walletUsdcAta": "4yJJXTdh3gG7E8nd5CvKNKGxXXpRo7rZ7L2t7kU7QdEh",
            "vaultUsdcAta": "GDjXvqtSVnhWGueB69C6RhgDCnRHPjEsvW4msxqL4e4V",
            "policyId": "26",
            "policyAccount": "D1VgmXFGdxruMP7SuY3YNz2YZMbK3HtnhAEqkijn2jMt",
            "policySeed": "26",
            "subscriptionAuthorityInitialization": "exists"
          },
          "signature": "23xUpmYHxirGcYremBfaiCbF3yvc3yK73joirrt6Tt7sMD3Y6dvR3aR6No5Cdsvm7EqTgrUBc8DFtP6YyXJg117R",
          "sponsored": true,
          "sponsoredConfirmations": {
            "setup": {
              "confirmedSlot": "431645788",
              "signature": "23xUpmYHxirGcYremBfaiCbF3yvc3yK73joirrt6Tt7sMD3Y6dvR3aR6No5Cdsvm7EqTgrUBc8DFtP6YyXJg117R"
            }
          },
          "stage": "create_policy",
          "status": "success"
        },
        {
          "backend": {
            "confirmedSlot": "431645796",
            "bootstrapSweep": {
              "status": "scheduled",
              "sweep": {
                "classification": "initial_surplus",
                "confidence": "confirmed_snapshot",
                "eligibleAfter": "2026-07-08T19:54:25.318Z",
                "executeNowAvailableAt": "2026-07-08T18:54:22.000Z",
                "id": "851",
                "lotCount": 1,
                "originalAmountRaw": "4989987",
                "reason": "initial Autodeposit surplus detected at setup confirmation",
                "remainingAmountRaw": "4989987",
                "slotId": "851",
                "status": "scheduled"
              }
            },
            "target": {
              "active": true,
              "balanceSweepPolicyId": "614",
              "id": "619",
              "lifecycleStatus": "active",
              "policyAccount": "D1VgmXFGdxruMP7SuY3YNz2YZMbK3HtnhAEqkijn2jMt",
              "recurringDelegation": "Biaqf5KcreuuUF6Db7ADSEqYcrJKVyKhVqCQ2N3UABcR",
              "walletBalanceFloorRaw": "0"
            },
            "sponsoredConfirmations": {
              "setup": {
                "confirmedSlot": "431645796",
                "signature": "cTPf3MFpszjWXLCxQoKAihvf2veXtiUJJESoPLKSg9KVRjWpQtw1Jm3bjqGEBZFV91Db8Af1jAENmGpQ7VBP6D7"
              }
            }
          },
          "confirmedSlot": "431645796",
          "endpoint": "/api/smart-accounts/yield-optimization/autodeposit/setup/confirm/sponsored",
          "instructionCount": 2,
          "persistence": {
            "cluster": "mainnet-beta",
            "walletAddress": "2ghJTZLuobNiVwc1Ebd8uxbXVCfFBqR9VPowNogjCw92",
            "delegatedSigner": "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5",
            "settings": "7RcoGn2PNA1vwNiawXKpDJkvcCva9kji34vtUU6gtGzp",
            "vaultIndex": 1,
            "vaultPubkey": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA",
            "subscriptionDelegatee": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA",
            "amountPerPeriodRaw": "10000",
            "minimumDelegatorBalanceRaw": "0",
            "periodLengthSeconds": "2592000",
            "nonce": "1783536856789",
            "startTimestamp": "1783536862",
            "expiryTimestamp": "0",
            "liquidityMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "subscriptionAuthority": "EuDzuMcs1nmBStoTRRwNqEXHhKx4kFb53PwWDhCxTRMf",
            "recurringDelegation": "Biaqf5KcreuuUF6Db7ADSEqYcrJKVyKhVqCQ2N3UABcR",
            "walletUsdcAta": "4yJJXTdh3gG7E8nd5CvKNKGxXXpRo7rZ7L2t7kU7QdEh",
            "vaultUsdcAta": "GDjXvqtSVnhWGueB69C6RhgDCnRHPjEsvW4msxqL4e4V",
            "policyId": "26",
            "policyAccount": "D1VgmXFGdxruMP7SuY3YNz2YZMbK3HtnhAEqkijn2jMt",
            "policySeed": "26",
            "subscriptionAuthorityInitialization": "exists"
          },
          "signature": "cTPf3MFpszjWXLCxQoKAihvf2veXtiUJJESoPLKSg9KVRjWpQtw1Jm3bjqGEBZFV91Db8Af1jAENmGpQ7VBP6D7",
          "sponsored": true,
          "sponsoredConfirmations": {
            "setup": {
              "confirmedSlot": "431645796",
              "signature": "cTPf3MFpszjWXLCxQoKAihvf2veXtiUJJESoPLKSg9KVRjWpQtw1Jm3bjqGEBZFV91Db8Af1jAENmGpQ7VBP6D7"
            }
          },
          "stage": "create_recurring_delegation",
          "status": "success"
        }
      ],
      "endpoint": "autodeposit setup confirm endpoints",
      "status": "success"
    },
    "postSetupEarnState": {
      "backend": {
        "autodeposit": {
          "active": true,
          "amountPerPeriodRaw": "10000",
          "balanceSweepPolicyId": "614",
          "cluster": "mainnet-beta",
          "delegatedSigner": "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5",
          "depositedThisPeriodRaw": "0",
          "expiryTimestamp": "0",
          "lastSeenSignature": "cTPf3MFpszjWXLCxQoKAihvf2veXtiUJJESoPLKSg9KVRjWpQtw1Jm3bjqGEBZFV91Db8Af1jAENmGpQ7VBP6D7",
          "lastSeenSlot": "431645796",
          "nonce": "1783536856789",
          "periodLengthSeconds": "2592000",
          "policyAccount": "D1VgmXFGdxruMP7SuY3YNz2YZMbK3HtnhAEqkijn2jMt",
          "policyConfirmedSlot": "431645788",
          "policySeed": "26",
          "policySignature": "23xUpmYHxirGcYremBfaiCbF3yvc3yK73joirrt6Tt7sMD3Y6dvR3aR6No5Cdsvm7EqTgrUBc8DFtP6YyXJg117R",
          "recurringDelegation": "Biaqf5KcreuuUF6Db7ADSEqYcrJKVyKhVqCQ2N3UABcR",
          "recurringDelegationConfirmedSlot": "431645796",
          "recurringDelegationSignature": "cTPf3MFpszjWXLCxQoKAihvf2veXtiUJJESoPLKSg9KVRjWpQtw1Jm3bjqGEBZFV91Db8Af1jAENmGpQ7VBP6D7",
          "scheduledSweeps": [
            {
              "classification": "initial_surplus",
              "confidence": "confirmed_snapshot",
              "eligibleAfter": "2026-07-08T19:54:25.318Z",
              "executeNowAvailableAt": "2026-07-08T18:54:22.000Z",
              "id": "851",
              "lotCount": 1,
              "originalAmountRaw": "4989987",
              "reason": "initial Autodeposit surplus detected at setup confirmation",
              "remainingAmountRaw": "4989987",
              "slotId": "851",
              "status": "scheduled"
            }
          ],
          "startTimestamp": "1783536862",
          "status": "active",
          "subscriptionAuthority": "EuDzuMcs1nmBStoTRRwNqEXHhKx4kFb53PwWDhCxTRMf",
          "subscriptionDelegatee": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA",
          "vaultUsdcAta": "GDjXvqtSVnhWGueB69C6RhgDCnRHPjEsvW4msxqL4e4V",
          "walletBalanceFloorRaw": "0",
          "walletUsdcAta": "4yJJXTdh3gG7E8nd5CvKNKGxXXpRo7rZ7L2t7kU7QdEh"
        },
        "canonicalVaultPubkey": "EkmhqhYjncNzQ1fMAH8YWPVbMdpVRyeKCgXMvQtF6NZQ",
        "loadErrors": {},
        "onboarding": {
          "nextStep": "route_policy"
        },
        "policy": null,
        "position": null,
        "policySignerPublicKey": "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5",
        "settingsPda": "7RcoGn2PNA1vwNiawXKpDJkvcCva9kji34vtUU6gtGzp",
        "vault": {
          "accountIndex": 1,
          "pubkey": "8sgX2RAXtZAL6fsiNoYSGa67ZQPj2XVkBcctLpgh7NQA"
        }
      },
      "status": "succ
... truncated 3630 chars ...
```

stderr:

```

```
