# QTestHub — Security Configuration

What's enforced, where, and why — for whoever needs to answer "is this
secure enough to deploy" without re-reading the whole codebase.

## 1. Session security

- **Cookie flags**: `HttpOnly` (always), `SameSite=Lax` (always), `Secure`
  (whenever `ENVIRONMENT != "development"` — i.e. always in a real
  deployment). See `backend/app/core/auth.py::set_session_cookie`.
- **No signed-JWT secret to manage**: sessions are DB-backed opaque tokens
  (a `sessions` table row; the cookie value is just its UUID, looked up on
  every request) rather than a self-contained signed token — there is no
  server-side signing key whose compromise would forge arbitrary sessions.
- **Expiration**: an idle timeout (`SESSION_TTL_MINUTES`, default 30 — a
  session not seen for this long is revoked on its next use) and an absolute
  ceiling (`SESSION_ABSOLUTE_TTL_HOURS`, default 12, set once MFA succeeds).
- **Secure logout**: `POST /auth/logout` sets `revoked_at` on the session row
  server-side (not just clearing the cookie client-side) — a captured,
  already-logged-out cookie can never be replayed.
- **Session rotation after privilege elevation** (deployment-hardening pass):
  the session identifier issued at login (pre-MFA) is **not** the same one
  used after MFA succeeds — `verify_mfa` mints a new session row and revokes
  the pre-MFA one, rather than flipping a flag on the same row. This is a
  standard session-fixation mitigation: a lower-trust, pre-authentication
  identifier can never be replayed to reach an authenticated state, even if
  it was captured (e.g. over a compromised network before TLS was in place,
  or via a shared/logged terminal) during the brief pre-MFA window. See
  `backend/tests/test_auth_flow.py::test_mfa_verification_rotates_session_id`.
