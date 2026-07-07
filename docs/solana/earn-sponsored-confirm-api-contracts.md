# Earn Sponsored Confirm API Contracts

This document describes the sponsored Earn confirm endpoints and how they differ
from the matching non-sponsored confirm endpoints.

Sponsored confirm endpoints accept user-signed, serialized Solana transactions
instead of transaction signatures and confirmed slots. The server signs each
transaction with `EARN_POLICY_SPONSOR_PK`, sends and confirms it, then forwards
the request into the matching non-sponsored handler with the actual
`*Signature` and `*confirmedSlot` values.

## Common Sponsored Rules

- Requests must include the same authenticated session expected by the
  non-sponsored confirm endpoint.
- `*Transaction` fields are base64 serialized Solana transactions. Legacy and
  versioned transactions are accepted.
- The transaction fee payer must be `EARN_POLICY_SPONSOR_PUBKEY`; on the
  server, this must match `EARN_POLICY_SPONSOR_PK`.
- The user must sign every non-sponsor required signature before serialization.
  The server only adds the sponsor signature.
- The sponsor may only appear as the fee payer, unless the route-specific guard
  allows it as an approved rent payer.
- For account creation or rent/top-up instructions that the sponsor should fund,
  set the instruction rent payer to `EARN_POLICY_SPONSOR_PUBKEY`. For example,
  ATA creation should use the sponsor as the first `payer` account.
- On success, sponsored endpoints return the underlying non-sponsored response
  plus `sponsoredConfirmations`.

```ts
type SponsoredConfirmation = {
  signature: string;
  confirmedSlot: string;
};
```

Server send failures before any transaction confirms return the normal error
shape:

```ts
{
  error: { code: string; message: string };
}
```

Forwarded non-sponsored handler failures after sponsored transactions confirm
are wrapped with the confirmations that the sponsored handler has already
observed.

## Deposit Confirm

### Non-Sponsored Endpoint

`POST /api/smart-accounts/yield-optimization/deposits/confirm`

The client sends already-confirmed transaction signatures and slots. The route
authenticates the wallet session, parses the body, verifies the confirmed chain
state, and records the Earn deposit.

Required request fields:

```ts
{
  cluster: string;
  confirmedSlot: string;
  delegatedSigner: string;
  depositMint: string;
  depositSignature: string;
  liquidityMint: string;
  market: string | null;
  policyAccount: string;
  policyId: string;
  policyInitialization: "create" | "reuse";
  policySeed: string;
  policySignature: string;
  principalAmountRaw: string;
  settings: string;
  smartAccountAddress: string;
  targetReserve: string;
  targetSupplyApyBps: string | null;
  vaultIndex: number;
  vaultPubkey: string;
  walletAddress: string;
}
```

Optional request fields:

```ts
{
  policyConfirmedSlot?: string | null;
  setupPolicyAccount?: string | null;
  setupPolicyConfirmedSlot?: string | null;
  setupPolicyId?: string | null;
  setupPolicySeed?: string | null;
  setupPolicySignature?: string | null;
}
```

Response:

```ts
{
  position: unknown;
}
```

### Sponsored Endpoint

`POST /api/smart-accounts/yield-optimization/deposits/confirm/sponsored`

Compared to the non-sponsored body, omit:

- `confirmedSlot`
- `depositSignature`
- `policyConfirmedSlot`
- `policySignature`
- `setupPolicyConfirmedSlot`
- `setupPolicySignature`

Add:

```ts
{
  depositTransaction: string;
  policyTransaction: string;
  setupPolicyTransaction?: string | null;
}
```

`setupPolicyTransaction` is required only when
`policyInitialization === "create"`. For `policyInitialization === "reuse"`,
omit it.

Execution order:

1. Send and confirm `policyTransaction`.
2. If `policyInitialization === "create"`, send and confirm
   `setupPolicyTransaction`.
3. Send and confirm `depositTransaction`.
4. Forward to the non-sponsored deposit confirm handler with the real
   `policySignature`, `policyConfirmedSlot`, optional setup policy signature and
   slot, `depositSignature`, and `confirmedSlot`.

Response:

```ts
{
  position: unknown;
  sponsoredConfirmations: {
    policy: SponsoredConfirmation;
    setupPolicy: SponsoredConfirmation | null;
    deposit: SponsoredConfirmation;
  };
}
```

Deposit-specific sponsor guard:

- `policyTransaction` may use the sponsor as smart-account rent payer only for
  `policyAccount`.
- `setupPolicyTransaction` may use the sponsor as smart-account rent payer only
  for `setupPolicyAccount`, and may use bounded sponsor system transfers to the
  Earn vault or smart account.
- `depositTransaction` may use the sponsor as payer for allowed ATA creation
  instructions and bounded system rent/top-up transfers to the Earn vault or
  smart account.
- ATA creation is restricted to the deposit mint, liquidity mint, and target
  reserve collateral mint, owned by the Earn vault or smart account.

## Policy Confirm

### Non-Sponsored Endpoint

`POST /api/smart-accounts/yield-optimization/policies/confirm`

The client sends already-confirmed policy setup signatures and slots.

Required request fields:

```ts
{
  cluster: string;
  confirmedSlot: string;
  delegatedSigner: string;
  liquidityMint: string;
  market: string | null;
  policyAccount: string;
  policyId: string;
  policySeed: string;
  policySignature: string;
  settings: string;
  targetReserve: string;
  vaultIndex: number;
  vaultPubkey: string;
  walletAddress: string;
}
```

Optional request fields:

```ts
{
  stage?: "route_policy" | "setup_policy";
  setupPolicyAccount?: string | null;
  setupPolicyConfirmedSlot?: string | null;
  setupPolicyId?: string | null;
  setupPolicySeed?: string | null;
  setupPolicySignature?: string | null;
}
```

