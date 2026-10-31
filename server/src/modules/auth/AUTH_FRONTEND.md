# Auth API handoff

Apidog token-capture correction (2026-10-21): the complete refresh cookie value is 68 characters: a 24-character lowercase hexadecimal session ID, a literal dot, and a 43-character base64url secret. Keep the whole value in the selected environment's local/current REFRESH variable; do not save only the secret. JWT comes from data.accessToken. The saved scripts validate both fields before updating either variable, including after refresh rotation. Shared/initial environment values are not updated by these scripts. This fixes the desktop integration only; browser code must continue to treat the HttpOnly cookie as opaque and cannot read it.

The [Apidog example guide](../../../../docs/apidog/README.md#request-and-response-examples) includes both stores' Auth request schemas and populated responses. The example OTP/password/JWT/refresh values are synthetic. Login and refresh save real runtime values into JWT/REFRESH only after a successful response; no refresh token is added to the JSON body or JSON response contract.

Customer notification integration (2026-10-12): [shared email delivery](../../shared/infrastructure/email/EMAIL_DELIVERY_FRONTEND.md) now reuses the same configured SMTP sender for Order/Lead event emails. Auth OTP messages retain their existing direct sending/error/resend/expiry flow and do not enter that queue. Blank customer tracking templates disable customer notifications without disabling SMTP OTP delivery. No Auth route, field, cookie, permission or response changed.

Source checked: 2026-10-24

Apidog setup (2026-10-14): both store login/refresh requests save data.accessToken to environment JWT and the store-specific Set-Cookie value to REFRESH using saved post-response scripts. Protected requests use native Bearer Token with {{JWT}}; refresh uses No Auth plus its Cookie/Origin headers. This is desktop testing transport, not browser access to HttpOnly cookies. Read the [complete Apidog setup](../../../../docs/apidog/README.md) for environment isolation, rotation and credential handling.

This document describes the implemented authentication contract for the B2C and B2B storefronts and their separate dashboards. Shared response/error conventions and broader journeys are linked at [API conventions](../../../../docs/frontend/api-conventions.md), [B2C flow](../../../../docs/frontend/b2c-flow.md), and [B2B flow](../../../../docs/frontend/b2b-flow.md). Those files are maintained separately; the schemas and behavior below are self-contained.

Related module handoffs: [Users](../users/USERS_FRONTEND.md).

## Scope and request handling

The API prefix is `/api/v1`. Storefront routes are mounted under `/api/v1/b2c` and `/api/v1/b2b`; dashboard routes are mounted separately under `/api/v1/admin/b2c` and `/api/v1/admin/b2b`. Every store has independent accounts and authentication sessions. A token issued for one store cannot authenticate against the other store's route.

Successful responses use `{ "success": true, "code": "...", "message": "...", "data": ..., "requestId": "..." }`; when no data applies, `data` is `null`. Errors use `{ "success": false, "code": "...", "message": "...", "errors": [{ "field": "...", "location": "body|params|query", "code": "...", "message": "..." }], "requestId": "..." }`. Validation errors are 422 and report only the first error per field. Unmatched routes return 404 `NOT_FOUND`. The `message` is localized; clients should branch on stable `code` values.

Send `X-Language: en` or `X-Language: ar` to select the response and email language. Otherwise `Accept-Language` is negotiated and the configured default is used. Responses include `Content-Language` and `X-Request-Id`; `X-Request-Id` is exposed to browser clients. JSON request bodies are limited to 100 KB.

Authenticated requests use `Authorization: Bearer <accessToken>`. Access tokens are JSON Web Tokens with a 15-minute lifetime. Keep the token in the client session and send it on protected calls; do not expect the refresh token in JSON. The access token is scoped to its store and session. Missing, malformed, expired, revoked, cross-store, or stale tokens return 401 `UNAUTHORIZED`. Inactive accounts also return 401. An unverified account cannot log in and receives 403 `EMAIL_NOT_VERIFIED`; a role mismatch is 403 `FORBIDDEN`.

Login and refresh set a store-specific HttpOnly cookie named `narmer_refresh_b2c` or `narmer_refresh_b2b`. It has `SameSite=Lax`, path `/api/v1/<store>/auth`, and a seven-day expiry from session creation. `Secure` is enabled in production. Browser clients must use credentials for these requests and allow the cookie. Refresh additionally requires an `Origin` header exactly present in the configured CORS origin allowlist, even for same-origin clients; absent or disallowed Origin returns 403 `FORBIDDEN`. CORS allows credentials. The browser must not try to read this HttpOnly cookie. The refresh call rotates the cookie value and rejects replay of the previous value. Logout clears the same cookie path and revokes the current session.

### Throttling

Auth retains per-process, per-store-router IP limits: register/resend/forgot-password share 10 requests per 15 minutes; verify-email/login/refresh/logout/reset-password share 30 per 15 minutes. Login also allows 10 failed requests per normalized store/email per 15 minutes across IPs, after input validation; successful login responses are removed from this identity counter, but still consume IP budget. Once exhausted, even the correct password receives 429 until expiry. Super-admin handover uses the general API IP and verified-account budgets. All Auth responses are Cache-Control: no-store. RateLimit, RateLimit-Policy and Retry-After are exposed to allowed origins; honor Retry-After and preserve input rather than refreshing/retrying repeatedly. All counters are process-local; see the shared security section below.

## Endpoints

All endpoints below exist for both `{store}=b2c|b2b`, except handover, which exists at `/api/v1/admin/{store}/auth/super-admin/handover`.

| Method and path | Authentication | Success | Other implemented statuses |
|---|---|---|---|
| POST `/api/v1/{store}/auth/register` | None | 201 `OTP_REQUESTED` | 422 `VALIDATION_ERROR`; 429 `TOO_MANY_REQUESTS`; 503 `EMAIL_UNAVAILABLE`; 500 `INTERNAL_ERROR` |
| POST `/api/v1/{store}/auth/resend-otp` | None | 200 `OTP_REQUESTED` | 422 `VALIDATION_ERROR`; 429 `TOO_MANY_REQUESTS`; 503 `EMAIL_UNAVAILABLE`; 500 `INTERNAL_ERROR` |
| POST `/api/v1/{store}/auth/verify-email` | None | 200 `EMAIL_CONFIRMED` | 400 `INVALID_OTP`; 422 `VALIDATION_ERROR`; 429 `TOO_MANY_REQUESTS`; 500 `INTERNAL_ERROR` |
| POST `/api/v1/{store}/auth/login` | None | 200 `OK`, session data and cookie | 401 `INVALID_CREDENTIALS` or `UNAUTHORIZED`; 403 `EMAIL_NOT_VERIFIED`; 422 `VALIDATION_ERROR`; 429 `TOO_MANY_REQUESTS`; 500 `INTERNAL_ERROR` |
| POST `/api/v1/{store}/auth/refresh` | Refresh cookie and allowed Origin | 200 `OK`, rotated session data and cookie | 401 `UNAUTHORIZED`; 403 `FORBIDDEN`; 429 `TOO_MANY_REQUESTS`; 500 `INTERNAL_ERROR` |
| POST `/api/v1/{store}/auth/logout` | Access token | 200 `LOGGED_OUT`, clears cookie | 401 `UNAUTHORIZED`; 429 `TOO_MANY_REQUESTS`; 500 `INTERNAL_ERROR` |
| POST `/api/v1/{store}/auth/forgot-password` | None | 200 `OTP_REQUESTED` | 422 `VALIDATION_ERROR`; 429 `TOO_MANY_REQUESTS`; 503 `EMAIL_UNAVAILABLE`; 500 `INTERNAL_ERROR` |
| POST `/api/v1/{store}/auth/reset-password` | None | 200 `PASSWORD_RESET`, clears cookie | 400 `INVALID_OTP`; 422 `VALIDATION_ERROR` or `PASSWORD_TOO_LONG`; 429 `TOO_MANY_REQUESTS`; 500 `INTERNAL_ERROR` |
| POST `/api/v1/{store}/auth/change-password` | Current access token, any same-store role | 200 `PASSWORD_CHANGED`, data:null; clears cookie | 400 `INVALID_CURRENT_PASSWORD`; 401 `UNAUTHORIZED`; 409 `ACCOUNT_CONFLICT`; 422 `VALIDATION_ERROR`; 429 `TOO_MANY_REQUESTS`; 500 `INTERNAL_ERROR` |
| POST `/api/v1/admin/{store}/auth/super-admin/handover` | Access token, current `superAdmin` | 200 `SUPER_ADMIN_CHANGED`, data below; clears cookie | 401 `UNAUTHORIZED`; 403 `FORBIDDEN`; 409 `INVALID_SUPER_ADMIN_TARGET` or `ACCOUNT_CONFLICT`; 422 `VALIDATION_ERROR`; 500 `INTERNAL_ERROR`; Mongo transaction requirements may yield 503 `TRANSACTIONS_REQUIRED` |

For all requests, malformed JSON is 400 `INVALID_JSON`, bodies over 100 KB are 413 `BODY_TOO_LARGE`, unsupported encoding is 415 `UNSUPPORTED_ENCODING`, and disallowed browser origins can be rejected by CORS as 403 `CORS_DENIED`. These are shared application-level responses.

### Request schemas

Only the listed fields are consumed. Extra JSON properties are ignored and never grant roles or select another store. Strings must be JSON strings; object values do not pass validation.

- `register`: required `name` (string, trimmed, 1–100 characters), `email` (string, trimmed, max 254, valid email, lowercased), `phone` (string, trimmed then spaces/parentheses/hyphens removed, then 6–15 digits with optional leading `+`), `password` (string, 8–72 characters and must not exceed bcrypt's 72-byte limit). Password whitespace is preserved.
- `resend-otp`, `forgot-password`: required `email`, same validation and normalization as above.
- `verify-email`, `reset-password`: required `email` as above and `otp` as a six-character digit string. Leading zeroes are significant.
- `login`: required `email` and `password`; password has the same 8–72 character/72-byte constraints as register. Password contents are not trimmed.
- `refresh`, `logout`: no request body fields are consumed. Refresh uses the cookie; logout uses the access token.
- `reset-password`: additionally requires `password` with the same constraints as registration.
- `super-admin/handover`: required `userId` (24-character Mongo ObjectId hex string). Other fields are ignored.

A successful registration always creates a `user` role in the URL-selected store. A repeated signup for the same store/email does not change the existing password or profile; if the existing account is active and unverified, the handler may issue a verification challenge. Resend and forgot-password deliberately return the same success code whether an account exists or is eligible, so the response is not an account lookup signal.

#### Request field origins and what to retain

All fields below are JSON body fields, not query parameters. Required fields reject null, omission, blank values where the stated constraints disallow them, and non-string JSON types. These fields have no server-selected input defaults. The store is the literal b2c/b2b route segment chosen by the frontend's storefront/dashboard context, never a body field. Auth consumes no query filters. Extra query/body fields do not select a store or grant a role.

| Field | Where the frontend gets it and what it means | Next use and retention |
| --- | --- | --- |
| name | User-entered signup name; the server trims it and saves it as the account display name. | Keep the entered value only while the form is active. After login, use data.user.name or Users data.name; later profile edits use PATCH /api/v1/{store}/users/me, not another register call. |
| email | User-entered signup/login/recovery email, or the current account's returned email when prefilling recovery. Trim and lowercase for retained frontend state to match server normalization. | Keep the normalized email across register → resend-otp → verify-email → login, or forgot-password → reset-password. A null action response does not return it. Do not infer account ownership by comparing it with guest Order/Lead contact emails. |
| phone | User-entered main account contact number. The server strips literal spaces, parentheses and hyphens after trimming, then checks 6–15 digits with optional leading +. It does not verify phone ownership or automatically convert an Egyptian local number to international form in the account DTO. | After login use data.user.phone for display and editable checkout/Lead prefill; saved addresses expose effectiveContactPhone separately. Change the account phone through Users, not Auth. |
| password | User-entered account password, or the desired replacement password on reset-password. Its exact whitespace is significant; do not trim it or coerce it to a number. | Send only to register/login/reset-password as appropriate. Do not keep it as reusable application state, store it beside JWTs, log it, or expect it in any response. |
| otp | Six-digit string read by the user from the email for this store and purpose. Preserve leading zeroes. The verification code and password-recovery code are different challenges. | Hold only for the relevant verify-email or reset-password submission. A newly issued code replaces the earlier code for that purpose; clear old code input when the user requests another. No response returns the code, challenge ID, attempt count or expiry timestamp. |
| userId | Existing target account's data.id from dashboard Users detail or data.items[].id from its list. This is the target of explicit superAdmin handover, not the caller's JWT subject or a signup email. | Submit unchanged in POST /api/v1/admin/{store}/auth/super-admin/handover. Use a different active, confirmed account in that same store. The response supplies superAdminId but no replacement session. |

On public register/resend/verify/login/forgot/reset calls, Authorization is not required or consumed for account selection. Refresh consumes exactly one valid store-specific refresh cookie and an allowed Origin; it does not consume an access JWT or a refreshToken JSON field. Logout and handover consume the Bearer access JWT and have their own role rules. Send credentials: include on login/refresh/logout/reset/handover browser calls so cookie setting/clearing reaches the browser. Content-Type: application/json is required when sending a documented JSON body; refresh/logout need no body.

Every request string in this table is validated before business logic. A malformed six-digit code request fails 422 before a challenge attempt is consumed. A well-formed but incorrect code can consume an attempt and returns 400 INVALID_OTP. Field-level errors carry location=body and the field name; a service-level failure can have an empty errors array. Never distinguish nonexistent accounts from resend/recovery success messages.

Example requests (the path's store selects the account space):

```http
POST /api/v1/b2c/auth/register
Content-Type: application/json

{"name":"Example Customer","email":" CUSTOMER@example.com ","phone":"+20 (100) 123-4567","password":"correct horse 123"}
```

```http
POST /api/v1/b2c/auth/resend-otp
Content-Type: application/json

{"email":"customer@example.com"}
```

```http
POST /api/v1/b2c/auth/verify-email
Content-Type: application/json

{"email":"customer@example.com","otp":"012345"}
```

```http
POST /api/v1/b2c/auth/login
Content-Type: application/json

{"email":"customer@example.com","password":"correct horse 123"}
```

Refresh and logout have no request body. Refresh sends the cookie and allowed `Origin`; logout sends the Bearer access token. Forgot-password uses `{"email":"customer@example.com"}`. Reset-password uses `{"email":"customer@example.com","otp":"012345","password":"new secure password"}`. Handover uses `{"userId":"507f1f77bcf86cd799439022"}`. Every JSON example is a representative request body; response envelopes follow the shared conventions linked above.

### Response data schemas

Registration, resend, verification, logout, forgot-password, and password-reset return `data: null`. Login and refresh return this exact data object:

```json
{
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "store": "b2c",
    "name": "Example Customer",
    "email": "customer@example.com",
    "phone": "+201001234567",
    "role": "user",
    "emailVerified": true
  },
  "accessToken": "<signed JWT string>",
  "expiresIn": 900
}
```

The following table defines every field returned for login and refresh. All keys shown in the JSON are present and non-null on success.

| Field | Type/presence | Source and meaning | FE retention/use |
|---|---|---|---|
| `user` | Object, required | Current public account projection from Users service | Retain as current identity/UI state; refresh it after role-changing operations or re-login |
| `user.id` | String, required | User Mongo ID rendered as hex | Retain as account identifier for current UI context; never use it to choose authorization scope |
| `user.store` | String (`b2c` or `b2b`), required | Store selected by route and account record | Retain for storefront context; call matching store routes |
| `user.name` | String, required | Current profile name | Retain for display |
| `user.email` | String, required | Lowercased account email | Retain for display/recovery form; it is immutable in Users APIs |
| `user.phone` | String, required | Normalized account phone | Retain for display/contact |
| `user.role` | String, required | Current account role, including `user`, `moderator`, `admin`, or `superAdmin` | Retain for UI navigation only; server checks every protected operation |
| `user.emailVerified` | Boolean, required | Derived from `emailVerifiedAt` | Retain for UI state |
| `accessToken` | String, required | Signed JWT for this store and session | Retain in the active client session and send as Bearer token; treat as opaque |
| `expiresIn` | Number, required | Access-token lifetime in seconds (900) | Use to schedule refresh; not an absolute timestamp |

There is no `refreshToken` or refresh expiry key in JSON; refresh state is provided only through `Set-Cookie`.

Registration and OTP actions do not return a User DTO. Since registration returns `data: null`, the FE must retain the normalized email input itself for verification/resend; it cannot obtain that value from the response.

Super-admin handover returns:

```json
{
  "superAdminId": "507f1f77bcf86cd799439022",
  "formerSuperAdminRole": "admin"
}
```

| Field | Type/presence | Source and meaning | FE retention/use |
|---|---|---|---|
| `superAdminId` | String, required, non-null | New assigned holder's user ID | Retain only if needed for immediate UI; normally reload the staff list |
| `formerSuperAdminRole` | Literal string `admin`, required, non-null | Role assigned to the former holder | Use to update the acting UI's role state, then clear the invalidated session and sign in again |

The FE may retain `superAdminId` for display or refresh the staff list; this response does not include the new user's full profile or a replacement access token. The existing super-admin's cookie is cleared. Both affected accounts' existing sessions become invalid and each must sign in again.

## Client flow

### Signup and email verification

1. POST `register` with `name`, `email`, `phone`, and `password`. On 201, show a generic instruction to check email; retain the normalized email for verify/resend. `OTP_REQUESTED` does not prove an account was created or a message delivered.
2. The email contains a six-digit code valid for 10 minutes. The code is single-use and scoped to store, account, purpose, and the account's current auth version. Up to five verification attempts are accepted per challenge. The user may request a resend, with a minimum 60-second interval. Resend resets attempts and replaces the code when eligible.
3. POST `verify-email` with the same email and code. On `EMAIL_CONFIRMED`, proceed to login; this endpoint does not issue tokens or cookies.

### Login, refresh, and logout

1. POST `login` with email and password. On success, store the JSON `accessToken` for the client session, note `expiresIn: 900`, and let the browser retain the HttpOnly refresh cookie. The response's `user` projection is the current client identity. If the user is staff, use the returned role for navigation, but server authorization remains authoritative.
2. Send the access token as Bearer authorization on protected endpoints. Before or after access-token expiry, POST `refresh` with credentials enabled, the existing refresh cookie, and an allowed `Origin`. Replace the in-memory access token with returned `accessToken`; the browser processes the rotated cookie. Refresh does not extend the original seven-day session expiry.
3. If refresh returns 401, clear local auth state and require login. Concurrent refresh calls can race; only one use of a given refresh cookie succeeds, so serialize refresh requests.
4. POST `logout` with the current access token. Clear client access-token state on success. The server revokes that session and clears its cookie. Other separately logged-in sessions are unaffected.

### Password recovery

1. POST `forgot-password` with email. Always show the same generic success guidance; eligible active verified accounts receive an email, while unknown/ineligible accounts are not disclosed.
2. The recovery code is valid for 10 minutes, single-use, and limited to five attempts; resend throttle is 60 seconds. POST `reset-password` with email, `otp`, and new `password`.
3. On `PASSWORD_RESET`, clear local access-token state and require login. Password reset increments the account auth version, invalidating all its access tokens and refresh sessions in that store. The endpoint clears the cookie in the current browser response; other browsers' stale cookies are rejected on refresh.

The OTP request routes return 503 `EMAIL_UNAVAILABLE` if email transport is not configured or delivery fails. A failed delivery discards the just-issued challenge so the user can retry.

## Uncertain responses and safe recovery

| Operation | What repeating it means | Frontend recovery |
| --- | --- | --- |
| register/resend-otp/forgot-password | Generic acknowledgment is not proof of delivery; the challenge resend interval can suppress another email while still returning success. Registration never overwrites an existing profile/password. | Retain normalized email, show the same generic acknowledgment, and allow a later resend. Do not automatically loop until a message arrives. |
| verify-email | The code is single-use. If the first call succeeded but its response was lost, repeating it can return INVALID_OTP rather than EMAIL_CONFIRMED. | Try the intended login flow to reconcile confirmation; keep the email and avoid assuming verification failed merely because replay rejected the consumed code. |
| login | Creates a new session on each successful call; it is not an idempotent session lookup. | Accept only the current successful response, replace the access token/identity, and let the browser process the corresponding cookie. Avoid parallel login submissions. |
| refresh | Rotates a single-use refresh value without extending the original seven-day expiry. Concurrent refreshes or retry with the old value can fail. | Serialize refresh across queued API calls. Replace the JWT from the winning response. If no usable result can be recovered and refresh returns 401, require login rather than repeatedly replaying stale state. |
| logout | Revokes the current session; a later call using its JWT can return 401 because the session is already invalid. | Clear local identity/tokens even when reconciliation confirms that this session no longer authenticates; do not treat that 401 as a request to refresh the logged-out session. |
| reset-password | Consumes the reset code and invalidates existing sessions; it is not a replayable password-setting API. | After an uncertain response, try login with the intended new password. If reset must be attempted again, request a new recovery challenge; never keep replaying an exhausted/consumed code. |
| superAdmin handover | Invalidates both affected accounts' sessions and changes the authoritative assignment; the caller's original JWT cannot authorize a second handover. | Clear old acting-session state, sign in again, and reload Users/role state before deciding another action. Do not optimistically assume the old account is still superAdmin. |

## Super-admin provisioning and handover

The first super-admin is provisioned operationally, not through a public signup role or an HTTP promotion endpoint. First create and verify a normal account, then an operator runs `npm --prefix server run provision:super-admin -- --store b2c --email owner@example.com` (or `--store b2b`). The package command loads `server/.env`; the script requires database configuration and MongoDB transactions. It prints only a success event/store/user ID or failure code. Only one super-admin assignment exists per store. The target must be active, email-verified, and not already super-admin. Provisioning changes role, increments auth version, and writes `superAdmin.provisioned` audit state atomically; the user must sign in again after provisioning.

The HTTP handover endpoint is dashboard-only and requires the current assigned super-admin. Its target must be a different, active, verified account in that same store; the current holder cannot be selected. The transfer is transactional, moves the assignment, changes the former holder's role to `admin`, promotes the target to `superAdmin`, increments both auth versions, and writes `superAdmin.handover` audit state. Both users' old sessions stop working. The response clears the caller's refresh cookie; sign in again as the new role.

## Error codes specific to Auth

- `INVALID_CREDENTIALS` (401): email/password pair does not authenticate.
- `EMAIL_NOT_VERIFIED` (403): correct credentials, but email confirmation is pending.
- `INVALID_OTP` (400): OTP missing from current challenge, wrong, expired, exhausted, consumed, replaced, or for a different purpose/version.
- `EMAIL_UNAVAILABLE` (503): email service unavailable or send failed.
- `OTP_REQUESTED` (200/201): generic request acknowledgement; no eligibility details.
- `PASSWORD_TOO_LONG` (422): bcrypt would truncate the password beyond 72 bytes.
- `SUPER_ADMIN_ALREADY_SET` (409): store already has a holder.
- `INVALID_SUPER_ADMIN_TARGET` (409): handover/provision target fails state/store/account rules.
- `ACCOUNT_CONFLICT` (409): optimistic concurrency or assignment update conflict.
- `TRANSACTIONS_REQUIRED` (503): database does not support required Mongo transactions.

## Source and implemented boundaries

The contract was traced through `auth.routes.js`, controller, validators, service, repository, model, middleware, crypto policy, app mounting, request context, shared response/error handling, the provisioning script, and focused Auth HTTP/service and Users staff tests. Access-token contents are server-internal JWT claims; clients should treat the token as opaque. Auth does not expose a token inspection endpoint. No social login, account-verification status lookup, password-change-while-signed-in, session list/revoke-all, or public role-promotion endpoint is implemented.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.

## Dashboard-created accounts and signed-in password change — 2026-10-24

The [Users contract](../users/USERS_FRONTEND.md) now includes superAdmin-only account creation with a selected admin/moderator/user role and a manually handed-over password. These accounts are active and approved for immediate login without email/OTP, represented by emailVerified:true. This approval is not evidence of mailbox verification. Public registration still creates only user accounts and retains its existing OTP gate.

POST /api/v1/{store}/auth/change-password is available to every authenticated same-store role, including an ordinary B2C user. Required body fields are currentPassword and newPassword: non-null strings,8–72characters and at most72UTF-8bytes each, with no trimming. Both come from the current person's password form. No email, OTP, account ID, role or version is required or trusted in this body; unknown fields are ignored. Send Content-Type:application/json and the current person's Bearer accessToken, optionally X-Language:en|ar. Browser Origin/CORS requirements remain in force. No query/path parameters other than store are accepted.

200 PASSWORD_CHANGED returns the usual success, code, localized message and requestId with required data:null. It returns no JWT, user DTO, refresh token or replacement session. The server clears narmer_refresh_{store} using HttpOnly, SameSite=Lax, Secure in production and Path=/api/v1/{store}/auth. Clear the old access/account/private state, clear both password inputs, then show the same store's login screen and use the new password. Browser JavaScript must not read the HttpOnly cookie.

The server checks the current account/session and current password hash, then performs an atomic password-hash update guarded by authVersion. Success increments that version, making all previous access tokens, refresh sessions and email challenges unusable; no multi-document transaction is needed. Wrong current password returns400 INVALID_CURRENT_PASSWORD without changing sessions or credentials. A competing password/account-version change can return409 ACCOUNT_CONFLICT, or401 UNAUTHORIZED if invalidation is observed earlier. After an ambiguous timeout, try a fresh login with the new password rather than replaying the old token. No forced first-login change or password-history/reuse restriction is added.

Validation returns422 VALIDATION_ERROR with body field paths currentPassword/newPassword and INVALID_FIELD or PASSWORD_TOO_LONG detail codes. Missing, blocked, expired, revoked or wrong-store authentication returns401 UNAUTHORIZED. Existing unconfirmed public accounts remain subject to403 EMAIL_NOT_VERIFIED. Generic failures return500 INTERNAL_ERROR; responses never include passwords, hashes or internal versions.

The route shares the existing Auth-attempt IP budget30/15minutes and the global API-IP240/minute and authenticated store/account120/minute allowances. It additionally enforces10password-change attempts per15minutes for the authenticated store/account, shared across IPs, sessions and tokens. Authenticated validation failures consume this budget. On429 TOO_MANY_REQUESTS wait Retry-After; counters remain process-local. Existing forgot-password/reset-password recovery is unchanged and still requires email OTP.

The [self-contained FE response](../../../../docs/frontend/account-creation-password-change.md) documents every creation/login/change-password request and response field, sources, retention, errors and exact changed-file locations.

## Branded verification and reset emails (2026-10-31)

Verification/resend and forgot-password/reset challenges use Narmer-branded English/Arabic HTML plus plain text and the supplied inline logo. Subjects are Narmer - Confirm your email or Narmer - Reset your password, with Arabic equivalents. Sender display name is Narmer; B2B/B2C labels are removed from generated mail branding, while account/store ownership stays separate. Six-character OTPs retain leading zeroes, ten-minute expiry and existing resend/attempt rules. No email action URL or frontend/API field is added. Continue entering the code in the existing verification/reset screen. See [email delivery](../../shared/infrastructure/email/EMAIL_DELIVERY_FRONTEND.md) for the complete template, asset and verification contract.
