# Trusted External Contributor Vercel Previews

## Context

Vercel Git Fork Protection requires a Loyal Vercel team member to authorize preview deployments from fork pull requests. Trusted partners should receive functional previews with the existing Preview environment variables without joining the Vercel team or requiring per-PR Vercel approval.

PR #614 from `86doteth` is the initial canary. Its relevant deployment is the `loyal-dashboard` Vercel project because the change is under `dashboard/`.

## Goals

- Automatically deploy fork pull requests authored and updated by explicitly trusted GitHub users.
- Preserve Vercel Git Fork Protection for every other external contributor.
- Reuse the existing Vercel Git integration and Preview environment variables.
- Keep the original contributor pull request as the only merge target.
- Remove temporary preview branches when their pull requests become ineligible, close, or merge.

## Non-goals

- Disabling Git Fork Protection.
- Adding external contributors to the Vercel team or GitHub organization.
- Running fork code inside GitHub Actions.
- Calling the Vercel API or storing a Vercel service token in GitHub.
- Creating duplicate or shadow pull requests.

## Design

Add one workflow with `pull_request_target` and `workflow_dispatch` triggers. A repository-level GitHub Actions variable named `TRUSTED_VERCEL_PREVIEW_USERS` contains a JSON array of exact GitHub logins, initially:

```json
["86doteth"]
```

For automatic `opened`, `reopened`, and `synchronize` events, the workflow mirrors a pull request only when all of these conditions hold:

1. The pull request is open.
2. Its author is in `TRUSTED_VERCEL_PREVIEW_USERS`.
3. The event sender is also in the allowlist, so a collaborator cannot add a commit through a trusted author's fork.
4. The head repository is a fork owned by the pull request author, not the base repository or a shared third-party fork.

A manually dispatched reconciliation applies the same author and fork-owner rules but trusts the repository maintainer who invokes the workflow instead of requiring that maintainer in the partner allowlist.

For an eligible pull request, the workflow:

1. Checks out only the trusted base revision so Git credentials are available without checking out fork files.
2. Fetches the base repository's GitHub-generated `refs/pull/<number>/head` ref.
3. Requires the fetched SHA, live PR head SHA, and triggering event head SHA to match. A manual dispatch uses the live head SHA as its expected value.
4. Force-pushes the unchanged commit to `refs/heads/vercel-preview/pr-<number>` in `loyal-labs/loyal-app`.
5. Re-reads the pull request after the push. If the PR closed or changed during the operation, it deletes the branch only when the branch still points to the SHA pushed by that run.

Vercel then sees an ordinary upstream branch and runs its native monorepo project selection, build, environment injection, deployment status, and preview-comment behavior. Because the shadow branch points to the original head commit rather than a generated merge commit, Vercel reports against the same commit SHA reviewed by the original pull request.

Each reconciliation chooses one explicit action: `mirror`, `delete`, `guarded_delete`, or `noop`. Closed PRs, revoked authors, and invalid fork ownership delete unconditionally. A current event from an untrusted sender deletes only an obsolete branch and preserves a branch that already equals the live head, because a newer trusted run may have authorized that exact SHA. Events whose action or head SHA is stale are non-destructive no-ops. Per-PR concurrency serializes runs, and conditional post-push cleanup cannot delete a newer branch.

GitHub concurrency keeps only one pending run per key and may replace it when another event arrives. In the rare case that out-of-order delivery replaces the only pending run for the current trusted head, automatic reconciliation can finish without a preview. A stale run emits a visible warning, and maintainers recover by dispatching this workflow for the current PR number. This is a GitHub workflow operation, not manual Vercel authorization.

## Operational Configuration

Store the allowlist in the repository-level GitHub Actions variable `TRUSTED_VERCEL_PREVIEW_USERS`:

```bash
gh variable set TRUSTED_VERCEL_PREVIEW_USERS \
  --repo loyal-labs/loyal-app \
  --body '["86doteth"]'

gh variable list \
  --repo loyal-labs/loyal-app \
  --json name,value \
  --jq '.[] | select(.name == "TRUSTED_VERCEL_PREVIEW_USERS") | .value'
```

