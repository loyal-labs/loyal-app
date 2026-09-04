# Loyal documentation content plan

Status: planning artifact only. Do not change public documentation from this file.

## Outcome

Use two top-level tabs:

1. Product
2. Transparency

Product contains three visually separated sidebar sections. Automations explains the product. For Businesses supports evaluation and adoption. Developers contains implementation material. Transparency remains unchanged.

Trust and control stays inside Automations as the canonical cross-cutting section. Business and developer pages link to it. They do not restate it.

## Why the current structure fails

The current Product tab contains four pages and about 850 raw words. It works as a short presentation, but it cannot answer the separate questions a customer asks while evaluating the product.

The current Build tab contains nineteen pages and 11,372 raw words by `wc -w`. It exposes automation lifecycle, Earn routing, and Smart Accounts at the same level. A developer must understand Loyal's component taxonomy before finding the right path.

The repository also contains older privacy-inference and agent-network pages outside navigation. They describe a different Loyal product thesis. Leaving them routable creates conflicting explanations.

The required correction is progressive disclosure:

- Top navigation separates product documentation from company transparency.
- Product sidebar sections select reader intent.
- An explicit Overview page defines each Product section.
- Nested groups expose one feature at a time.
- Child pages answer one question.
- One concept has one canonical owner.

## What the references teach us

### Avici

