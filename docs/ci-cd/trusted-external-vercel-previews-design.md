# Trusted External Contributor Vercel Previews

## Context

Vercel Git Fork Protection requires a Loyal Vercel team member to authorize preview deployments from fork pull requests. Trusted partners should receive functional previews with the existing Preview environment variables without joining the Vercel team or requiring per-PR Vercel approval.

PR #614 from `86doteth` is the initial canary. Its relevant deployment is the `loyal-dashboard` Vercel project because the change is under `dashboard/`.

## Goals

- Automatically deploy fork pull requests authored by explicitly trusted GitHub users.
- Preserve Vercel Git Fork Protection for every other external contributor.
- Reuse the existing Vercel Git integration and Preview environment variables.
- Keep the original contributor pull request as the only merge target.
- Remove temporary preview branches when their pull requests close or merge.

## Non-goals

- Disabling Git Fork Protection.
- Adding external contributors to the Vercel team or GitHub organization.
- Running fork code inside GitHub Actions.
- Calling the Vercel API or storing a Vercel service token in GitHub.
- Creating duplicate or shadow pull requests.

## Design

Add one `pull_request_target` workflow. A repository-level GitHub Actions variable named `TRUSTED_VERCEL_PREVIEW_USERS` contains a JSON array of exact GitHub logins, initially:

```json
["86doteth"]
```

For `opened`, `reopened`, and `synchronize` events, the workflow:

1. Reads the pull request author from the trusted base-repository event payload.
2. Stops unless that exact login is in `TRUSTED_VERCEL_PREVIEW_USERS`.
3. Fetches the base repository's immutable pull-request head ref, `refs/pull/<number>/head`.
4. Force-pushes the unchanged head commit to `refs/heads/vercel-preview/pr-<number>` in `loyal-labs/loyal-app`.

Vercel then sees an ordinary upstream branch and runs its native monorepo project selection, build, environment injection, deployment status, and preview-comment behavior. Because the shadow branch points to the original head commit rather than a generated merge commit, Vercel reports against the same commit SHA reviewed by the original pull request.

For `closed` events, the workflow deletes `refs/heads/vercel-preview/pr-<number>` whether the pull request was merged or closed without merging. Cleanup does not depend on the current allowlist, so removing a partner from the variable cannot strand an existing preview branch.

A per-PR concurrency group cancels stale synchronization runs when a newer head commit arrives.

## Security

`pull_request_target` is required because fork-originated `pull_request` workflows receive a read-only token. The workflow remains safe by following these constraints:

- GitHub loads the workflow definition from the default branch, never from the fork.
- The workflow does not check out, source, build, install, or execute pull-request files.
- It uses only the repository-scoped `GITHUB_TOKEN` with `contents: write` and `pull-requests: read`.
- It fetches the GitHub-generated numeric PR ref rather than interpolating a contributor-controlled repository URL or branch name.
- Only the Vercel build executes partner code with Preview environment variables. This is intentional and is restricted by the trusted-user allowlist.

The allowlist is the security boundary. Adding a login means trusting that GitHub account and the code it submits with access to all secrets already assigned to relevant Vercel Preview environments.

## Merge Semantics

Reviewers merge the original contributor pull request through the normal required checks. The temporary `vercel-preview/pr-<number>` branch is never merged.

A Vercel deployment is valid only when it reports on the original pull request's current head SHA. If the canary shows that Vercel does not attach its result to that SHA, the automation must be extended to relay the deployment result; bypassing required checks is not an accepted workflow.

## Failure Handling

- Invalid or missing allowlist JSON fails closed: no shadow branch is created or updated.
- A non-allowlisted author exits without write operations.
- Fetch or push failures fail the workflow visibly.
- Deleting a branch that no longer exists is treated as successful cleanup.
- Updating a pull request force-updates only its deterministic `vercel-preview/pr-<number>` branch.

## Validation

Use PR #614 as the live canary after the workflow reaches `main`:

1. Trigger the workflow for PR #614.
2. Confirm `vercel-preview/pr-614` points exactly to `f2bb6e900474c0166a6bd96ab79c60b1dece2bf9`.
3. Confirm Vercel creates a `loyal-dashboard` Preview deployment for that SHA with its configured Preview environment.
4. Confirm the successful Vercel result and preview URL are visible from the original PR.
5. Confirm an untrusted fork PR does not create a shadow branch.
6. Close or merge the canary PR and confirm the shadow branch is deleted.

Static validation will parse the workflow YAML, inspect its declared permissions and triggers, and run the repository formatter on the new files. No application build is required because this change touches only GitHub Actions configuration and documentation.

## Rollback

Disable or remove the workflow and delete branches under `vercel-preview/`. Vercel Git Fork Protection remains enabled throughout, so rollback restores the existing manual-authorization behavior without changing Vercel project settings.
