# Main preview comparison

This documentation-only branch deploys application code identical to `main` at
`0d7e44a1b2721eeed4a2c964a53a0609561497b5` for comparison with PR #708 under
Vercel's existing preview configuration. No application code, dependencies, or
environment settings are changed.

The file lives under `apps/web` so Vercel's unchanged ignored-build rule sees a
web workspace change. This is a temporary diagnostic PR, not a feature to merge.

Compare the same flow on production, this main-based preview, and the #708
preview. Preview currently shares production databases and Solana mainnet;
transactions are real, not sandboxed. Browser wallet permissions and sessions
remain origin-specific and must also be considered when comparing behavior.
