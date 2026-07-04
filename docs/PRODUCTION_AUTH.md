# Evolving auth to production (SSO + Redis) — design notes

The pilot auth is deliberately simple and single-instance. These notes show how
to grow it **without a rewrite** — every seam already exists behind an interface
or a config point.

## Current seams (already in place)

| Concern | Today | Config point |
| --- | --- | --- |
| Sessions | Stateless HMAC-signed cookie (`src/auth/session.ts`) | `SESSION_SECRET` |
| Login throttle | In-memory `LoginRateLimiter` (`src/auth/loginRateLimiter.ts`) | — (Map) |
| Passwords | scrypt (`src/auth/passwords.ts`) + policy (`passwordPolicy.ts`) | `PASSWORD_MIN_LENGTH` |
| API auth | Per-org bearer token (`requireApiToken`) | Admin → API access |
| Auth events | `security_events` table + JSON logs | — |
| Redis (future) | not wired | `REDIS_URL` (placeholder in `config.ts`) |

## Redis-backed throttling + sessions (multi-instance)

Needed once more than one app instance runs (throttle state and sessions must be
shared). No route or view changes are required.

1. **Rate limiter.** `LoginRateLimiter` has a small surface: `status`,
   `recordFailure`, `recordSuccess`. Add a `RedisLoginRateLimiter` implementing
   the same shape using `INCR`+`EXPIRE` (counter key `login:{email}:{ip}`) and a
   `SET lock ... PX lockoutMs`. Select the implementation in `container.ts` based
   on `config.redisUrl`. Nothing else changes.
2. **Sessions.** Two options, in order of effort:
   - *Keep stateless cookies* (works across instances as-is, since all instances
     share `SESSION_SECRET`) and add a Redis **revocation set** (`session:revoked`)
     checked in `sessionLoader` — enables logout-everywhere and force-logout on
     password change. This is the smallest step and is recommended.
   - *Move to server-side sessions*: store `session:{id} → {uid, exp}` in Redis,
     put the opaque id in the cookie. Only `session.ts` + `sessionLoader` change.
3. **CSRF** is derived from the session cookie, so it continues to work unchanged
   under either option.

## SSO / OAuth (Google / Microsoft) — municipal IT often requires it

The gate is already centralized (`sessionLoader` + `requireWebAuth`), so SSO is
additive:

1. Add `/auth/sso/:provider` (redirect) and `/auth/sso/:provider/callback`
   routes using an OIDC client. On callback, look up or provision the `users`
   row by verified email (respect existing role/deactivation), then issue the
   **same session cookie** we issue today — downstream code is unchanged.
2. Keep password login as a fallback/break-glass path; disable self-service
   password change for SSO-provisioned users.
3. Map the IdP's groups/roles to the existing `admin`/`member` roles.
4. `security_events` already captures the login; add `event=login_sso`.

## Other production follow-ups (tracked, not in this pass)

- First-login/reset already forces a password change; add **email-token
  self-service reset** (needs an email provider — the current reset is
  admin-triggered).
- **Session rotation on password change** (revocation set above).
- **Scoped, revocable API keys** per integration, replacing the single per-org
  token.
- `Retry-After` header on `429` login lockouts.
