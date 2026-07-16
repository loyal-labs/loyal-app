# Earn operational wallet monitoring verifier

This is the fixed PASS/FAIL contract for the admin Earn wallet-monitoring
slice. It is intentionally about observable end state, not implementation
steps.

## Required checks

1. `/admin/earn` renders an Operational wallets section covering the current
   production sponsorship, Earn policy/route, and gasless deployment roles.
   Roles sharing one address render as one wallet with multiple role labels.
2. The admin path only handles public addresses or read-only database
   observations. It never imports or logs private key material. Configured
   public addresses and observed production addresses are compared and any
   mismatch is visible.
3. Each unique mainnet address receives a confirmed Solana balance read with
   exact lamports, RPC observation slot, and observation time. RPC errors or
   missing addresses render as Unknown, never zero or Healthy.
4. Every wallet shows its full address accessibly, has a working copy-address
   control with feedback, and links to its Solscan account.
5. Policy/deployment status reflects the existing 0.05 SOL autodeposit floor;
   sponsorship status uses observed spend/runway where available. Missing
   spend data is explicit.
6. Existing Earn monitoring remains intact. `bun run admin:lint` and a focused
   no-emit TypeScript check pass. No frontend build or low-value TypeScript
   unit-test suite is introduced.

## Verdict

Run the focused checks and inspect the rendered page at `/earn`. Report each
condition as PASS or FAIL with evidence. Overall PASS is allowed only when
every required condition passes.