This is a GitHub repository variable, not a Vercel environment variable. Adding a login trusts that GitHub account's preview code with every secret already configured for the relevant Vercel Preview environments.

Changing a repository variable does not emit a GitHub Actions event. After removing a partner, reconcile each of their open PRs to remove any existing shadow branches immediately:

```bash
gh workflow run trusted-vercel-previews.yml \
  --repo loyal-labs/loyal-app \
  -f pr_number=<pull-request-number>
```

Normal PR activity and close events also reconcile or delete the branch automatically. Use the same dispatch command if a stale-event warning appears and the current head has no preview.

## Security

`pull_request_target` is required because fork-originated `pull_request` workflows receive a read-only token. The workflow remains safe by following these constraints:

- GitHub loads the workflow definition from the default branch, never from the fork.
- The workflow does not check out, source, build, install, or execute pull-request files.
- It uses only the repository-scoped `GITHUB_TOKEN` with `contents: write` and `pull-requests: read`.
- It fetches the GitHub-generated numeric PR ref rather than interpolating a contributor-controlled repository URL or branch name.
- It requires the PR author, automatic-event sender, fork owner, event SHA, fetched SHA, and live PR SHA to agree before pushing.
- Only the Vercel build executes partner code with Preview environment variables. This is intentional and is restricted by the trusted-user policy.

The allowlist is the security boundary. Adding a login means trusting that GitHub account and its personal fork with access to all secrets already assigned to relevant Vercel Preview environments.

## Merge Semantics

Reviewers merge the original contributor pull request through the normal required checks. The temporary `vercel-preview/pr-<number>` branch is never merged.

A Vercel deployment is valid only when it reports on the original pull request's current head SHA. If the canary shows that Vercel does not attach its result to that SHA, the automation must be extended to relay the deployment result; bypassing required checks is not an accepted workflow.

## Failure Handling

- Invalid or missing allowlist JSON fails visibly and closed: no shadow branch is created or updated, and an existing branch is removed when possible.
- A non-allowlisted author, shared fork, internal PR, or closed PR deletes the deterministic branch.
- A current event from an untrusted sender deletes an obsolete branch but preserves a branch that already equals the live PR head.
- A stale close, head event, or pre-push reconciliation is a no-op so it cannot erase a newer valid preview.
- Because GitHub may replace a pending concurrency run, a rare stale-event warning can require a manual GitHub workflow dispatch to reconcile the current head.
- Fetch, API, or push failures fail the workflow visibly.
- Deleting a branch that no longer exists is successful cleanup; other GitHub API errors remain failures.
- Updating a pull request force-updates only its deterministic `vercel-preview/pr-<number>` branch.

## Validation

Use PR #614 as the live canary after the workflow reaches `main`:

1. Dispatch `trusted-vercel-previews.yml` with `pr_number=614`, exercising the workflow's own `GITHUB_TOKEN` push path.
2. Confirm `vercel-preview/pr-614` points exactly to the original PR's current head SHA.
3. Confirm Vercel creates a `loyal-dashboard` Preview deployment for that SHA with its configured Preview environment.
4. Confirm the successful Vercel result and preview URL are visible from the original PR.
5. Dispatch an untrusted fork PR and confirm it has no shadow branch.
6. Close or merge the canary PR and confirm the shadow branch is deleted.

Static validation parses the workflow YAML, validates GitHub Actions and embedded shell syntax with `actionlint`, exercises trusted, untrusted, malformed, mixed-type, stale-event, shared-fork, manual-dispatch, and guarded-delete policy cases, verifies PR #614's GitHub-generated ref, and runs the repository formatter on the new files. No application build is required because this change touches only GitHub Actions configuration and documentation.

## Rollback

Disable or remove the workflow and delete branches under `vercel-preview/`. Vercel Git Fork Protection remains enabled throughout, so rollback restores the existing manual-authorization behavior without changing Vercel project settings.
