# ASK-881: Combined Wallet Onboarding Design

## Goal

For first-time wallet setup in the mobile app, combine the onboarding slides and wallet entry actions into a single screen:

- swipeable onboarding hero at the top
- persistent wallet setup actions at the bottom on every slide

Replay onboarding from Settings must stay unchanged and continue using the current standalone slide flow.

## Context

Current setup flow in the mobile app:

1. `OnboardingSlidesScreen`
2. separate choose screen in `OnboardingGate`
3. one of:
   - `SeedVaultChooserScreen`
   - `CreateWalletScreen`
   - `ImportWalletScreen`
4. `BiometricSetupScreen`

The ASK-881 reference shows a combined onboarding surface where the user can swipe through slides while the wallet entry actions remain available at all times.

## Requirements

- Change only first-time setup behavior.
- Keep replay-from-Settings behavior unchanged.
- Keep existing onboarding slide copy and artwork unchanged.
- Remove `Next` and `Skip` from first-time setup.
- Make the onboarding hero swipeable in setup mode.
- Keep wallet actions visible on every slide:
  - `Use Seed Vault`
  - `Create Wallet`
  - `I already have a wallet`
- Preserve current downstream behavior for Seed Vault, create, import, and biometric setup.
- Preserve current Seed Vault availability handling, including disabled state and helper text.

## Non-Goals

- No content rewrite for onboarding slides.
- No new onboarding slides.
- No changes to replay onboarding UX.
- No changes to create/import/biometric business logic beyond entry wiring.
- No attempt to visually copy unrelated reference details such as segmented controls, terms checkbox, or new CTA labels.

## Recommended Approach

Add a new setup-only onboarding screen component and keep the existing replay screen intact.

Why this approach:

- It isolates setup-specific wallet action UI from replay-only onboarding.
- It avoids giving `OnboardingSlidesScreen` two unrelated responsibilities.
- It minimizes regression risk for Settings replay.
- It keeps `OnboardingGate` as the single orchestrator for setup flow transitions.

Rejected alternatives:

- Extending `OnboardingSlidesScreen` to handle both setup and replay modes.
  - Smaller diff, but mixes two behaviors into one component.
- Building a generalized onboarding framework.
  - Too much abstraction for this ticket.

## Design

### 1. Flow Routing

`OnboardingGate` remains the flow router.

Setup mode becomes:

1. `WalletSetupOnboardingScreen`
2. one of:
   - `SeedVaultChooserScreen`
   - `CreateWalletScreen`
   - `ImportWalletScreen`
3. `BiometricSetupScreen`

Replay mode remains:

1. `OnboardingSlidesScreen`
2. finish replay

### 2. Shared Slide Content

Extract the current onboarding slide data into a shared module so both:

- `OnboardingSlidesScreen`
- `WalletSetupOnboardingScreen`

render from the same source of truth.

This prevents copy/image drift between replay and setup variants.

### 3. New Setup Screen Layout

`WalletSetupOnboardingScreen` uses the selected reference direction:

- swipeable onboarding hero on top
- slide indicator dots
- fixed bottom action area

The screen should follow option A from design review:

- hero content changes with swipe
- actions remain fixed underneath
- actions are always reachable

### 4. Interaction Model

In setup mode:

- user swipes horizontally to move between slides
- no `Next`
- no `Skip`
- tapping any wallet action immediately exits the setup onboarding screen into the selected existing flow

In replay mode:

- keep current `Next` / `Skip`
- keep current standalone full-screen slide layout

### 5. Seed Vault Availability

`WalletSetupOnboardingScreen` should preserve the same Seed Vault state model used by the current choose screen:

- render immediately
- resolve `SeedVault.isAvailable()` asynchronously
- enable the Seed Vault button when available
- show the existing disabled presentation and helper text when unavailable

### 6. Layout Priorities

The bottom action area has higher usability priority than the hero artwork.

On smaller screens:

- action buttons must remain fully reachable
- slide hero may compress vertically before actions become cramped or clipped
- hero copy must remain readable

## File Impact

Primary files:

- `mobile/src/components/wallet/OnboardingGate.tsx`
- `mobile/src/components/wallet/OnboardingSlidesScreen.tsx`
- `mobile/src/components/wallet/CreateWalletScreen.tsx`
- `mobile/src/components/wallet/ImportWalletScreen.tsx`
- `mobile/src/components/wallet/SeedVaultChooserScreen.tsx`

Expected new files:

- `mobile/src/components/wallet/WalletSetupOnboardingScreen.tsx`
- `mobile/src/components/wallet/onboarding-slides.ts`

Expected file responsibilities:

- `OnboardingGate.tsx`
  - route setup vs replay
  - handle action callbacks
  - keep downstream flow orchestration unchanged
- `WalletSetupOnboardingScreen.tsx`
  - setup-only swipe UI
  - action buttons
  - Seed Vault availability presentation
- shared slide data module
  - current titles, descriptions, and images
- `OnboardingSlidesScreen.tsx`
  - replay-only standalone onboarding UI using shared slide data

## Edge Cases

- Seed Vault availability may resolve after initial render.
- Setup flow must work on short screens without action buttons falling off-screen.
- Replay mode must not accidentally render the new combined layout.
- Existing create/import/biometric flows must behave exactly as before after user chooses an action.

## Testing And Validation

Required verification after implementation:

- `cd mobile && npx tsc --noEmit`
- `cd mobile && npx expo lint`

Manual smoke checks:

- Fresh wallet state shows combined swipeable onboarding with bottom actions on every slide.
- Replay onboarding from Settings still shows the current standalone onboarding flow.
- `Use Seed Vault` enters `SeedVaultChooserScreen`.
- `Create Wallet` enters `CreateWalletScreen`.
- `I already have a wallet` enters `ImportWalletScreen`.
- Create/import flows still reach biometric setup as before.

## Rollout Notes

- This is a UI/flow composition change for first-time setup only.
- Because replay remains separate, rollback is straightforward if setup UI regressions are found.
