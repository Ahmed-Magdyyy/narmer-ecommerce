# Narmer backend foundation

This GitHub repository deliberately excludes `server/scripts/`. The published npm commands are `dev`, `start`, and `test`. Maintenance, provisioning, documentation-generation, and database-test commands mentioned below or in module contracts refer to tools retained separately in the local development checkout; those commands are not available from this repository. The backend HTTP implementation is unchanged.

B2B [Leads](src/modules/leads/LEADS_FRONTEND.md) is implemented alongside [Forms](src/modules/forms/FORMS_FRONTEND.md) and [Wholesale](src/modules/wholesale/WHOLESALE_FRONTEND.md). See [B2B flow](../docs/frontend/b2b-flow.md) for the guest/customer draft → private upload → submission → tracking journey and staff list/image/contact actions. The full local suite passed 135 tests with one opt-in database skip; the latest dedicated database result is recorded in the Leads checkpoint below.

Checkout/Orders is mounted for B2C; read the [complete frontend contract](src/modules/orders/ORDERS_FRONTEND.md). It supports guest/customer checkout, COD and manual InstaPay, private proof upload/read, safe placement retries, private guest tracking and staff fulfillment/cancellation/return. Order, stock, coupon use, proof attachment and cart clearing share a MongoDB transaction. Coupon uses remain counted after cancellation/return. No tax or payment gateway is added.