When `stage === "setup_policy"`, `setupPolicySignature` and
`setupPolicyConfirmedSlot` are required by the handler. If `stage` is omitted,
the non-sponsored parser infers `setup_policy` when `setupPolicySignature` is
present; otherwise it uses `route_policy`.

Response:

```ts
{
  policy: {
    account: string;
    id: string;
    seed: string;
    vaultIndex: number;
    vaultPubkey: string;
  };
}
```

### Sponsored Endpoint

`POST /api/smart-accounts/yield-optimization/policies/confirm/sponsored`

Compared to the non-sponsored body, omit:

- `confirmedSlot`
- `policySignature`
- `setupPolicyConfirmedSlot`
- `setupPolicySignature`

Add:

```ts
{
  policyTransaction: string;
  setupPolicyTransaction?: string | null;
}
```

`setupPolicyTransaction` is required only when `stage === "setup_policy"`. If
`stage` is omitted, the sponsored parser infers `setup_policy` when
`setupPolicyTransaction` is present; otherwise it uses `route_policy`.

Execution order:

For `stage === "route_policy"`:

1. Send and confirm `policyTransaction`.
2. Forward to the non-sponsored policy confirm handler with the real
   `policySignature` and `confirmedSlot`.

For `stage === "setup_policy"`:

1. Send and confirm `policyTransaction`.
2. Forward a `route_policy` confirmation using the confirmed
   `policyTransaction`.
3. Send and confirm `setupPolicyTransaction`.
4. Forward a `setup_policy` confirmation with the real setup-policy signature
   and slot.

Response:

```ts
{
  policy: {
    account: string;
    id: string;
    seed: string;
    vaultIndex: number;
    vaultPubkey: string;
  };
  sponsoredConfirmations: {
    policy: SponsoredConfirmation;
    setupPolicy: SponsoredConfirmation | null;
  };
}
```

Current standalone policy sponsor guard:

- The sponsored policy endpoint does not pass a route-specific rent guard into
  the sponsored transaction executor.
- The sponsor must therefore only appear as transaction fee payer for these
  transactions unless this endpoint is extended with explicit approved rent
  accounts.

## Autodeposit Setup Confirm

### Non-Sponsored Endpoint

`POST /api/smart-accounts/yield-optimization/autodeposit/setup/confirm`

The client sends an already-confirmed autodeposit setup signature and slot.

Required request fields:

```ts
{
  amountPerPeriodRaw: string;
  cluster: string;
  confirmedSlot: string;
  delegatedSigner: string;
  expiryTimestamp: string;
  liquidityMint: string;
  nonce: string;
  periodLengthSeconds: string;
  policyAccount: string;
  policyId: string;
  policySeed: string;
  recurringDelegation: string;
  settings: string;
  setupSignature: string;
  setupStage:
    | "initialize_subscription_authority"
    | "create_policy"
    | "create_recurring_delegation";
  startTimestamp: string;
  subscriptionAuthority: string;
  subscriptionAuthorityInitialization: "exists" | "required";
  subscriptionDelegatee: string;
  vaultIndex: 1;
  vaultPubkey: string;
  vaultUsdcAta: string;
  walletAddress: string;
  walletBalanceFloorRaw: string;
  walletUsdcAta: string;
}
```

Response:

```ts
{
  confirmedSlot: string;
  target?: unknown;
  bootstrapSweep?: unknown;
}
```

For `setupStage === "initialize_subscription_authority"`, the response only
contains `confirmedSlot`.

### Sponsored Endpoint

`POST /api/smart-accounts/yield-optimization/autodeposit/setup/confirm/sponsored`

Compared to the non-sponsored body, omit:

- `confirmedSlot`
- `setupSignature`

Add:

```ts
{
  setupTransaction: string;
}
```

`setupTransaction` is always required because the non-sponsored endpoint always
requires `setupSignature`.

Execution order:

1. Send and confirm `setupTransaction`.
2. Forward to the non-sponsored autodeposit setup confirm handler with the real
   `setupSignature` and `confirmedSlot`.

Response:

```ts
{
  confirmedSlot: string;
  target?: unknown;
  bootstrapSweep?: unknown;
  sponsoredConfirmations: {
    setup: SponsoredConfirmation;
  };
}
```

For `setupStage === "initialize_subscription_authority"`, the response only
contains `confirmedSlot` plus `sponsoredConfirmations`.

Current autodeposit sponsor guard:

- The sponsored autodeposit setup endpoint does not pass a route-specific rent
  guard into the sponsored transaction executor.
- The sponsor must therefore only appear as transaction fee payer for this
  transaction unless this endpoint is extended with explicit approved rent
  accounts.

## Integration Checklist

1. Read `EARN_POLICY_SPONSOR_PUBKEY` on the client and validate it as a Solana
   public key before using sponsored flow.
2. Prepare the same Earn operation metadata that the non-sponsored confirm
   endpoint expects.
3. Compile each sponsored transaction with `EARN_POLICY_SPONSOR_PUBKEY` as the
   transaction fee payer.
4. For instructions where sponsor-funded rent is required, set the instruction
   rent payer to `EARN_POLICY_SPONSOR_PUBKEY`; for ATA creation this is the
   first `payer` argument.
5. Make sure the route's server guard allows the sponsor rent-payer use. The
   deposit sponsored route currently has explicit approved rent-payer cases;
   standalone policy and autodeposit setup currently do not.
6. Ask the wallet to sign or partially sign the transaction, but do not send it
   from the wallet.
7. Serialize the signed transaction as base64 and send it in the matching
   `*Transaction` field.
8. Read `sponsoredConfirmations` from the response as the canonical signatures
   and confirmed slots for UI state, retry/resume state, and diagnostics.
