# Verifier: hosted ClickStack authentication origin

Run this verifier cold from the repository root. Report PASS or FAIL for each
Required section and return overall PASS only when every Required condition is
proven. Do not accept UI health alone as proof that authentication works.

## Required

1. Configuration contract
- On Render, startup derives `FRONTEND_URL` from Render's canonical external
  HTTPS URL before the upstream ClickStack entrypoint loads its API config.
- Render startup fails before serving traffic if the external URL is absent,
  malformed, non-HTTPS, contains credentials/query/fragment, or targets a
  loopback host. No deployment-specific hostname is hardcoded in the image.
- Local Docker remains usable without Render variables and retains the upstream
  localhost behavior.

2. Isolated authentication proof
- A fresh local container configured with a synthetic HTTPS external origin
  returns HTTP 200 from `/api/health`.
- After registering a unique test user, a password login returns HTTP 303 with
  `Location` equal to the configured external origin plus `/`.
- A failed password login returns HTTP 303 with `Location` on that same origin,
  CORS allows exactly that origin, and the session cookie uses the external
  domain with `Secure` and `SameSite=Lax`.
- None of those response headers contains `localhost`.
- A negative Render fixture with no external URL exits nonzero.

3. Live Render end state
- The latest deploy for `srv-d9c40evlk1mc73953cf0` is `live` at the tested Git
  commit, and both the public root and `/api/health` return 2xx/3xx.
- A credential-free failed-login probe redirects to
  `https://loyal-clickstack.onrender.com/login?err=authFail`; CORS allows that
  exact origin and relevant response headers contain no localhost URL.
- A controlled restart preserves the existing ClickHouse smoke marker, and
  recent logs have no authentication-origin startup failure or crash loop.

4. Scope and safety
- The worktree is clean after commit. Only observability-owned files change;
  no frontend/app/admin/mobile/extension code, lockfile, or plaintext secret is
  added, and observability-only deploy isolation still passes.

## Nice to have

- Browser navigation after sign-in remains on the hosted HTTPS origin.

## Verdict

Overall PASS only if every Required section passes. If account credentials are
unavailable, browser sign-in is Nice to have; the successful local login plus
live failed-login/CORS contract remains mandatory.