Private proof storage uses optional BUNNY_PROOF_STORAGE_ZONE and BUNNY_PROOF_ACCESS_KEY plus optional BUNNY_PROOF_STORAGE_ENDPOINT (default https://storage.bunnycdn.com). Use a separate Bunny storage zone with no public pull-zone/CDN access; do not reuse the public catalog zone. Missing configuration disables InstaPay preview/proof handling while COD remains available. Configure the receiving account through dashboard Orders settings; checkout/order snapshots preserve the account shown at quote time. This slice did not configure a live private provider or change .env.

When private storage is configured, the existing hourly cleanup timer also removes expired unattached proofs. Attached proof objects are retained. Run npm --prefix server run orders:cleanup-proofs for manual bounded cleanup; provider failures remain durable retry work. Checkout snapshots expire after 24 hours; guest tracking currently expires after 90 days. Customer emails and staff dashboard Notifications are implemented; web push and lost-link recovery remain later slices. B2B Leads/private images/tracking are implemented.

## Timed Sales

Sales is B2C-only, with five dashboard CRUD routes under `/api/v1/admin/b2c/sales`. SuperAdmin/admins manage definitions; only superAdmin deletes. Targets are selected products (all variants) or a category including all descendants. Percentage discounts use whole percentage points; fixed discounts use integer piastres. Schedules have inclusive starts and exclusive ends. Enabled overlapping scopes are rejected, including scheduled campaigns and empty category ancestry. Adjacent schedules and disabled overlapping drafts are allowed; enabling rechecks.

Public Products and Cart apply current campaigns without changing saved prices/discounts or stock. Campaigns replace saved discounts, rounding percentage reductions down and clamping fixed results to zero. Public sellable DTOs include nullable localized `activeSale` metadata; dashboard Product DTOs keep baseline pricing without that field. Expiry, disable, or deletion restores current saved pricing on subsequent reads. Catalog moves cannot introduce overlaps, and saved campaigns prevent permanent deletion of their direct product/category targets. All campaign/catalog writes share the transactional catalog guard.

See the [complete Sales frontend contract](src/modules/sales/SALES_FRONTEND.md) for every request/response field, examples, errors and retry behavior. Verification passed 84 local tests plus the separate isolated development-MongoDB integration test, with cleanup verified. Orders integrates campaign prices; B2B Wholesale is an implemented price-free inquiry flow; live providers and deployed browser behavior were not checked.

## Frontend integration handoff

Send the complete [frontend handoff folder](../docs/frontend/README.md), which gathers all module contracts, both flows, shared conventions, references and API examples. Backend module originals remain authoritative; refresh the packaged copies with `npm --prefix server run docs:frontend` and validate them with `npm --prefix server run docs:frontend:check`. The frontend developer does not need to collect documents from the backend module directories.

All implemented routes are available in the [Apidog integration artifacts](../docs/apidog/README.md). Regenerate the router-verified inventory and native JWT/REFRESH scripts with `node server/scripts/export-apidog.js` from the repository root. Generation is local only; remote import remains a separately authorized action. No runtime/backend contract was changed for the test-client setup.

Module handoffs use module-specific names such as AUTH_FRONTEND.md and ORDERS_FRONTEND.md; shared email uses EMAIL_DELIVERY_FRONTEND.md. The [detailed documentation audit](../docs/frontend/documentation-audit.md) records field-source/next-call review, the complete filename map and verification limits. Preserve this naming and update caller/overall flow documents with each contract change.

The [integration readiness checklist](../docs/frontend/integration-readiness.md) provides all 135 explicit business method/path combinations, module coverage, local configuration observations and remaining browser/provider setup checks. It is an integration index; each module handoff remains the exact field contract.

B2C [Coupons](src/modules/coupons/COUPONS_FRONTEND.md) is implemented with five dashboard CRUD routes under /api/v1/admin/b2c/coupons and POST /api/v1/b2c/cart/coupon-preview. Scopes are all eligible items, selected products/all variants, or category descendants. Active-Sale lines are excluded; optional minimum spend counts eligible merchandise only. Percentage/fixed discounts, optional global/per-checkout-phone caps, optional dates and manual enabling are supported. Preview shares Cart ownership/Origin/limiter, does not save codes or consume uses, and leaves Cart DTOs unchanged. Internal redemption is called by the Orders placement transaction. SuperAdmin deletes unused definitions; recorded uses block deletion. Saved targets protect products/categories. All 92 local tests and isolated real-MongoDB usage races/rollback passed with cleanup verified. No new dependency was added. Orders is implemented; cancellation/return intentionally keep coupon use counted.

Read the [B2C overall flow](../docs/frontend/b2c-flow.md), [B2B overall flow](../docs/frontend/b2b-flow.md), and [API conventions](../docs/frontend/api-conventions.md) first. Complete field-level contracts are inside each implemented module:

- [Auth](src/modules/auth/AUTH_FRONTEND.md) and [Users](src/modules/users/USERS_FRONTEND.md), available for both stores.
- [Forms](src/modules/forms/FORMS_FRONTEND.md), [Wholesale](src/modules/wholesale/WHOLESALE_FRONTEND.md) and [Leads](src/modules/leads/LEADS_FRONTEND.md), available for B2B. Catalog Media also supports native B2B products.
- [Notifications](src/modules/notifications/NOTIFICATIONS_FRONTEND.md), available to staff in both dashboards with separate store feeds and individual read state.
- [Categories](src/modules/categories/CATEGORIES_FRONTEND.md), [Products](src/modules/products/PRODUCTS_FRONTEND.md), [Media](src/modules/media/MEDIA_FRONTEND.md), [Shipping](src/modules/shipping/SHIPPING_FRONTEND.md), [Cart](src/modules/cart/CART_FRONTEND.md), [Sales](src/modules/sales/SALES_FRONTEND.md), [Coupons](src/modules/coupons/COUPONS_FRONTEND.md), [Orders](src/modules/orders/ORDERS_FRONTEND.md), and [Wishlist](src/modules/wishlist/WISHLIST_FRONTEND.md), available for B2C.

Use the handoffs as the exact frontend contract. Pending business behavior is clearly marked and does not supply usable API routes. Keep the two flow files and affected module handoffs updated with every module completion or contract change, as required by [AGENTS.md](../AGENTS.md).

The backend is an independent JavaScript ESM package under `server/`. It uses Express, Mongoose, express-validator, Helmet, and CORS. Auth adds jsonwebtoken, bcryptjs, Nodemailer, and express-rate-limit. Node supplies environment-file loading, watch mode, logging, and the test runner. Use Node.js 22.22 or later.

## Run locally

From the project root in PowerShell:

```powershell
npm --prefix server ci
Copy-Item server/.env.example server/.env
# Edit server/.env: MongoDB, three different random secrets, and allowed frontend origins.
npm --prefix server run dev
```

MongoDB must be running. The example URI contains no credentials. Startup initializes all implemented modules and indexes before accepting HTTP requests, including catalog guards, the initial default Shipping fee and five missing unpublished Forms; initialization preserves existing staff settings/content. Missing settings, an unavailable database, or failed initialization cause startup to fail. Transactional staff/catalog mutations, Cart merge/writes, coupon redemption, Order placement/status changes and Lead submission/contact marking require a MongoDB replica set. A standalone server returns `TRANSACTIONS_REQUIRED` for those operations. Address updates and personal notification read receipts are atomic single-document writes. Do not point local development or tests at a production database.

Generate three secrets locally, then place the values in `JWT_SECRET`, `OTP_SECRET`, and `COUPON_IDENTITY_SECRET` in `server/.env`:

```powershell
node --input-type=module -e 'import { randomBytes } from "node:crypto"; console.log(randomBytes(32).toString("hex")); console.log(randomBytes(32).toString("hex")); console.log(randomBytes(32).toString("hex"));'
```

Keep all three values private and different. Keep COUPON_IDENTITY_SECRET stable; changing it requires a migration to preserve existing keyed per-phone usage. The example file intentionally leaves them empty. SMTP credentials can be added later; email-dependent operations return 503 until configured. Use your project's sender account rather than Petyard credentials.

Run commands from the project root using the server package:

```powershell
npm --prefix server start
npm --prefix server test
```

`npm --prefix server run dev` watches backend files. `npm --prefix server start` runs without watching. Both load `server/.env` when it exists; existing process environment variables take precedence. Dependencies and the lockfile belong to `server/`. No client package exists yet.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, or `production`. |
| `HOST` | `127.0.0.1` | Bind address. Set `0.0.0.0` when your deployment requires it. |
| `PORT` | `3000` | HTTP port, from 1 to 65535. |
| `MONGODB_URI` | Required | Explicit MongoDB URI; never inferred from another project. |
| `CORS_ORIGINS` | Empty | Comma-separated exact origins, such as `https://shop.example`. No wildcards or URL paths. |
| `DEFAULT_LOCALE` | `en` | Response language fallback: `en` or `ar`. |
| `TRUST_PROXY` | `0` | Trusted reverse-proxy hop count, from 0 to 10. Configure for the actual deployment topology. |
| `JWT_SECRET` | Required | Private signing key of at least 32 bytes. Generate randomly. |
| `OTP_SECRET` | Required | Separate private OTP digest key of at least 32 bytes. |
| `COUPON_IDENTITY_SECRET` | Required | Stable separate HMAC key of at least 32 bytes; must differ from JWT/OTP keys. Preserve it across restarts/deployments; rotation requires a usage-identity migration. |
| `SMTP_HOST` | Empty | SMTP host. Leave empty to defer email configuration. |
| `SMTP_PORT` | `587` | Port 587 uses STARTTLS; port 465 uses TLS immediately. |
| `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Required when host is set | Sender credentials and From address. |

Requests without an Origin header work for server-to-server clients and command-line tools, except cookie-based refresh. Browser origins must be listed explicitly; credentialed CORS is enabled for those origins. CORS does not provide authentication or protect a route from non-browser clients. Refresh requires an explicitly configured Origin even for same-origin browser clients, preventing cross-site cookie use. SMTP certificate verification remains enabled; the mailer does not disable TLS checks or log codes.

## HTTP conventions

- `GET /health/live`: process health, independent of MongoDB readiness.
- `GET /health/ready`: returns 200 while MongoDB is connected, and 503 while disconnected or shutting down.
- Auth, profile, and customer address routes mount below `/api/v1/b2c` and `/api/v1/b2b`. Staff account and superAdmin handover routes mount below `/api/v1/admin/b2c` and `/api/v1/admin/b2b` with store-specific authorization.
- `req.context` contains the server-generated `requestId`, selected `locale`, and the `store` established by a business route mount. Client input cannot select the store. Auth and Users repository queries include this store; each future module must do the same.
- Language selection: supported `X-Language` first, then negotiated `Accept-Language`, then `DEFAULT_LOCALE`. Unsupported languages fall back. Equal preferences and wildcards prefer the configured default.
- Responses include `Content-Language`, `X-Request-Id`, and the appropriate language/cache variation headers. Request IDs are generated by the server rather than accepted from the client.

Success responses:

```json
{
  "success": true,
  "code": "LIVE",
  "message": "The server is running.",
  "data": null,
  "requestId": "server-generated-uuid"
}
```

Error responses:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Please check the submitted fields.",
  "errors": [
    { "field": "name", "location": "body", "code": "INVALID_FIELD", "message": "This field is invalid." }
  ],
  "requestId": "server-generated-uuid"
}
```

Use `sendSuccess` in controllers and `AppError` for expected failures. Add new message codes to both languages in `shared/i18n/messages.js`. Unexpected failures return a generic 500 response. Invalid JSON returns 400, oversized JSON returns 413, unsupported body encodings return 415, invalid fields return 422, and unknown routes return 404. Express handles rejected async handlers directly; no async wrapper is needed. See the [Express error-handling guide](https://expressjs.com/en/guide/error-handling/).

Module validators run before `validateRequest`. Controllers consume `req.validated.body`, `.params`, and `.query`, which contain only validated/sanitized fields. Validation errors omit submitted values. Explicitly validate individual nested fields rather than allowing an entire untrusted object. This uses express-validator's [matchedData](https://express-validator.github.io/docs/api/matched-data/) function.

## Structure and boundaries

`src/app/` composes Express, route mounts, startup, and shutdown. `src/config/` owns environment parsing and the MongoDB connection. `src/shared/` contains error handling, request context, validation, bilingual messages, responses, and logging.

Auth and Users have the agreed model, repository, routes, validator, controller, and service files under `src/modules/`. Each later resource follows the same structure. Business rules stay in services and persistence stays in repositories. Empty business modules, generic base classes, and integration placeholders are unnecessary.

## Auth and basic Users

The confirmed initial implementation uses the smaller email-based flow, SMTP, bearer access JWTs, and HttpOnly refresh cookies. Resend may replace SMTP later when requested; no second provider is added now. Petyard was read as a reference; its phone OTP, social login, guest merge, Redis, rewards, and device logic were not imported.

Use the following routes under either `/api/v1/b2c` or `/api/v1/b2b`:

| Method and path | Body / access |
| --- | --- |
| `POST /auth/register` | `name`, `email`, `phone`, `password`. Public signup always creates a customer. |
| `POST /auth/resend-otp` | `email`. |
| `POST /auth/verify-email` | `email`, six-digit string `otp`. |
| `POST /auth/login` | `email`, `password`. Requires confirmed email. |
| `POST /auth/refresh` | Refresh cookie plus configured `Origin`; no body token. |
| `POST /auth/logout` | Access JWT in `Authorization: Bearer <token>`. Revokes that session. |
| `POST /auth/forgot-password` | `email`. |
| `POST /auth/reset-password` | `email`, six-digit string `otp`, new `password`. |
| `GET /users/me` | Access JWT. |
| `PATCH /users/me` | Access JWT; `name` and/or `phone` only. |

Email is trimmed and lowercased without provider-specific transformations. The same email can register independently in both stores. Name allows 1–100 characters. Phone input accepts spaces, parentheses, and hyphens, removes them, and requires 6–15 digits with an optional leading `+`; no country restriction is imposed. Passwords allow at least 8 characters and at most 72 UTF-8 bytes and are never trimmed or silently truncated. Hashing uses bcrypt with cost 12; the pure JavaScript implementation avoids native build tools. See [bcryptjs security considerations](https://github.com/dcodeIO/bcrypt.js#security-considerations).

Registration/resend/recovery return a generic eligible-account message. Repeated registration does not overwrite an existing password/profile. Resending inside the 60-second account cooldown quietly returns the same message. Sending endpoints share 10 requests per IP/store per 15 minutes; login/verification/session endpoints share 30. IP limits are in memory for one process; use a shared store if deployment adds multiple API instances. OTP attempts and resend cooldown remain Mongo-backed.

An OTP expires after 10 minutes, allows five attempts, is purpose/store/account-bound, and is stored as a keyed digest. Correct codes are consumed through a conditional database write. Mongo TTL indexes clean up expired records; authorization always checks expiry itself. Verification and account update are separate writes: if the account update fails after consuming a code, request a new code. No token is issued until login succeeds against current verified state.

Login returns `{ user, accessToken, expiresIn }` in `data`. The access JWT lasts 15 minutes. The opaque refresh token is stored in the host-only `narmer_refresh_b2c` or `narmer_refresh_b2b` cookie, with HttpOnly, SameSite=Lax, a store-specific Auth path, and Secure in production. Keep the access JWT in frontend memory; use `credentials: 'include'` for login/refresh/logout. Refresh rotates the stored token digest atomically and preserves the original seven-day session expiry. The frontend must serialize refresh requests: a reused or concurrent losing token returns 401. Replay is rejected; there is no additional device/session-family tracking.

The current cookie configuration requires frontend and API to be on the same site, such as subdomains of one domain, with HTTPS in production. Cross-site frontend hosting requires an explicit transport/cookie decision. Allowed origins must include the actual frontend origin. Command-line refresh clients must provide that configured Origin explicitly.

Every authenticated request checks the current account status, confirmed email, role, auth version, and active session. JWT role claims are not trusted. Logout revokes one session immediately; password reset and staff account mutations increment the account's auth version, invalidating all its tokens/sessions without changing the other store's account. A `superAdmin` also needs the matching authoritative store assignment. Public registration never creates privileged accounts.

## Saved addresses

Regular customer accounts (`user`) can use `GET`/`POST /users/me/addresses` and `GET`/`PATCH`/`DELETE /users/me/addresses/:addressId` under their store's public prefix. Staff accounts cannot use the address book. Addresses are embedded on the owning account and every mutation includes store, owner, active status, and customer role in its database filter.

Required fields are `label` (up to 100 characters), `governorate` (100), `building` (200), and `street` (200). Optional fields are `district` (100), `floor` (50), `apartment` (50), `details` (1000), and `contactPhone`. Building/floor/apartment identifiers are strings, so `12A` and `Ground` work. Labels are free text. Names and addresses remain in the language entered.

Omitting `contactPhone`, or sending null/blank to clear it, uses the current account phone. Responses include the explicit `contactPhone` and derived `effectiveContactPhone`; updating the profile phone changes this fallback. Orders will copy their own address/phone snapshots when implemented. Guest checkout will accept an address directly.

## Staff accounts and superAdmin setup

Use these routes under `/api/v1/admin/b2c` or `/api/v1/admin/b2b`, with a bearer access token from the matching store:

| Method and path | Permission / input |
| --- | --- |
| `GET /users` | SuperAdmin/admin. Optional `page` (1–100000), `limit` (1–100), `role`, `status`. Defaults: page 1, limit 20; deleted accounts excluded unless requested. |
| `GET /users/:userId` | SuperAdmin/admin. Safe account details, including role/status; no addresses or auth secrets. |
| `PATCH /users/:userId` | SuperAdmin/admin. `name`, `phone`, role `admin`/`moderator`/`user`, status `active`/`blocked`. |
| `DELETE /users/:userId` | SuperAdmin only. Soft deletion keeps account ID/history and reserves email in that store. |
| `POST /auth/super-admin/handover` | Current superAdmin only. Body `{ "userId": "replacement-account-id" }`. |

Moderators and customers have no dashboard account-management access. Admins cannot delete through either DELETE or a crafted PATCH status. Deleted accounts cannot be restored through these APIs. The current superAdmin cannot be edited, demoted, blocked, or deleted through generic staff account routes; its holder can edit name/phone through `/users/me`. Account changes and a small audit record commit in the same transaction; audit records keep IDs, action, field names, role/status changes, and handover holder IDs without duplicating passwords, tokens, or contact details.

For the first superAdmin, register and confirm the intended account through normal Auth, then run this command separately for each store:

```powershell
npm --prefix server run provision:super-admin -- --store b2c --email owner@example.com
npm --prefix server run provision:super-admin -- --store b2b --email owner@example.com
```

This command uses the explicit `server/.env` database and must be run only against the intended environment. It creates no default password, requires an active confirmed account, and refuses to replace an existing store assignment. Log in again after promotion. Subsequent replacement requires the handover API: the replacement must be a different active, confirmed same-store account; the former holder becomes admin. Both accounts must log in again because their existing sessions are invalidated. Assignment, both roles, and audit change atomically; competing handovers cannot both succeed. Emergency recovery and email changes remain outside this slice. No public account deletion route exists.

JSON requests are limited to 100 KB; future image uploads will use their own confirmed limits and upload flow. Logs contain request IDs, HTTP methods, route patterns, status codes, duration, and selected lifecycle events. They omit bodies, query strings, headers, raw exception messages/stacks, and MongoDB URIs. Deployment logging and retention remain deployment decisions.

HTTP request and header timeouts are 30 and 15 seconds. Shutdown stops accepting connections, drains active requests, and disconnects MongoDB. It has a 10-second deadline; failure exits with a nonzero code. SIGINT/SIGTERM shut down normally. Unexpected fatal process errors initiate shutdown with a nonzero exit code.

## B2C categories

Categories use one model and the required six module layers. The hierarchy has up to three levels; changing a parent validates the whole subtree so a move cannot create a cycle, exceed the depth limit, or reference a missing parent. B2B has no category routes.

| Method and path | Access / behavior |
| --- | --- |
| `GET /api/v1/b2c/categories` | Public nested tree, ordered by position then ID. Only effectively active branches are returned. |
| `GET /api/v1/b2c/categories/:categoryId` | Public category; hidden categories return 404. |
| `GET /api/v1/admin/b2c/categories` | SuperAdmin/admin. Flat paginated list; optional `page`, `limit`, `parentId` (`root` or an ID), `isActive` (`true`/`false`). Defaults and paging limits match Users. |
| `GET /api/v1/admin/b2c/categories/tree` | SuperAdmin/admin. Complete nested tree, including inactive categories. |
| `GET /api/v1/admin/b2c/categories/:categoryId` | SuperAdmin/admin. Full bilingual content. |
| `POST /api/v1/admin/b2c/categories` | SuperAdmin/admin. Create a category. |
| `PATCH /api/v1/admin/b2c/categories/:categoryId` | SuperAdmin/admin. Edit content, parent, position, or active state. |
| `DELETE /api/v1/admin/b2c/categories/:categoryId` | SuperAdmin only. Delete an empty leaf; never cascade. |

Example create body:

```json
{
  "name": { "ar": "ملابس", "en": "Clothing" },
  "description": { "ar": "", "en": "" },
  "slug": "clothing",
  "parentId": null,
  "position": 0,
  "isActive": true
}
```

Both names are required, with a 150-character limit each. Descriptions are optional, with a 2000-character limit per language. Slugs are unique within B2C, up to 150 characters, using lowercase Latin letters, digits, and single separating hyphens. Position is an integer from 0 to 100000, defaulting to zero; `isActive` is a JSON boolean, defaulting to true. Omitting `parentId` creates a root; PATCH with null moves a category to the root. Partial language updates preserve the other translation. Public responses resolve names to the request language and fall back to the other language for an empty description. Dashboard responses contain both languages.

An inactive parent hides its descendants without changing their individual active states. Deletion is blocked by any direct child, including inactive children. Changes and a small actor/action/field-name audit record commit in one transaction. Every mutation first writes one shared B2C tree revision document, serializing structural changes across API processes to prevent racing moves or parent deletion/child creation from leaving an invalid tree. A replica set is required, as for staff mutations.

Products now supplies the real category-deletion blocker, including inactive products. Product mutations acquire the same tree guard through the Categories service in the same transaction, preventing category deletion from racing with assignment. Public product visibility honors all category ancestors. Category images use the Bunny upload flow below; arbitrary client URLs and a B2B catalog are not accepted.

## B2C products

Prices use EGP integer piastres: `25000` means EGP 250.00. All prices and stock values must be integers from 0 to 1000000000. No tax is calculated. An optional `discountedPrice` must be lower than the normal price; null removes it. Public effective prices include active timed Sales; dashboard prices remain saved values. Sales replaces the saved discount while active and never rewrites normal prices. Coupons discounts are calculated separately through Cart coupon-preview, not public Product prices.

| Method and path | Access / behavior |
| --- | --- |
| `GET /api/v1/b2c/products` | Public, paginated active products in effectively active categories. |
| `GET /api/v1/b2c/products/:productId` | Public localized details; hidden products return 404. |
| `GET /api/v1/admin/b2c/products` | SuperAdmin/admin, including inactive products. |
| `GET /api/v1/admin/b2c/products/:productId` | SuperAdmin/admin, full bilingual content and edit version. |
| `POST /api/v1/admin/b2c/products` | SuperAdmin/admin. Create a simple or variant product. |
| `PATCH /api/v1/admin/b2c/products/:productId` | SuperAdmin/admin; current `version` required. |
| `DELETE /api/v1/admin/b2c/products/:productId` | SuperAdmin only; permanent deletion when unreferenced. |

Lists accept optional `page`, `limit`, `categoryId`, and `type` (`simple`/`variant`). Dashboard lists additionally honor `isActive`; public requests always require effective visibility. Defaults are page 1 and limit 20, with the same paging bounds as Users. A category filter includes its descendants. Results sort by newest creation, then ID.

Simple product example:

```json
{
  "type": "simple",
  "categoryId": "existing-b2c-category-id",
  "name": { "ar": "قميص", "en": "Shirt" },
  "slug": "shirt",
  "sku": "SHIRT-1",
  "price": 25000,
  "discountedPrice": 20000,
  "stock": 10
}
```

Both names are required (200 characters each); descriptions are optional (10000 each). Slug validation/uniqueness follows Categories within the separate Product collection. `isActive` defaults to true, stock defaults to zero, and SKU is optional. Blank/null SKU clears it. Supplied SKUs are trimmed and uppercased, support letters, digits, dots, underscores, slashes and hyphens, and are unique across all B2C simple products and variants, including inactive ones. No automatic SKU is invented. Internal `skuKeys` is derived from the actual SKU fields, and a partial unique multikey index enforces the shared namespace; it is never trusted from request input or returned in API responses.

Variant products contain `options` and `variants` instead of parent SKU/price/stock. An option has a stable `key`, bilingual `name`, and `values` containing stable keys and bilingual names. Each variant supplies `values`, such as `{ "size": "small", "color": "red" }`, plus its price, optional discount/SKU, and stock. Every variant must select exactly one defined value for every option; duplicate combinations or supplied SKUs are rejected. Technical limits are five options, fifty values per option, and one hundred variants per product. The system does not generate every possible combination.

Variants are embedded in one Product document with server-generated stable IDs. A PATCH replacing the variants list must send the existing `id` for retained variants; omit `id` only for new ones. Supplied IDs must already belong to the product. Every submitted variant needs its price and complete option selections; omitted stock/SKU/discount on a retained variant keeps its existing value. New variants default stock to zero. A metadata-only update preserves all existing variants. Option edits must remain consistent with the resulting variants. Product type cannot change after creation.

Read the latest dashboard version before editing, then send `{ "version": 0, "stock": 12 }`, for example. A successful update increments version; stale edits return `PRODUCT_CONFLICT` rather than overwriting newer prices/stock. Future order stock writes must increment this version too. Product changes and actor/action/field-name audit records commit in one transaction; audit failure rolls back the change. Unreferenced permanent deletion releases SKU/slug uniqueness. Deactivation remains available to admins.

Live Cart references block deleting products or selected variants. Every saved product-targeted Sale blocks product deletion; direct category Sale references block category deletion, including expired/disabled definitions. Removing variants is unaffected by Sale references alone. Catalog mutations and reference writes share the transactional catalog guard. Historical Orders and saved Wishlist references also block permanent product deletion; Wishlist does not select variants. Saved B2B Wholesale offers, including disabled ones, protect source products/composed variants. Historical Leads protect their selected offers.

## Bunny catalog images

Images use Bunny Storage and a public Pull Zone. Configure `BUNNY_PUBLIC_STORAGE_ZONE`, `BUNNY_PUBLIC_ACCESS_KEY`, `BUNNY_PUBLIC_STORAGE_ENDPOINT`, and `BUNNY_PUBLIC_CDN_ORIGIN` using `.env.example`. The key is the storage-zone password, not the account-wide Bunny API key. The endpoint must match the zone's primary region; it defaults to `https://storage.bunnycdn.com`. The CDN setting is an exact HTTPS origin without a trailing slash or path, such as `https://your-zone.b-cdn.net`. Partial credentials fail startup; leaving the storage settings empty keeps other modules available, with uploads returning `MEDIA_UNAVAILABLE`.

Use Narmer's own storage/pull zone. Petyard is a code reference; its credentials, storage records, and objects are never reused. The adapter uses native `fetch`, a 15-second timeout, blocked redirects, server-generated paths under `narmer/b2c/catalog`, and a SHA-256 checksum. Storage-zone credentials never appear in API responses or persisted image records. See [Bunny's HTTP storage documentation](https://bunny.net/docs/storage/http).

Create the product or category first, then upload one file per request:

| Method and path | Access / body |
| --- | --- |
| `POST /api/v1/admin/b2c/media/product/:targetId` | B2C superAdmin/admin; existing product ID; raw image bytes. |
| `POST /api/v1/admin/b2c/media/category/:targetId` | B2C superAdmin/admin; existing category ID; raw image bytes. |

Send the access JWT in `Authorization` and the actual file type in `Content-Type`: `image/jpeg`, `image/png`, or `image/webp`. The body is the File/Blob itself, not multipart FormData or base64 JSON. A browser upload can use:

```js
const response = await fetch(`/api/v1/admin/b2c/media/product/${productId}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': file.type },
  body: file,
});
const { data: image } = await response.json();
```

Only real, non-animated JPEG/PNG/WebP files are accepted, at most 5 MB and 20 million decoded pixels. Sharp checks the actual format, decodes/re-encodes the content, strips metadata, respects orientation, resizes within 1600 × 1600 without enlargement, and saves WebP at quality 82. SVG, GIF, arbitrary files, corrupt content, MIME mismatches, and compressed request bodies are rejected. Uploads have an IP limit of 60 per 15 minutes per process. Moderators, customer accounts, guests, and B2B accounts cannot use these routes.

The upload response contains `{ id, url, width, height }`. Uploading does not attach the image. Within 24 hours, PATCH the product with its current `version` and ordered `imageIds`, or PATCH the category with `imageId`. Products support up to ten images in their gallery and ten per variant. The first image is the main image. Omitting the image field preserves existing images; an empty product/variant list or null category `imageId` clears them. Duplicate IDs within a list are rejected. Arbitrary `images`, URLs, storage paths, and dimensions from the client are ignored. IDs must refer to completed uploads bound to that exact B2C product/category; they cannot be reused across products or between products and categories.

```json
{ "version": 0, "imageIds": ["uploaded-image-id"] }
```

For variant images, submit `imageIds` inside each affected variant when replacing the full variants list, retaining its `id`, price, and option selections as described above. An omitted variant image list preserves its images. An image belonging to the same product can be used by multiple variants and the product gallery. Dashboard variant `images` contains only its own saved images; public variant `images` falls back to the product gallery when that variant has none. Product/category responses return server-created image references. Existing records without image fields read as an empty gallery or null category image.

Image attachment/retirement, catalog writes, and catalog audits share one MongoDB transaction. A failed save or stale product version leaves current images intact. Removing a shared image from only one list does not delete it while another variant/gallery still uses it. Replacing images or deleting an item first saves `deletePending` obligations, then attempts one cleanup batch after commit. Provider failures do not undo a successful catalog change.

Every upload saves its record before contacting Bunny, so a timeout or crash leaves an identifiable cleanup obligation. Unattached/unfinished uploads expire after 24 hours; attached images do not expire and have no TTL deletion. A cleanup sweep runs hourly while the configured API is running, without overlapping sweeps in one process. It handles up to 25 batches of 50 records, using at most five concurrent deletions, and stops on failure/no progress. Larger backlogs continue in a later sweep. The timer stops on shutdown; interrupted obligations remain in MongoDB. Run `npm --prefix server run media:cleanup` for an immediate sweep or while the API is stopped. That command performs real storage deletions using the configured database and zone, so use the intended environment. Successful deletions and storage 404s remove the pending record; failed cleanup remains retryable. Changing the storage zone/endpoint fails cleanup closed rather than deleting from a different zone.

These are public catalog images. Storage deletion does not purge cached CDN copies; delivery follows the Pull Zone's cache settings. Private InstaPay proofs and B2B submission images require their own authorization/lifecycle integration later and cannot be uploaded through these public routes. Live Bunny upload/CDN delivery has not been checked; tests use a fake storage adapter.

## B2C shipping fees

Shipping owns governorate overrides and one separate default-fee setting. Amounts are EGP integer piastres, from 0 to 1000000000; `6000` means EGP 60. Zero is valid for either an override or the default. The user approved EGP 50 (`5000` piastres) as the initial default. Startup inserts it only when the setting is missing and preserves any amount already saved by staff. SuperAdmin/admins can edit it through the dashboard API. If settings are unexpectedly absent after startup, quotes needing a fallback return `SHIPPING_NOT_CONFIGURED` rather than silently charging zero.

| Method and path | Access / behavior |
| --- | --- |
| `GET /api/v1/b2c/shipping-fees` | Public, localized paginated overrides and default configuration status. |
| `GET /api/v1/b2c/shipping-fees/quote?governorateCode=cairo` | Public, current override or default fee. |
| `GET /api/v1/admin/b2c/shipping-fees` | SuperAdmin/admin, bilingual paginated overrides and default status. |
| `GET /api/v1/admin/b2c/shipping-fees/default` | SuperAdmin/admin; returns `configured`, `defaultFee`, and currency. |
| `PATCH /api/v1/admin/b2c/shipping-fees/default` | SuperAdmin/admin; sets or replaces the required default. |
| `POST /api/v1/admin/b2c/shipping-fees` | SuperAdmin/admin; creates one governorate override. |
| `GET /api/v1/admin/b2c/shipping-fees/:feeId` | SuperAdmin/admin; retrieves one override. |
| `PATCH /api/v1/admin/b2c/shipping-fees/:feeId` | SuperAdmin/admin; edits the fee and/or name translations. |
| `DELETE /api/v1/admin/b2c/shipping-fees/:feeId` | SuperAdmin/admin; permanently removes an override, as explicitly agreed. |

The approved initial default is `{ "defaultFee": 5000 }`. Use the default PATCH endpoint to change it. Create an override with:

```json
{
  "governorateCode": "cairo",
  "name": { "ar": "القاهرة", "en": "Cairo" },
  "fee": 6000
}
```

The stable governorate code is trimmed/lowercased, at most 100 characters, with ASCII letters/digits and single separating hyphens. A unique `(store, governorateCode)` index prevents duplicate overrides. The code is immutable after creation; edit the translated names or fee instead. Names are required in both languages at creation, up to 150 characters each. Partial translation edits preserve the other name. An empty PATCH is rejected. Currency/store/IDs/audit fields are server-owned. Moderators, regular users, and B2B credentials cannot manage these settings. This admin DELETE permission applies only to shipping overrides; it does not widen product/category/account deletion rights.

Lists accept `page` (1–100000) and `limit` (1–100), defaulting to 1/20, and sort by governorate code. A quote returns the code, current fee, currency, `source` (`override` or `default`), and the override's ID/name when one exists. Fallback quotes return null ID/name because a governorate without an override has no Shipping record. The frontend supplies the user's selected governorate code; an Arabic/English display label is not a code. Valid checkout selections must not be limited to governorates with override records. Saved-address APIs currently preserve the governorate field; new frontend selections should store the stable code there. Existing stored labels are not rewritten by this slice and must be resolved by the selection flow when Orders is implemented.

There is no default DELETE/clear API, and null/negative/fractional/string amounts are rejected. Deleting an override preserves saved addresses and makes subsequent quotes use the default. Changes and actor/action/field-name audits commit in one transaction. Concurrent duplicate override creation returns a clear conflict; concurrent first-time default setup preserves one singleton and may return `SHIPPING_CONFLICT` for a competing request. Ordinary edits use the last successfully committed value.

Orders is not implemented yet. Its checkout must call `Shipping.resolve(store, governorateCode, { session })` using the checkout transaction, ignore client fee/total values, charge shipping once, and snapshot the result on the order. Quotes are previews, not locked checkout prices. Future order snapshots must survive later edits/deletion. District rates, delivery carriers, weight-based charges, free-shipping thresholds, taxes, and order creation are outside this slice.

## B2C Cart

Cart routes serve guests and ordinary B2C customer accounts. Staff cannot use them, and B2B/dashboard cart routes do not exist. Product prices, visibility, variant choices, and stock come from Products; a cart stores only selections and quantities and never reserves or deducts stock.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/b2c/cart` | Get the caller's current cart and an ownership cookie for guests. Creates the database record when missing for either a guest or customer and returns the complete Cart DTO, with empty items/zero totals for a new cart. |
| `PUT /api/v1/b2c/cart/items` | Set the absolute quantity of one product/variant. Zero removes that selection. |
| `DELETE /api/v1/b2c/cart` | Clear the caller's cart. |
| `POST /api/v1/b2c/cart/merge` | Merge the guest cookie's cart into the authenticated customer's cart; call after sign-in. |

Simple-product request:

```json
{ "productId": "<product ObjectId>", "quantity": 2 }
```

Variant-product request:

```json
{ "productId": "<product ObjectId>", "variantId": "<variant ObjectId>", "quantity": 2 }
```

Product/variant IDs are 24-character hexadecimal IDs. A simple product accepts no variant; a variant product requires one of its current variant IDs. Quantity must be a JSON integer from 0 to 10000. Repeating a PUT sets the same quantity rather than adding again. Each cart permits at most 100 different product/variant selections. All supplied owner IDs, prices, totals, store selectors, and other unvalidated fields are ignored. A hidden/missing product, invalid variant, or requested quantity above current stock is rejected without modifying the cart. Cart quantities never grant a stock reservation.

Registered customers send their access JWT in the Authorization header. Guests send the server-issued `narmer_cart_b2c` cookie with `credentials: 'include'` in browser requests. It is HttpOnly, SameSite=Lax, Secure in production, and scoped to `/api/v1/b2c/cart`; only a SHA-256 digest of its random token is stored. Account carts have no expiry. Guest retention starts at cart creation or reset, and each successful item write sets expiresAt to 30 days after that write. GET of an existing unexpired cart preserves its expiry and version. An expired guest cart is reset to empty with a fresh 30-day expiry, without restoring its old selections. Account carts have no expiry. MongoDB TTL provides physical cleanup and logical expiry is immediate. GET uses a transaction to find/create/reset, while existing live reads preserve stored items. The browser cookie is renewed on guest GET. Merge after sign-in is also confirmed; the frontend must call the merge endpoint after login as described below.

Guest writes and every merge must supply an Origin exactly present in `CORS_ORIGINS`, even for same-origin requests. Invalid bearer credentials never fall back to a guest cart. Supplying an access token selects the account cart; the guest cookie is used only by the explicit merge endpoint. The frontend calls merge after login and keeps both credentials until it succeeds. Successful merge adds matching quantities, validates all resulting selections and stock, commits both cart changes together, and clears the guest cookie. A stock/availability/limit failure preserves both carts and the cookie; adjust guest items without the Authorization header and retry. Repeated successful merge requests with the old cookie do not duplicate quantities. There is no implicit merge during Auth login, registration, or refresh.

Responses include `items`, total quantity `itemCount`, item-only `subtotal`, `currency: "EGP"`, and `canCheckout`. Each item includes product/variant IDs, quantity, localized name, slug, images, variant values where applicable, SKU, regular/discounted/effective unit prices, stock, line total, and status (`available`, `insufficient_stock`, or `unavailable`). Variant images use the existing product fallback. Price changes appear on the next read; carts do not save stale prices. Missing/hidden items remain removable and show null names/prices and no images. Subtotal is null if any line cannot be priced, and `canCheckout` is false for empty or invalid carts. Insufficient-stock lines keep their quantities and current calculated prices while reporting that checkout is unavailable.

The subtotal includes active timed Sales, but does not include shipping or Coupons yet. `canCheckout` is only a current preview; Orders must independently revalidate everything and deduct stock in the order-placement transaction. Cart GET and writes require a MongoDB replica set and share the existing catalog guard with Products, so concurrent adds, deletion, and variant removal cannot leave active dangling references. Non-expiring account carts and unexpired guest carts block referenced product/variant removal; clear the corresponding cart or use catalog deactivation. Logically expired guest carts do not block deletion. Cart reads do not expose owner keys or grant access through a supplied cart ID.

Cart routes share an IP limit of 150 requests per 15 minutes. Like the existing Auth limiter, this store is per process; use a shared limiter when running multiple API instances. There are no new dependencies, guest accounts, payment integrations, saved checkout totals, or cart notification jobs.

## Verification and scope

Tests use Node's built-in runner and real HTTP servers on temporary loopback ports. They cover the foundation, Auth/session lifecycle, store isolation, address ownership/fallback/clearing, staff permissions, soft deletion and reserved email, singleton handover, session invalidation, category hierarchy/visibility/permissions, product prices/options/SKU/version/reference guards, image decoding/ownership/fallback/cleanup, cleanup timer/batching, shipping fallback/zero amounts/default protection/admin deletion, audit-failure rollback, model indexes, and repository write conditions. Default tests mock database writes, transactions, SMTP, and Bunny requests; they do not prove real provider/database behavior.

For real MongoDB checks, explicitly opt in against a local or dedicated test server:

```powershell
$env:NARMER_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/?replicaSet=rs0'
npm --prefix server test
Remove-Item Env:NARMER_TEST_MONGODB_URI
```

Use an already configured disposable replica set. That test creates a uniquely named `narmer_test_<24 hex characters>` database and verifies identity uniqueness, concurrent OTP/refresh/address writes, concurrent provisioning/handover, transaction rollback on audit failure, soft deletion, racing category moves/deletion/creation, product SKU indexes/version conflicts, and product/category assignment races. The 36-byte database name also fits hosted servers with a 38-byte limit. Cleanup removes only that test database's collections after asserting its exact name, then verifies no collections remain; it does not require the separate `dropDatabase` permission. It never reads `MONGODB_URI`. Without the explicit test variable it is skipped. Do not configure this against production.

When explicitly authorized to use the configured development server, run `npm --prefix server run test:db:development`. This loads `.env`, refuses `NODE_ENV=production`, and passes its connection to the same isolated-database test. Test signing/OTP keys and mocked email delivery are independent of the app's `.env` secrets. The runner prints only safe test summaries, omitting raw MongoDB driver errors and connection details. It never changes the configured application's records.

Real MongoDB integration passed against the authorized development server using a disposable database, including media attachment/audit rollback, target isolation, expiry rejection, and durable cleanup records with Bunny mocked. Shipping checks verified concurrent singleton default setup, unique governorate overrides, partial translations, audit rollback, admin deletion, fallback pricing, and preservation of saved addresses. Cart checks verified concurrent item writes and idempotent merge, rollback after failed source deletion, stock revalidation, owner uniqueness, TTL/logical expiry, and cart-write races against product deletion and variant removal. Cleanup verified that no test collections remained. The default suite passed 75 tests, and syntax checks passed for 94 JavaScript files. SMTP delivery and live Bunny/CDN behavior remain unverified. Checkout/proof/tracking limits and private payment uploads are implemented in Orders; B2B Leads/private uploads/tracking are implemented; customer emails and staff dashboard Notifications are implemented; web push remains deferred. Remaining business decisions will be made when the relevant module is reached, as recorded in [the architecture document](../docs/architecture.md).

### Latest Checkout/Orders verification

The email-slice local regression suite passed 143 tests with two opt-in MongoDB tests skipped. The separate MongoDB run also verified Cart/Wishlist integrity and Forms initialization, preserved definitions, version contention and audit rollback. The separately authorized development MongoDB run passed in an asserted disposable database and verified that all test collections were removed. It covered competing stock placements, unique checkout replay, cancellation/shipping races, coupon rollback and retained uses, variant restoration, settings audits and private proof attachment/read, with Bunny mocked. Current syntax checks covered 172 JavaScript files. Documentation checks covered 20 files, 215 local links and 82 fenced JSON examples; all 11 Leads routes match its handoff and each other module retains its route inventory, alongside two health routes. The complete Orders preview/customer-placement examples and staff additions match actual DTO keys/types and monetary calculations. Independent source review found the signing-key replay issue, which was corrected and covered by a regression test. Live SMTP delivery, private Bunny provider privacy/CDN access and deployed browser/TLS behavior remain unverified. Customer emails and staff dashboard Notifications are implemented; web push and lost-link recovery remain deferred. Forms, Wholesale and Leads are implemented.

## B2C Wishlist

The six-layer [Wishlist module](src/modules/wishlist/WISHLIST_FRONTEND.md) serves authenticated B2C customer accounts only. It saves products once, with a technical cap of 100 entries per account. GET returns the full items/itemCount DTO, including an empty result without creating a record. PUT /api/v1/b2c/wishlist/items/:productId adds a visible product, DELETE on that path removes it, and DELETE /api/v1/b2c/wishlist clears the list. All four operations return HTTP 200 and the complete current list. No body, owner selector, guest cookie, selected variant or quantity is accepted.

Current public product data uses the existing Products batch service, including Sales prices, stock, localized labels and variant-image fallback. Hidden/missing products return null without exposing catalog data; they remain removable and count toward the cap. Writes use MongoDB transactions and the existing catalog guard, with unique store/user ownership and addToSet duplicate protection. Saved references block permanent product deletion; variant removal still depends on actual Cart/Order references. No new package was installed.

Wishlist verification passed five focused service/HTTP tests, the full local suite (112 passed, one opt-in database skip), and the separate authorized real-MongoDB integration test. The disposable database cleanup was verified. Live CDN and deployed browser behavior remain unverified.

## B2B Forms

Forms implements the required six layers plus shared server-owned definitions. Its five built-in types (spinning, weaving, fabric, school-uniforms, wholesale) are initialized unpublished with empty configurable fields and version 0. Startup initializes unique store/type ownership and inserts only missing definitions, preserving staff configuration on restart. Guests read active localized definitions through GET /api/v1/b2b/forms and /:formType. B2B superAdmin/admins list/read all definitions and PATCH /api/v1/admin/b2b/forms/:formType with a current version. Moderators/customers cannot access the editor, and B2C has no Forms endpoint.

Fixed name/phone/optional-email/governorate/district definitions cannot be edited. Configurable types are text, textarea, number, select, multiselect and boolean, bounded to 40 fields/50 choices per choice field. Administrators edit bilingual titles/help text, labels, choices, required flags and the complete ordered replacement fields array. Scripts, unsafe/duplicate/reserved keys, custom rules, nesting and unsupported types are rejected. Publication/retirement uses isActive; every edit increments version. Concurrent/stale saves conflict, and audit failure rolls back the definition update. Writes require MongoDB transactions.

Read the [complete Forms frontend handoff](src/modules/forms/FORMS_FRONTEND.md) for every input/output field, constraints, examples, permissions and recovery. Five focused tests and the full local suite (117 passed, one opt-in database skip) passed; the authorized isolated MongoDB integration passed initialization contention, preservation, version races and audit rollback, with cleanup verified. No dependency or environment setting was changed. Leads now implements submission, private images, snapshots and tracking; customer emails and staff dashboard Notifications are implemented; web push remains deferred. Live browser/provider behavior is unverified.

## B2B Wholesale and native products

[Wholesale](src/modules/wholesale/WHOLESALE_FRONTEND.md) owns simple B2B-only products and pouch offers referencing either native products or visible B2C simple/variant products. Native records have bilingual content, images, availability and versions; no inventory/prices/categories/variants/SKUs. Pouches have immutable sourceStore/productId, bilingual display content and fixed composition with derived piecesPerPouch. A reused variant product can mix sizes/colors. Native products default active; offers default unpublished. Public offers expose no prices/stock, and zero retail stock does not block an inquiry.

Fourteen Wholesale routes cover public offer reads and dashboard B2C selection/native product/offer CRUD. B2B superAdmin/admins manage records; only superAdmin deletes unreferenced ones. Native sources and composed B2C variants are protected by saved offer references, including disabled offers. Writes/version/audit/attachment are transactional, using consistent B2C-then-B2B catalog locking where needed. Initializer creates the B2B guard and indexes without inventing catalog products/offers.

Native images use POST /api/v1/admin/b2b/media/product/:targetId and the existing Sharp/Bunny processing and durable cleanup. Store/target ownership prevents B2C/B2B attachment mixing; referenced B2C images remain read-only to B2B staff. Both main frontend guides and the Wholesale/Media/Products/Forms handoffs describe the exact contracts. Leads implements whole-number requested pouch quantities, snapshots, private uploads/tracking and offline contacted state. No checkout, payment, stock deduction or new dependency was added.

Wholesale verification passed six focused tests, the affected Media HTTP test, all 123 local regression tests (one opt-in database skip), and the separate isolated MongoDB test with verified cleanup. Database proof included both source deletion races, version/audit rollback, literal search and native-image ownership/cleanup. Live Bunny/CDN and deployed browser behavior were not tested.

## B2B Leads

[Leads](src/modules/leads/LEADS_FRONTEND.md) owns secret-authorized 24-hour drafts, optional private images, guest/customer form submission, 90-day guest tracking, authenticated customer history and staff contact marking. The eleven mounted routes are fully described in its handoff and [B2B flow](../docs/frontend/b2b-flow.md). Submission validates the displayed Forms/Wholesale versions and snapshots questionnaire/contact/answers/offer composition before completing the draft transaction. Matching retries return the original submission without duplicating it; guest replay access ends with the original tracking expiry. Historical selected offers cannot be permanently deleted.

Up to five JPEG/PNG/WebP images, each at most 5 MiB, use existing Sharp and the shared private Bunny transport. The existing BUNNY_PROOF_STORAGE_ZONE/ACCESS_KEY/ENDPOINT variables configure both Order proofs and Lead images, with separately constrained object paths. A safe Boolean configuration check confirmed private storage is currently unset. Without it, image routes return 503 LEAD_STORAGE_UNAVAILABLE; image-free submissions work. Public catalog Bunny storage cannot serve these sensitive images. Only B2B superAdmin/admin/moderator can fetch attached private bytes; guest/customer DTOs expose only imageCount.

Provider uploads occur outside transactions with durable metadata prepared first. The existing hourly cleanup timer also drains Lead images when private storage is configured. Run npm --prefix server run leads:cleanup-images for a manual bounded sweep (up to 25 batches of 50 records, stopping on provider failure/no progress). Ready unused images retire on successful submission; in-flight uploads retire only after provider completion, while abandoned/failed images use their own 24-hour cleanup deadline. Attached images and submitted Leads have no TTL. There is no Lead or draft-image DELETE API. Email/web push and lost-link recovery remain deferred.

Final verification: 135 local tests passed with one opt-in database skip; ten focused Leads service/HTTP/private-transport tests passed. The separate authorized development MongoDB suite passed and verified that all disposable test collections were removed. Real database checks cover one-Lead concurrent replay, rollback, image capacity/attachment/retention, contacted audit idempotency and wholesale snapshot/reference guards. A stale calendar date in an older campaign test was replaced with run-relative dates before the successful database rerun. All 165 JavaScript files passed syntax checks, and complete Leads receipt/wholesale examples matched actual DTO keys/types. Independent privacy/concurrency review found no confirmed actionable defect. Live private Bunny zone privacy/credentials, SMTP and deployed browser/TLS behavior remain unverified.

## Customer email notifications

[Internal email delivery](src/shared/infrastructure/email/EMAIL_DELIVERY_FRONTEND.md) reuses SMTP for B2C placement/actual status changes and B2B submitted/contacted events when contact.email is present. Set B2C_TRACKING_URL_TEMPLATE and/or B2B_TRACKING_URL_TEMPLATE to the actual frontend tracking routes; each has one {id} and one {token}, and the token must be in the URL fragment. For example, a frontend supporting both guest and authenticated reads could use https://shop.example/orders/{id}#token={token}. Synthetic examples are not deployed routes. Production requires HTTPS and a static origin.

SMTP is currently configured, but both template flags are unset and customer-email delivery is disabled. No real .env secret/setting was changed and no live email was sent. Disabled stores and optional-email omissions create no jobs; enabling later does not backfill previous events. The initial Order/Lead language and immutable entered contact email determine notification language/recipient.

The EmailDelivery queue is shared infrastructure, not a new resource API. Existing six-layer Orders/Leads retain their business responsibilities and DTOs. Job insertion is in the business transaction; later SMTP errors do not undo success. The enabled worker runs every minute, drains up to 20 jobs, coordinates two-minute database leases, and retries failed attempts after 1/2/4/8 minutes up to five claimed attempts. Records are retained without TTL. SMTP acknowledgments cannot guarantee exactly-once delivery or inbox receipt; queued events may arrive late/out of order.

For a bounded manual drain use npm --prefix server run notifications:deliver. Explicitly retry permanently failed jobs with npm --prefix server run notifications:deliver -- --retry-failed; this resets failed jobs for currently enabled stores, then drains up to 20. It does not requeue skipped/sent jobs or disabled-period events. Configure the frontend links before enabling SMTP customer delivery. Provider failure logs contain selected delivery IDs/codes, not recipients/bodies/tokens/credentials.

Run npm --prefix server run test:db:emails for the dedicated authorized-development email integrity test in an asserted disposable database. It uses real queue/Order/Lead repositories/transactions and controlled catalog collaborators, with SMTP mocked. Email-slice verification: 143 local tests passed, two opt-in database tests skipped; the dedicated real MongoDB email test passed and verified removal of its test collections. Tests cover transactional rollback with stock/cart effects, replay/transition deduplication, original locale, competing workers, stale leases, retry limits and key-rotation fallback. Live SMTP inbox delivery and deployed browser/TLS tracking remain unverified. Staff dashboard Notifications are implemented; web push and lost-link recovery remain deferred.

## Staff dashboard Notifications

[Notifications](src/modules/notifications/NOTIFICATIONS_FRONTEND.md) implements new Order and Lead arrivals. The feed is shared within a store, with individual unread counts/read receipts for each current superAdmin/admin/moderator. No customer/guest feed exists. SMTP/templates and optional Lead email do not gate staff arrivals.

| Method | B2C path | B2B path |
| --- | --- | --- |
| GET | /api/v1/admin/b2c/notifications | /api/v1/admin/b2b/notifications |
| GET | /api/v1/admin/b2c/notifications/unread-count | /api/v1/admin/b2b/notifications/unread-count |
| PATCH | /api/v1/admin/b2c/notifications/:notificationId/read | /api/v1/admin/b2b/notifications/:notificationId/read |

Use store-specific staff Bearer authentication and shared language/envelope conventions. List accepts optional page (1–100000, default 1), limit (1–100, default 20), and unreadOnly (exact true/false strings, default false). Read acknowledgment takes no body and preserves the first personal read time across retries/concurrent tabs. Returned resource pointers open existing protected Order/Lead detail APIs. A read receipt neither updates fulfillment nor marks a Lead contacted.

Arrival insertion shares the Order/Lead MongoDB transaction with snapshots, stock/cart/image effects and any enabled customer email job. Insertion failure rolls back the business change. Replay, status changes and contacted updates produce no extra staff arrival. Feed data has no private contact/image/token payload. There is no expiry, backfill, delete/mark-all API, staff email or FCM in this slice. Frontends can poll while visible; no configuration or dependency was added.

Run npm --prefix server run test:db:notifications only against the authorized development connection. This alias reuses the combined inbox/email test through the existing --emails-only runner selection; test:db:emails exercises the same expanded integration. Both commands use an asserted disposable test database and mocked SMTP, then remove only their own collections and verify cleanup. Do not interpret the notifications:deliver CLI as an inbox operation: it still drains customer email jobs only.

Latest verification: 147 local tests passed, two opt-in MongoDB tests skipped; the dedicated real-MongoDB inbox/email test passed store/viewer isolation, actual aggregation, concurrent reads, Order/Lead replay and rollback, delivery leases/retries and cleanup. Browser polling, deployed CORS/TLS and live SMTP/Bunny delivery remain unverified. Web push and lost-link recovery remain pending.

## Security and initial deployment

Read the [security report](../docs/security.md) and [frontend rate/header contract](../docs/frontend/api-conventions.md). The confirmed first deployment runs one Node process: effective-IP API 240/minute, verified store/account 120/minute, normalized failed-login 10/15 minutes, and additional sensitive-route/account and existing endpoint IP budgets. Counters reset on restart; shared counters are required before scale-out. Trusted proxy topology, upstream DDoS filtering, TLS/cookies and provider-side private storage still need deployment acceptance. Auth/Users responses prohibit caching.

Run npm --prefix server run test:db:security for the opt-in real-MongoDB coupon HMAC/legacy and concurrency proof. Like the existing development DB runner, it selects an asserted disposable database, removes only its collections and verifies cleanup; it never intentionally uses the application database. No live provider calls are involved. Fresh security verification: 154 local passes, zero failures, three opt-in DB skips, plus the separate passing security DB test. No new dependency was installed.
