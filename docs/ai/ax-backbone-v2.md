# Ax Backbone V2

Ax Backbone V2 standardizes how LLM programs are authored, executed, validated, and evaluated across this monorepo.

The current reference implementation is Telegram group summary generation.

## Architecture Map

### Shared packages (`/packages`)

- `@loyal-labs/llm-core`
  - runtime-agnostic error types, retry engine, and validation helpers
  - no app alias imports and no env access
- `@loyal-labs/llm-server`
  - server-side Ax client factory, program runner, and telemetry sink
  - accepts config objects; no direct `process.env` reads

### App layer (`/apps/telegram/src/lib/ai/ax`)

- `programs/summaries/spec.ts`
  - versioned program spec with typed signatures, examples, assertions, and defaults
- `programs/summaries/generate.ts`
  - summary generation service implementation
- `programs/summaries/assets/*`
  - versioned prompt assets (`examples`, `rules`)
- `evals/*`
  - dataset, baseline thresholds, metric functions, runner

### Telegram orchestration boundary

- `apps/telegram/src/lib/telegram/bot-api/summaries.ts`
  - idempotency, DB writes, delivery
- `apps/telegram/src/lib/telegram/bot-api/summary-generation/service.ts`
  - production wiring for Ax summary generation service

## Program Authoring Pattern

1. Define input/output contracts in `types.ts`.
2. Define typed Ax signatures in `spec.ts`.
3. Keep few-shot and quality rules in versioned JSON assets.
4. Keep assertions focused on output quality constraints.
5. Normalize and validate outputs before returning domain data.
6. Keep orchestration modules free of prompt logic.

### Minimal shape

```ts
type ProgramSpec<TIn, TOut> = {
  signature: AxSignature<TIn, TOut>;
  examples: Array<TIn & TOut>;
  assertions: Array<(values: TOut) => true | string>;
  defaults: { temperature: number };
};
```

## Runtime Contracts

## Error taxonomy

- `LlmValidationError`
  - schema/contract or normalization failures
- `LlmAssertionError`
  - quality assertion failures
- `LlmProviderError`
  - provider/runtime failures (`retryable` flag included)
- `LlmRetryExhaustedError`
  - bounded retries exhausted for retryable failures

## Retry semantics

- `runWithRetryPolicy` is the single retry engine.
- Non-retryable errors are rethrown immediately.
- Retryable failures continue with backoff + jitter until max attempts.
- Exhaustion throws `LlmRetryExhaustedError` with attempts and failure reasons.

## Diagnostics contract

Summary generation returns diagnostics with:

- attempt count
- failure reasons
- final model
- total latency
- selected example set ID

Use these fields for operational dashboards and canary evaluation.

## Asset Versioning Policy

Examples and rules are versioned assets under:

- `apps/telegram/src/lib/ai/ax/programs/summaries/assets/examples/<version>.json`
- `apps/telegram/src/lib/ai/ax/programs/summaries/assets/rules/<version>.json`

Rules:

1. Every behavior-changing edit bumps version.
2. Asset metadata should include `id`, `version`, `sourceDoc`, `createdAt`, and notes.
3. Runtime diagnostics must report the selected version/asset set.

## Eval Workflow

## Files

- `apps/telegram/src/lib/ai/ax/evals/datasets/summaries-v1.json`
- `apps/telegram/src/lib/ai/ax/evals/datasets/summaries-v1-baseline.json`
- `apps/telegram/src/lib/ai/ax/evals/metrics/summaries.ts`
- `apps/telegram/src/lib/ai/ax/evals/runner.ts`

## Command

```bash
cd apps/telegram
bun run ai:eval:summaries
```

The runner computes metrics and fails when a metric falls below baseline thresholds.

## Expanding to Other Workspaces

Use the same layering:

1. Program-specific code stays in the owning workspace or feature slice.
2. Shared runtime primitives stay in `llm-core` / `llm-server`.
3. Orchestration depends on a service boundary interface.
4. Add dataset + baseline before broad rollout.

Example targets:

- `app`: additional AI-powered Telegram flows
- `workers`: offline scoring/enrichment jobs
- `cli`: internal eval/diagnostics tooling
- `sdk`: only if runtime constraints allow server-safe usage

## Best Practices (Do/Don't)

Do:

- keep signatures strongly typed (`AxSignature<TInput, TOutput>`)
- keep env access in apps/telegram/server boundary modules only
- validate and normalize before returning data to storage paths
- keep retries centralized in `llm-core`
- prefer versioned JSON assets over inline prompt constants

Don't:

- mix orchestration logic with prompt/program logic
- import app aliases into `/packages`
- re-implement retry loops per program
- write raw provider payloads into DB flows
- change examples/rules without version bump and baseline review