[Avici Money](https://docs.avici.money/) uses one product tree with feature roots such as Wallet, Secured Credit Cards, Virtual Accounts, Business Accounts, and Markets. Each feature expands into task pages such as Add Money, Fees and Limits, Documents Required, or FAQs.

Adopt:

- recognizable feature roots
- an icon for each major branch
- collapsible task pages beneath the selected feature
- breadth in the sidebar without displaying every child at once

Do not adopt:

- a single undifferentiated audience tree
- a separate FAQ under every Loyal feature
- a page merely because a product has a matching screen

Avici is built with GitBook. We borrow its information structure. Mintlify remains the implementation layer.

### MetaDAO

[MetaDAO](https://docs.metadao.fi/) groups pages by the process a reader follows. How Projects Raise begins with readiness, proceeds through listing and sale, then explains the bid wall. How Governance Works explains the model first, proposal creation next, then trading and finalization.

Adopt:

- lifecycle order
- readiness before execution
- page titles based on reader actions and decisions
- benefits after the mechanism is understood

Do not adopt:

- a flat sidebar that mixes commercial evaluation with developer reference
- broad product claims without a current implementation boundary

### Solomon

[Solomon](https://docs.solomonlabs.org/usdv/) separates USDv, USDv for Businesses, and Platform into distinct documentation sets. Within each set, it moves from overview to mechanism or concepts, then examples, access, compliance, or risk.

Adopt:

- separate paths for product users and businesses, with a third path for platform builders
- one overview for each path
- worked examples after the governing model
- risk and compliance as first-class decisions
- one mechanism visual before detailed concepts; animate only when the state change carries meaning

Do not adopt:

- repeating the thesis at the start of every documentation set
- creating an independent site for every internal primitive

### Mintlify

[Mintlify navigation](https://www.mintlify.com/docs/organize/navigation) supports icons for tabs and groups. It also supports nested groups, root pages, directory cards, and default expansion.

Use the following Mintlify features:

| Field | Rule |
| --- | --- |
| `icon` | Add it to each top-level tab, Product section, direct Product page, and nested feature group. Child pages inside nested groups and protected Transparency groups are the exceptions. |
| `sidebarTitle: "Overview"` | Use it on the Automations, For Businesses, and Developers landing pages so all three remain visible as the first page in their section. |
| `root` | Assign it to nested feature landing pages. Product section landing pages remain explicit sidebar entries. Protected Transparency groups keep their current shape. |
| `directory: "card"` | Set it on Product sections so nested root pages display their children. |
| `expanded: false` | Apply it to every nested group. Top-level Product sections remain visible as native sidebar separators. |
| `redirects` | Preserve every changed public route. |

Do not use Mintlify `products` yet. The Smart Account capabilities remain inside Loyal's developer section. They are not separate customer offerings.

Two tabs create the clearest top-level distinction: Product explains what Loyal offers and how to adopt or build it; Transparency contains company and launch material. Automations, For Businesses, and Developers remain persistent as Product sidebar sections instead of competing for space in the top navigation.

## Navigation contract

The implementation target is exhaustive. Page paths omit file extensions, as required by `docs.json`.

```json
{
  "navigation": {
    "tabs": [
      {
        "tab": "Product",
        "icon": "sparkles",
        "groups": [
          {
            "group": "Automations",
            "icon": "arrows-rotate",
            "directory": "card",
            "pages": [
              "index",
              "automations/how-it-works",
              {
                "group": "Balance Sweep & Earn",
                "icon": "chart-line",
                "root": "automations/balance-sweeps-and-earn",
                "expanded": false,
                "pages": [
                  "automations/reserve-and-eligibility",
                  "automations/routing-and-yield",
                  "automations/exit-and-lifecycle"
                ]
              },
              "automations/catalog",
              "trust/withdraw-without-loyal",
              {
                "group": "Trust & control",
                "icon": "shield-halved",
                "root": "trust/ownership-and-control",
                "expanded": false,
                "pages": [
                  "trust/rule-enforcement",
                  "trust/risk-and-liquidity",
                  "trust/audits-and-deployments"
                ]
              }
            ]
          },
          {
            "group": "For Businesses",
            "icon": "building-columns",
            "directory": "card",
            "pages": [
              "business/overview",
              "business/product-fit",
              "business/use-cases",
              "business/economics-and-responsibilities",
              "business/integration-readiness"
            ]
          },
          {
            "group": "Developers",
            "icon": "code",
            "directory": "card",
            "pages": [
              "build/overview",
              "build/first-automation",
              "build/system-architecture",
              {
                "group": "Automation lifecycle",
                "icon": "timeline",
                "root": "build/automation-lifecycle",
                "expanded": false,
                "pages": [
                  "earn/autodeposit",
                  "earn/policies",
                  "build/pause-and-close"
                ]
              },
              {
                "group": "Earn routing",
                "icon": "chart-line",
                "root": "earn/smart-account",
                "expanded": false,
                "pages": [
                  "earn/same-mint-optimization",
                  "earn/orchestrator",
                  "earn/trust-model"
                ]
              },
              {
                "group": "Smart Accounts",
                "icon": "wallet",
                "root": "smart-accounts/overview",
                "expanded": false,
                "pages": [
                  "smart-accounts/concepts",
                  "smart-accounts/policies-and-execution",
                  "smart-accounts/frontend-and-vaults",
                  "smart-accounts/typescript-sdk",
                  "smart-accounts/rust-sdk"
                ]
              },
              {
                "group": "Reference",
                "icon": "book-open",
                "root": "build/reference",
                "expanded": false,
                "pages": [
                  "build/networks-and-deployments",
                  "build/state-events-and-receipts"
                ]
              }
            ]
          }
        ]
      },
      {
        "tab": "Transparency",
        "icon": "scale-balanced",
        "groups": [
          {
            "group": "Team",
            "pages": ["Introduction/team"]
          },
          {
            "group": "Reports",
            "pages": [
              "transparency/q2-2026",
              "transparency/q1-2026",
              "transparency/q4-2025"
            ]
          },
          {
            "group": "Resources",
            "pages": [
              "faq/index",
              "resources/links",
              "launch/roadmap",
              "launch/token"
            ]
          }
        ]
      }
    ]
  }
}
```

Mintlify top-level groups are always visible, so the Product tab uses them as three stable sidebar sections: Automations, For Businesses, and Developers. Each section begins with an explicit Overview page. Direct pages and collapsible feature groups have icons; pages inside a collapsed feature group do not. Feature branches start closed. `directory: "card"` is set on each Product section and inherited by its nested roots. For Businesses has no nested group because four direct decisions are clearer. Transparency preserves its current groups and content, so it has no new roots, directories, or expansion settings.

## Canonical content ownership

| Subject | Canonical page | Other pages may do only this |
| --- | --- | --- |
| Product thesis | `/` | Link or use one sentence of context. |
| Live, pilot, illustrative status | `/automations/catalog` | Show the status label and link. |
| Four-step customer mechanism | `/automations/how-it-works` | Name the step without explaining it again. |
| Reserve and eligibility | `/automations/reserve-and-eligibility` | Use the configured reserve as an input. |
| Routing and variable yield | `/automations/routing-and-yield` | Link when describing Earn. |
| Exit lifecycle | `/automations/exit-and-lifecycle` | State that an exit exists and link. |
| Business suitability | `/business/product-fit` | Use one fit summary sentence. |
| Business use cases | `/business/use-cases` | Link to the worked flow. |
| Economics and duties | `/business/economics-and-responsibilities` | Avoid revenue examples elsewhere. |
| Integration readiness | `/business/integration-readiness` | Link from sales and developer entry points. |
| Root authority and signer access | `/trust/ownership-and-control` | State the conclusion and link. |
| Loyal-independent Earn exit | `/trust/withdraw-without-loyal` | State that the root wallet can recover through RPC and link to the runbook. |
| Plain-language rule enforcement | `/trust/rule-enforcement` | State that an action passed or failed. Exact fields belong to developer policies. |
| Risk and liquidity | `/trust/risk-and-liquidity` | Use the relevant warning and link. |
| Audit scope and coverage | `/trust/audits-and-deployments` | Own the reviewer and reviewed version or commit. Own the scope and deployment-match conclusion. Other pages link without repeating them. |
| Developer system boundaries | `/build/system-architecture` | Show only the local boundary needed by the task. |
| Automation state machine | `/build/automation-lifecycle` | Link from setup and closure pages. |
| Pause and close implementation | `/build/pause-and-close` | Product pages state the customer-visible result and link. |
| Subscription implementation | `/earn/autodeposit` | Name the dependency and link to its explanation. |
| Policy fields and construction | `/earn/policies` | List only the fields needed by an example and link for the complete set. |
| Earn account model | `/earn/smart-account` | Link from deposits and routing. |
| Same-mint routing | `/earn/same-mint-optimization` | State that USDC stays USDC and link. |
| Market selection | `/earn/orchestrator` | Report the selected market. Link for the complete loop. |
| Earn enforcement layers | `/earn/trust-model` | Product pages link to Trust instead. |
| Smart Account model | `/smart-accounts/overview` | Child pages own their specific concepts and SDKs. |
| Developer reference index | `/build/reference` | Route readers to deployed identity or runtime evidence without copying either. |
| Deployment identity and current verification | `/build/networks-and-deployments` | Other pages cite a status and link. Audit interpretation stays in Trust. |
| Automation runtime evidence and diagnosis | `/build/state-events-and-receipts` | Examples show only the fields they consume. Product-specific recovery stays on its error page. |

## Page contracts

### Automations

| Page and action | Audience and single question | Essential content | Visual | Exclude and link |
| --- | --- | --- | --- | --- |
| `/` retain and narrow | New customer: What is Loyal and why does it exist? | Customer-approved USDC automation, live Balance Sweep & Earn, qualified idle-capital thesis, broader vision. | Three directory cards for How, Balance Sweep & Earn, and Trust. | No policy fields, business formula, audit list, or future claim without status. Link to catalog and How. |
| `/automations/how-it-works` retain | Customer: What happens to one balance? | One 10,000 USDC example that sets a reserve and approves the policy before showing the sweep and exit. | Existing four-step interactive walkthrough. | No component taxonomy, audit material, or duplicate authority diagram. Link to each detail page. |
| `/automations/balance-sweeps-and-earn` create as group root | Evaluator: What does the live automation include? | Inputs, outcome, customer choices, current limitations. | Directory cards only. | Do not repeat the four-step walkthrough. Link to How and child pages. |
| `/automations/reserve-and-eligibility` create | Operator: How is the amount available to sweep determined? | Operating reserve, live balance check, eligible surplus, insufficient-balance result. | Small balance allocation diagram. | No routing algorithm or signer model. Link to routing and authority. |
| `/automations/routing-and-yield` create | Evaluator: Where does eligible USDC go and what can change? | Customer Earn position, approved USDC lending market, variable rates, same-mint result, withdrawal dependency. | USDC source to Earn to lending-market diagram. | No optimizer implementation. Link to developer Earn routing and risk. |
| `/automations/exit-and-lifecycle` create | Customer: How does a pause differ from withdrawal or closure? | New-sweep pause, withdrawal, recurring-access removal, full Earn exit, confirmation boundary. | Four-state lifecycle diagram. | No root-authority topology. Link to Ownership and developer lifecycle. |
| `/automations/catalog` create | Buyer: What is available now and what is only a possibility? | Status matrix defining each label: Live, Pilot, Illustrative, Unsupported. Balance Sweep & Earn is the only live automation unless evidence changes. | Filterable or static status table. | No implied roadmap. Each entry links to evidence or says illustrative. |
| `/trust/ownership-and-control` retain and narrow | Customer or counsel: Who can control or change the account? | Default customer root authority, Loyal's separate limited signer, private-key boundary, external-account caveat, legal qualification. | Existing five-node authority map. | No risk catalog or audit list. Link to enforcement and exit. Link to audits where review scope matters. |
| `/trust/withdraw-without-loyal` create | Customer developer or recovery operator: Can the customer exit when Loyal is unavailable? | RPC-only Settings discovery, live Earn holdings, local transaction preparation, ordered signatures, zero proof, and policy closure. | Independent Find, Review, Exit, and Close tabs with focused code blocks. | No database dependency, seed phrase handling, or promise of protocol liquidity. Link to deployment identity and SDK details. |
| `/trust/rule-enforcement` create | Security reviewer: What rejects an unauthorized transaction? | Plain-language allowed versus rejected outcomes, the separate roles of subscription and Smart Account policy, and the user-visible result. | Allowed versus rejected transaction comparison. | No constraint fields or SDK construction. Link to developer policies. |
| `/trust/risk-and-liquidity` create | Customer or risk reviewer: What can still go wrong? | User-visible outcomes from software or lending risk; depeg and signer risk; liquidity, network, or service failure. | Risk table by layer and consequence. | No audit marketing. Link to audits and routing. |
| `/trust/audits-and-deployments` create | Security reviewer: What was reviewed and does it match production? | Evidence for Squads Smart Accounts and Kamino K-Lend, plus the Subscriptions program; version or commit scope; deployed-version verification gap; no standalone Loyal audit claim. | Coverage table showing project and reviewer, review scope and date, then deployment-match status. | No generic safety language. Link to technical deployments reference. |

### For Businesses

| Route and status | Business reader and decision | Required answer | Presentation | Boundaries and links |
| --- | --- | --- | --- | --- |
| `/business/overview` retain as root | Product leader: What can Loyal add to my product? | Automatic cash management, customer-controlled accounts, first live automation, section choices. | Directory cards for Fit and Use cases, followed by Economics and Readiness. | No full mechanics or legal conclusion. Link to Automations and Trust. |
| `/business/product-fit` create | Buyer: Is our account and product model compatible? | Separate customer account, customer approval, clear exit, incompatible guaranteed-return or unclear-ownership models, current payment-withdrawal limitation. | Fit and not-fit checklist. | No revenue formula or policy fields. Link to use cases and readiness. |
| `/business/use-cases` create | Product designer: What would customers experience? | Neobank and payment-processor flows, reserve difference, customer actions, present product limitation. | Two tabs using one common flow schema. | No repeated thesis or economics. Link to mechanics and fit. |
| `/business/economics-and-responsibilities` create | Commercial and compliance teams: Where can value accrue and who owns each duty? | Qualified illustrative formula, participation and realized-yield caveats, responsibility split between customer and business with Loyal's duties shown separately. | Revenue waterfall plus responsibility table. | No promised revenue or blanket compliance conclusion. Link to readiness. |
| `/business/integration-readiness` create | Implementation owner: What must be decided before integration? | Account ownership, approval and exit UX, disclosures, support, compliance owner, environments, evidence, rollout and monitoring contacts. | Readiness checklist with decision owner. | No SDK tutorial. Link to Developer overview and Trust. |

### Developers: start and lifecycle

| Route change | Developer question | Required implementation detail | Aid | Cuts and next page |
| --- | --- | --- | --- | --- |
| `/build/overview` create as root | Developer: Which integration path applies to me? | Separate branches for automation and Earn, followed by Smart Accounts and private transfers; prerequisites; current support boundary. | Directory cards with entry criteria. | No deep setup steps. Link to First automation and architecture. |
| `/build/first-automation` retain and narrow | Developer: Can I prove one allowed action, one rejected action, and exit? | Preconditions, minimal build sequence, positive test, negative test, exit test, evidence required. | Existing readiness flow. | No general lifecycle table or full policy catalog. Link to the lifecycle page; policies own the constraints. |
| `/build/system-architecture` create | Technical lead: Where are Loyal's authority and runtime boundaries? | Customer signing boundary, Loyal scheduler, subscription program, Smart Account policy, Earn vault, lending market, control-plane records, RPC truth. | One system boundary diagram. | No frontend implementation or historical privacy architecture. Link to Trust; the lifecycle page owns states. |
| `/build/automation-lifecycle` retain as nested root | Developer: What states can an automation enter and which source proves each state? | Setup, active, paused, closing, closed, failed; submitted versus confirmed versus reconciled; source of truth by concern. | State machine. | No repeated first-build instructions. Link separately to subscription setup, policy construction, and closure. |
| `/earn/autodeposit` retain; rename navigation label | Developer: How is the recurring sweep subscription created and observed? | Period and cap, setup, balance watching, execution trigger, update boundary. | Subscription sequence. | Move pause and close detail to the dedicated page. Link to policy and lifecycle. |
| `/earn/policies` retain and narrow | Developer: Which transaction properties does the Smart Account policy constrain? | Programs, accounts, mint, authority, instruction shape, and maximum amount per period. State that the subscription delegation defines the period. | Policy envelope diagram. | No broad security claims. Link to Trust enforcement and first automation. |
| `/build/pause-and-close` create | Developer: How do pause, withdrawal, subscription close, and full Earn exit differ in code and state? | Required signer, instructions, confirmation, persisted transition, retry and recovery behavior. | Transition table. | No customer-facing explanation. Link to product exit and lifecycle. |

### Developers: Earn routing

| Earn route | Intended reader and question | Required technical answer | Diagram | Scope boundary |
| --- | --- | --- | --- | --- |
| `/earn/smart-account` retain; use as Earn root | Developer: Which accounts and vaults hold an Earn position? | Customer Smart Account, main account, Earn vault, position, deposits, withdrawals, live balance sources. | Account and vault map. | No optimizer loop or policy catalog. Link to routing and policies. |
| `/earn/same-mint-optimization` retain; label becomes Same-mint routing | Developer: How can USDC move between approved markets without changing asset? | Static-market problem, same-mint path, movement constraints, capabilities that are currently unavailable. | Source reserve to target reserve route. | No thesis or business value. Link to market selection and risk. |
| `/earn/orchestrator` retain; label becomes Market selection | Developer or operator: How is a market selected or skipped? | Inputs, freshness gates, decision loop, skip reasons, submitted versus confirmed result. | Decision loop with skip exits. | No generic Smart Account material. Link to state and receipts. |
| `/earn/trust-model` retain | Security engineer: Which layer enforces each Earn invariant? | Subscription constraints, Smart Account policy, customer authority, market data, transaction verification, residual risk. | Enforcement-layer stack. | No customer legal language or audit list. Link to Trust pages. |

### Developers: Smart Accounts

| Smart Account route | Developer need | Required material | Format | Omit or refer |
| --- | --- | --- | --- | --- |
| `/smart-accounts/overview` retain; use as Smart Accounts root | Developer: When should I use a Smart Account? | Use cases, mental model, recommended reading order. | Directory cards. | No Earn-specific setup. Link to concepts and policies. |
| `/smart-accounts/concepts` retain | Developer: Which account and signer concepts must I understand, including thresholds, timelocks, or settings? | Current concept definitions and invariants. | Small relationship diagram only if definitions remain unclear. | No SDK installation or Earn policy values. Link to Policies and execution. |
| `/smart-accounts/policies-and-execution` retain | Developer: How do controlled and autonomous execution differ? | Execution modes, lifecycle split, policy purpose and types, selection guidance. | Mode comparison. | No duplicate concept glossary. Link to Frontend and vault APIs. |
| `/smart-accounts/frontend-and-vaults` retain | Application developer: How do reads, writes, vault adapters, and agent connections fit together? | Protocol and vault SDK shapes, frontend read/write flows, spending-limit behavior, diagnostics. | Read/write sequence. | No TypeScript package tour. Link to SDK. |
| `/smart-accounts/typescript-sdk` retain | TypeScript developer: Which client level and helpers should I use? | Installation, clients, abstraction levels, PDA helpers, app-facing adapter. | Code only. | No Rust parity essay. Link to Rust SDK when relevant. |
| `/smart-accounts/rust-sdk` retain | Rust developer: How do I construct requests with the Rust client? | Scope, client, request construction, useful entry points. | Code only. | No repeated Smart Account concepts. Link to overview. |

### Developers: Reference

| Reference route | Lookup question | Required evidence | Format | Scope and link |
| --- | --- | --- | --- | --- |
| `/build/reference` create as group root | Developer or auditor: Which source should I consult for deployed identity or runtime evidence? | Directory cards for deployments and runtime evidence, each with its use case and update owner. | Directory cards only. | No copied addresses, event fields, or troubleshooting. Link to the two canonical reference pages. |
| `/build/networks-and-deployments` create | Integrator or operator: Which deployed identities apply to my environment? | Environment names, program addresses, deployment identifiers, and last verified date. | Versioned table. | No audit metadata or match claim. Link to Audits and deployed scope. |
| `/build/state-events-and-receipts` create | Integrator or operator: What evidence proves an automation's current state? | States from Automation lifecycle, durable record versus wake-up signal, consumed client fields, inspection order after a stall or failure. | State and evidence table. | No product explanation or recovery playbook. Link to Automation lifecycle; product error pages own remediation. |

## Current page disposition

### Navigated Product pages

| Current page | Disposition |
| --- | --- |
| `index.mdx` | Retain as Automations root. Narrow it to thesis, present product, and directory choices. |
| `automations/how-it-works.mdx` | Retain. Keep the interactive four-step example. |
| `business/overview.mdx` | Retain as Businesses root. Move fit, use cases, and economics into their canonical child pages. |
| `trust/ownership-and-control.mdx` | Retain as Trust root. Move enforcement and risk into child pages. Move audit coverage to its dedicated page. |

### Navigated Build pages

| Current page | Disposition |
| --- | --- |
| `build/first-automation.mdx` | Retain and narrow to the executable verification path. |
| `build/automation-lifecycle.mdx` | Retain as Lifecycle root. Move detailed close instructions to `build/pause-and-close.mdx`. |
| `earn/smart-account.mdx` | Retain as Earn routing root. |
| `earn/autodeposit.mdx` | Retain under Lifecycle. Move closure detail. |
| `earn/same-mint-optimization.mdx` | Retain in the Earn group. Use the navigation label Same-mint routing. |
| `earn/orchestrator.mdx` | Retain as Market selection within Earn routing. |
| `earn/policies.mdx` | Retain under Lifecycle. Narrow to actual policy construction and fields. |
| `earn/trust-model.mdx` | Retain as the Earn technical security model. |
| `smart-accounts/overview.mdx` | Retain as Smart Accounts root. |
| `smart-accounts/concepts.mdx` | Retain. |
| `smart-accounts/policies-and-execution.mdx` | Retain. |
| `smart-accounts/frontend-and-vaults.mdx` | Retain. |
| `smart-accounts/typescript-sdk.mdx` | Retain. |
| `smart-accounts/rust-sdk.mdx` | Retain. |

### Existing redirect disposition

| Source | Planned destination or action |
| --- | --- |
| `/automations/thesis` | Keep redirect to `/`. |
| `/automations/balance-sweeps-and-earn` | Remove redirect because the route becomes a real group root. |
| `/automations/catalog` | Remove redirect because the route becomes a real status page. |
| `/business/noncustodial-account-model` | Keep redirect to `/trust/ownership-and-control`. |
| `/business/economics` | Redirect to `/business/economics-and-responsibilities`. |
| `/business/neobank-example` | Redirect to `/business/use-cases#neobank`. |
| `/business/payment-processor-example` | Redirect to `/business/use-cases#payment-processor`. |
| `/trust/risk-and-transparency` | Redirect to `/trust/risk-and-liquidity`. |
| `/earn/overview` | Keep redirect to `/earn/smart-account`. |
| `/earn/safety-and-faq` | Redirect to `/earn/trust-model`. Product safety questions link to Trust. |

### Navigated Transparency pages

The Transparency tab is protected. Its eight routes remain in place and their content does not change during this restructuring.

| Current page | Disposition |
| --- | --- |
| `Introduction/team.mdx` | Retain unchanged. |
| `transparency/q2-2026.mdx` | Retain unchanged. |
| `transparency/q1-2026.mdx` | Retain unchanged. |
| `transparency/q4-2025.mdx` | Retain unchanged. |
| `faq/index.mdx` | Retain unchanged in its current Resources position. |
| `resources/links.mdx` | Retain unchanged; keep its existing navigation target. |
| `launch/roadmap.mdx` | Retain unchanged with no navigation move. |
| `launch/token.mdx` | Retain unchanged at the current public route. |

### Unlisted legacy pages

These pages describe the former private-inference and agent-network product. Git history is the archive. They should not remain as hidden competing documentation.

| Current page | Page action | Route action |
| --- | --- | --- |
| `Introduction/index.mdx` | Delete | Redirect `/Introduction` to `/`. |
| `Introduction/howitworks.mdx` | Delete; do not reuse unverified historical claims | Remove without redirect |
| `Introduction/solution.mdx` | Delete | Redirect: `/` |
| `Introduction/usecases.mdx` | Delete | Redirect: `/business/use-cases` |
| `Introduction/vision.mdx` | Delete | Redirect: `/` |
| `architecture/network.mdx` | Delete | Redirect: `/build/system-architecture` |
| `architecture/payments.mdx` | Delete | Redirect: `/build/system-architecture` |
| `architecture/privacy.mdx` | Delete | Remove without redirect |
| `quickstart.mdx` | Delete | Redirect `/quickstart` to `/build/first-automation`. |
| `surveillance-crisis.mdx` | Delete | Redirect: `/` |
| `launch/MetaDAO.mdx` | Delete | Redirect: `/launch/token` |
| `launch/Futarchy.mdx` | Delete | Redirect: `/launch/token` |
| `loyal_manifesto.md` | Delete | Redirect: `/` |
| `README.md` | Retain as repository-only | Exclude from Mintlify navigation and search. Omit it from the sitemap and generated `llms.txt`. |

The legacy table includes Markdown because Mintlify can publish `.md` as well as `.mdx`. The twelve unlisted MDX pages remain a separate complete inventory within it.

## Claim status rules

Every automation or capability receives one of four labels:

| Label | Required evidence |
| --- | --- |
| Live | A user can use it in the current supported product and the implementation path is verified. |
| Pilot | A named, bounded pilot exists, with its access limitation stated. |
| Illustrative | The policy model could express it, but no current product or roadmap commitment is claimed. |
| Unsupported | The current system cannot perform it or requires an unbuilt dependency. |

Legal and security wording:

| Topic | Required wording |
| --- | --- |
| Custody | Say the architecture can support a customer-controlled, noncustodial design. Do not declare every business implementation legally noncustodial. |
| Authority | Say who holds root authority. State what Loyal can execute and how access ends. |
| Audits | Name the reviewed program, version or commit, and reviewer when known. Do not infer that the full Loyal integration is audited. |
| State | Distinguish planned from submitted. Separate confirmed from reconciled. Verify current state onchain. |

## Page deletion test

A page exists only if all answers are yes:

1. Does it serve one identifiable reader?
2. Does it answer one question that another page does not own?
3. Would deleting it remove information required for a decision, task, or risk review?
4. Can its essential points be stated without repeating a parent page?
5. Does its visual explain a relationship that prose alone would make harder to understand?

Delete or merge the page when any of the first four answers is no. Omit the visual when the fifth answer is no.

Within a page:

| Test | Action |
| --- | --- |
| Removal | Delete any sentence, section, example, or callout whose removal does not change the reader's decision, task, risk understanding, evidence, or next action. Rewrite adjacent copy when needed. |
| Canonical source | Link to it instead of summarizing it twice. |
| Vocabulary | Keep implementation nouns out of Automations and For Businesses unless the reader must act on them. |
| Examples | Keep one example for each point. |
| Cards | Remove cards that repeat the paragraph above them. |
| FAQs | Fix the page structure instead of creating a general FAQ. |

## Implementation phases

### Phase 0: Capture the baseline

- Record `git status --short`, every navigable source file, active navigation target, and redirect.
- Store the complete `user-docs` digest plus individual Team and report hashes.
- Record current search results, sitemap entries, and generated `llms.txt` for the legacy routes and thesis terms.
- Save the evidence in `docs/user-docs-baseline.json` before any approved implementation edit.

Exit condition: the verifier can distinguish pre-existing workspace changes from implementation changes and can prove the protected files stayed byte-identical.

### Phase 1: Build the verifier and route substrate

- Create `scripts/verify-user-docs-ia.mjs` with the assertions listed below.
- Keep the current public navigation active while replacement pages are incomplete.
- Create root files before any navigation object references them.
- When a redirect-backed route becomes a page, add the page and remove its redirect in the same change, then run the verifier.

Exit condition: the verifier passes against the current public tree, and every newly created root is reachable without a redirect conflict.

### Phase 2: Establish customer content ownership

- Apply the canonical ownership table.
- Narrow the four current Product pages.
- Create the distinct Automations child pages. Add the Business and Trust pages in their own groups.
- Move content instead of copying it.
- Replace removed sections with links to the canonical owner.

Exit condition: no full explanation of the thesis, mechanism, economics, authority model, risk, or audit scope exists on two pages.

### Phase 3: Complete developer gaps

- Create Developer overview and system architecture.
- Create pause and close implementation guidance.
- Add networks and deployments.
- Add the runtime evidence reference.

Exit condition: a developer can choose a path, build the minimal flow, verify failure and exit, and locate current deployment evidence without reading unrelated product branches.

### Phase 4: Activate the final navigation

- Confirm every target in the exhaustive navigation object exists.
- Run the IA verifier, broken-link check, accessibility check, and preview matrix.
- Replace the current `docs.json` navigation with the final object in one change.
- Re-run the same gate before proceeding.

Exit condition: the final tree has no missing target, redirect conflict, inaccessible page, or protected-file change. A failed gate restores the prior navigation without deleting content.

### Phase 5: Remove conflicting legacy content

- Add redirects before deleting legacy pages.
- Permit deletion only after the complete replacement tree passes Phase 4.
- Delete the former private-inference and agent-network pages.
- Verify hidden pages. Confirm search output and the sitemap contain only intentional content. Check generated `llms.txt` separately.

Exit condition: no old route presents the former Loyal thesis and no intended public route is lost.

### Phase 6: Editorial and visual verification

- Run the deletion test on every page.
- Run Slop Guard on rendered copy.
- Review every diagram at desktop and mobile widths.
- Check tabs, accordions, interactive walkthrough states, code blocks, and dark mode.
- Verify every page has one useful next step.

Exit condition: every required check below passes.

After every phase, run the structure verifier and broken-link check. Compare protected hashes, inspect the changed-route preview, and stop before staging when a gate fails.

## Runnable verification checklist

The first implementation deliverable is `scripts/verify-user-docs-ia.mjs`. It accepts the docs directory, this plan, and the Phase 0 baseline. One command must assert JSON validity, the exact navigation target, required group fields, target existence, redirect conflicts, unlisted `.md` or `.mdx` files, protected hashes, and prohibited dash characters.

| Purpose | Invocation |
| --- | --- |
| Information architecture | `bun scripts/verify-user-docs-ia.mjs --docs-dir user-docs --plan docs/user-docs-information-architecture-plan.md --baseline docs/user-docs-baseline.json` |
| Internal links | `cd user-docs && mint broken-links` |
| Content accessibility | `cd user-docs && mint a11y` |
| Local docs preview | `cd user-docs && mint dev --no-open` |
| Diff hygiene | `git diff --check -- user-docs docs/user-docs-information-architecture-plan.md` |
| Slop Guard | Invoke `mcp__slop_guard__check_slop_file` once for each changed public source file and save the returned score with the phase evidence. |
| Deployed search and export | Set `LOYAL_DOCS_PREVIEW_URL` to the actual preview, then run `bun scripts/verify-user-docs-preview.mjs --base-url "$LOYAL_DOCS_PREVIEW_URL" --queries docs/user-docs-search-queries.txt`. |

### Structure

| Check | Passing result |
| --- | --- |
| JSON | `jq empty user-docs/docs.json` exits successfully. |
| Tabs | The tab set is exactly `Product / Transparency`. |
| Product sections | Product contains `Automations / For Businesses / Developers` as top-level groups, each with an icon, `directory: "card"`, and an explicit first page titled `Overview` in the sidebar. |
| Page icons | Every direct Product page has an icon. Child pages inside nested groups remain plain. |
| Nested groups | Every Product feature group has an icon and root page, and every nested group sets `expanded: false`. Protected Transparency groups remain unchanged. |
| Recovery order | Automations places `Withdraw manually` directly after `Automation catalog` and before the nested `Trust & control` group. |
| Targets | Every `docs.json` page target exists. |
| Root pages | Product section overviews are explicit pages; nested feature roots inherit `directory: "card"` from their section. |

### Routes and content inventory

- `cd user-docs && mint broken-links` reports no broken links.
- Every redirect source in this plan resolves to its planned destination.
- No redirect source is also an active page.
- No `.mdx` or `.md` file outside navigation lacks an explicit exclusion, redirect, or deletion decision.
- Site search and generated `llms.txt` do not surface deleted privacy-inference claims.

### Canonical ownership and wording

| Check | Passing result |
| --- | --- |
| Ownership | A search for every canonical subject finds its full explanation only on its owner page. |
| Repetition | A cold reviewer checks each canonical owner against every page that links to it and finds no second full explanation. |
| Punctuation | Customer-facing copy contains no em dash or en dash. |
| Vocabulary | Automations and For Businesses define every required technical term on first use. |
| Capability status | Every future capability carries Live, Pilot, Illustrative, or Unsupported status. |
| Audit scope | Every audit claim names the reviewed scope. |
| Custody qualification | Every noncustodial statement preserves the product and jurisdiction qualification. |
| Slop Guard | Rendered copy scores 100/100. A remaining violation passes only when the match comes from a documented URL or code sample. |

### Visual and interaction quality

| Check | Passing result |
| --- | --- |
| Accessibility | `cd user-docs && mint a11y` reports no content accessibility failures. |
| Responsive layout | Desktop and mobile screenshots show no overflow, empty panels, clipped diagrams, or unreadable labels. |
| Walkthrough | The Automation walkthrough changes all four states correctly. |
| Navigation controls | Directory cards and nested groups open the intended pages. |
| Use-case tabs | Each Business tab shows distinct content. |
| Reduced motion | Every explanation remains available. |
| Color modes | Dark and light modes preserve contrast and diagram meaning. |

Run the preview matrix on `/`, `/automations/how-it-works`, `/business/use-cases`, `/build/overview`, `/trust/ownership-and-control`, and `/trust/withdraw-without-loyal`. Capture each at 1440 by 1000 and 390 by 844 in both color modes. Save the twenty-four screenshots under `/private/tmp/loyal-user-docs-qa/<phase>/`. Run the walkthrough once more with reduced motion and record all four states. The deployed search verifier queries `private inference`, `agent network`, `surveillance`, and `zero knowledge`; no deleted legacy page may appear in search, sitemap output, or `llms.txt`.

### Technical truth

- Customer root authority, Loyal's limited signer, subscription constraints, and Smart Account policy are described as separate controls.
- Pause, withdrawal, subscription close, and full Earn exit remain distinct.
- The recovery runbook discovers Settings and holdings from RPC, confirms every withdrawal step, proves a zero balance, and only then closes access.
- The execution-state terms in Legal and security wording are not conflated.
- Live product claims match verified code and deployed behavior. Confirm product availability separately.
- Deployed program identifiers and reviewed versions include a verification date.

### Repository integrity

- `git diff --check` exits successfully.
- Team and Transparency report hashes match the pre-change baseline.
- No unrelated workspace file is modified.
- No file is staged and no commit is created during review iterations unless the user later requests it.

## Definition of done

The restructuring is complete only when the hierarchy works without explanatory duplication. More pages are acceptable only when each page removes search cost for a distinct reader question. A larger sidebar with the same repeated prose is a failure.