- **CSRF**: not separately mitigated with a generic CSRF token, by design —
  every mutating endpoint requires a valid, non-forgeable session cookie AND
  is only reachable via this app's own JSON API (`Content-Type:
  application/json` bodies, not classic HTML form submissions), and the
  cookie is `SameSite=Lax`, which already blocks the cross-site form-POST
  pattern CSRF tokens exist to stop. Revisit if a future feature starts
  accepting `application/x-www-form-urlencoded` bodies, which would reopen
  the attack surface `SameSite=Lax` + JSON-only currently closes.
  **One genuine exception, already handled separately**: `GET
  /auth/sso/{tenant_id}/callback` (Tier 4) is a state-changing GET by
  necessity — it's an OAuth redirect target, which must be a GET per the
  OIDC spec, and it provisions/logs a user in as a side effect. This is
  protected by its own dedicated mechanism, not the app-wide reasoning
  above: the `state` parameter the IdP echoes back is compared against a
  value stored in a short-lived `HttpOnly` cookie set immediately before
  the redirect to the IdP — the standard OAuth CSRF mitigation for exactly
  this kind of endpoint, not an oversight.
- **Platform Administration is a separate plane** (ADR-008): HTTP Basic
  against `platform_admins`, not the session mechanism above. See §3.

## 2. Rate limiting

| Scope | Limit | Where |
|---|---|---|
| `POST /auth/login` | 10/minute per IP | `app/api/auth.py` |
| `POST /auth/mfa/verify` | 10/minute per IP | `app/api/auth.py` |
| `POST /users/invite/{token}/accept` | 10/minute per IP | `app/api/users.py` |
| CSV import (`POST /test-cases/import`) | 10/minute per IP | `app/api/csv_import.py` |
| Attachment upload (3 routes) | 30/minute per IP | `app/api/attachments.py` |
| All platform routes | 60/minute per IP | `app/core/platform_auth.py` (applied at the shared `require_platform_admin` dependency, so it runs before any route body) |
| All SCIM routes (6 routes) | 60/minute per IP | `app/api/scim.py` |
| **Everything else** (deployment-hardening pass) | **300/minute per IP** | `app/core/rate_limit.py`'s `Limiter(default_limits=["300/minute"])`, applied by `SlowAPIMiddleware` to any route without its own specific limit |

There is no self-service "forgot password" flow in this application (users
are either invited, or an Admin resets their password directly) — the
invite-accept endpoint above is the closest equivalent and is rate-limited.

Keyed by client IP (`get_remote_address`), in-memory storage — there is no
Redis/cache layer in the approved stack (see `app/core/rate_limit.py`'s own
note). This means limits are per-process: scaling `api` horizontally to N
replicas multiplies the effective ceiling by N. Revisit with a shared
store if that becomes a real concern at your deployment's scale.

## 3. Platform Administration hardening (ADR-052)

- **Lockout**: 5 consecutive failed logins locks the account for 15 minutes
  (`PLATFORM_ADMIN_MAX_FAILED_LOGINS`/`PLATFORM_ADMIN_LOCKOUT_MINUTES`).
- **Audit attribution**: every tenant-create/status-change action records
  which platform admin performed it.
- **A full session+MFA replacement of this HTTP Basic plane was deliberately
  deferred** (ADR-052) — disproportionate given the test/frontend blast
  radius it would require. Treat platform admin credentials with
  password-manager-grade care until that follow-up phase happens.

## 4. CORS

`CORS_ALLOW_ORIGINS` (a JSON array of exact origins) — never a wildcard in
production; `validate_for_production` (§6) refuses to start if it's left at
`*` or the local-dev default when `ENVIRONMENT=production`.

## 5. Security headers

Set at the nginx layer (both `frontend/nginx.conf` and
`deploy/nginx/reverse-proxy.conf`, deployment-hardening pass):
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, and (edge proxy only,
once HTTPS is actually in place) `Strict-Transport-Security`. Request size
is capped at 20MB (above the 10MB application-level attachment limit, so a
legitimate upload is never cut off at the proxy layer) and proxy timeouts are
set explicitly rather than left at nginx's defaults.

## 6. Startup configuration validation (deployment-hardening pass)

`app/core/config.py::validate_for_production`, called at import time in
`app/main.py`, refuses to start with `ENVIRONMENT=production` and any of:
simulated MFA delivery (would leak one-time codes in API responses), the
hardcoded dev database URL, or an unset/wildcard/dev-default CORS origin
list. See `backend/tests/test_production_config_validation.py`.

## 7. Security-event logging (deployment-hardening pass)

In addition to the generic per-request access log line, these emit a
distinct `security_event=...` JSON log line: failed tenant login, MFA
lockout, platform-admin login failure/lockout, IP-allowlist rejection, and
any rate-limit trip. None of these ever include a password, MFA code, or
token value. Grep your log aggregator for `security_event` to build an
alert on repeated auth failures.

## 8. What was verified by running the existing test suite, not re-audited from scratch

Input validation, authorization enforcement (permission checks per route),
tenant isolation (row-level security + the application-level checks on top
of it), password hashing (bcrypt via `passlib`, see
`app/core/security.py`), and file-upload validation (size/type limits) are
all extensively covered by this project's existing design and five prior
tiers of work. This pass ran `tests/test_security_hardening.py` and
`tests/test_rls_isolation.py` to confirm they still pass rather than
re-deriving their findings — see the verification results in this pass's
final report for the actual run output.

## 9. Known, disclosed gaps (not fixed in this pass, by design)

- **IP allowlist self-lockout risk** (Tier 4): a tenant admin who excludes
  their own network from the allowlist is locked out with no *tenant-side*
  in-app recovery. **A platform-admin recovery path now exists**
  (gap-closure pass, ADR-057): `POST /platform/tenants/{id}/clear-ip-
  allowlist`, audit-logged, documented as the procedure in
  `docs/ADMINISTRATOR_GUIDE.md` §1.3/§2.2.
- **SSO/SCIM validated against stubs/spec shapes only** (Tier 4) — no real
  external IdP (Okta/Azure AD/Google Workspace) exists in this environment.
  Required before production reliance: a real-IdP validation pass.
- **No real TLS certificate** exists in this environment — HTTPS
  configuration is structurally valid but untested against a real browser.
