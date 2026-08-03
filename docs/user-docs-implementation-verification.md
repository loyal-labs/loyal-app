# User docs implementation verification

Verified on 2026-08-03.

## Slop Guard

Slop Guard was run once more after the final copy pass on every implementation-touched public MDX page and every imported JSX snippet. Protected Transparency files were checked by baseline hash and were not rewritten.

- 33 of 36 changed MDX pages scored 100/100.
- `user-docs/index.mdx` scored 83 because the cited Gauntlet URL contains the word `unlock`. The rendered prose does not use that word.
- `user-docs/sdk/private-transactions/quick-start.mdx` scored 86 because TypeScript examples repeat required `tokenMint`, `user`, and `payer` fields.
- `user-docs/smart-accounts/typescript-sdk.mdx` scored 64 because three code examples repeat the same Smart Account request fields to compare raw, prepared, and client-level calls.
- No remaining MDX violation comes from rendered prose.

The JSX snippet scores are parser artifacts from CSS declarations and JSX being treated as a single prose sentence:

| Snippet | Score | Reported code pattern |
| --- | ---: | --- |
| `audit-record.jsx` | 41 | CSS colon density |
| `authority-map.jsx` | 40 | CSS colon density; JSX run-on sentence |
| `automation-readiness-flow.jsx` | 18 | CSS colon density; JSX run-on sentence |
| `automation-walkthrough.jsx` | 54 | CSS colon density; JSX run-on sentence |
| `exit-choices.jsx` | 25 | CSS colon density; JSX run-on sentence |
| `reserve-calculation.jsx` | 16 | CSS colon density; JSX run-on sentence |

## Structural gates

- Information architecture verifier: pass
- Navigation targets: 49 of 49 exist
- Redirect map: pass
- Legacy page removal: pass
- Protected Transparency hashes: pass
- Nontechnical dash check: pass
- Mintlify broken links and anchors: pass
- Mintlify MDX accessibility: pass
- Git whitespace check: pass

## Two-tab navigation iteration

The top navigation now contains Product and Transparency only. Product uses three visible sidebar sections for reader intent: Automations, For Businesses, and Developers. All seven nested Product feature groups start closed. Transparency navigation and content remain unchanged.

The IA verifier now rejects any return to extra top tabs, reordered Product sections, or an expanded nested Product group. Rendered checks at 1280 by 720 and 390 by 844 found no horizontal overflow. On mobile, the Product selector exposes Product and Transparency, the three Product sections remain distinct, and all seven feature groups remain closed.

Each Product section now begins with an explicit Overview link, restoring access to the Automations, Business, and Developer landing pages from the sidebar. Every direct Product page and collapsible feature group has an icon. Child pages inside collapsed groups remain plain. The verifier protects the Overview order, labels, and eleven direct-page icons.

## Visual QA

Checked at 1280 by 720 and 390 by 844 in light and dark themes.

- Root page has no horizontal overflow.
- Interactive automation steps update the selected detail panel.
- Reserve calculation collapses to one column on mobile.
- Exit choices render as independent branches and collapse to one column on mobile.
- Audit details expand on mobile without horizontal overflow.
- Nested Automations navigation renders with the planned icons and expansion state.

The installed Mint CLI is version 4.2.141. It renders the nested navigation but does not render the newer inherited `directory: "card"` behavior. Hosted preview with a current Mintlify runtime remains the final check for generated directory cards.

## Landing alignment pass

The root, live automation root, customer walkthrough, Business overview, and Developer overview were revised to use the landing page's human framing while preserving the narrower documented product boundary.

- The root now answers what Loyal does, what the customer experiences, why automation matters, what is live, and where each reader should go next.
- The Business overview begins with the customer's liquidity need before integration decisions.
- The Developer overview begins with the customer promise and then identifies authority, transaction boundaries, evidence, and exit.
- Balance Sweep & Earn remains the only automation labeled available today. Broader workflows still link to the status catalog.
- Customer control remains qualified by the full implementation and legal analysis on the canonical Trust and Business pages.

Slop Guard scored the four revised child pages 100/100. The root scored 83 only because of the Gauntlet URL noted above.

The revised pages passed the IA verifier, Mintlify broken-link and anchor checks, Mintlify accessibility, `git diff --check`, and the nontechnical dash check. Rendered checks at 1280 by 720 and 390 by 844 found no horizontal overflow on the five revised routes. Mobile QA also caught and fixed an MDX math-parsing issue caused by multiple dollar-denominated amounts in one sentence; the customer example now uses explicit USDC units in prose.
