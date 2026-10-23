# Shipping: complete frontend handoff

Source checked: 2026-10-13. Implemented for B2C only. Read [shared API conventions](../../../../docs/frontend/api-conventions.md), [B2C flow](../../../../docs/frontend/b2c-flow.md), and [Users saved addresses](../users/USERS_FRONTEND.md). Shipping currently provides fee management and price previews. [Orders](../orders/ORDERS_FRONTEND.md) now resolves shipping during preview and placement and preserves the fee/code/source snapshot with each order.

## Purpose and permission rules

Shipping owns one editable default fee and optional governorate overrides. A governorate without an override uses the default. The confirmed initial default is EGP 50, stored as `5000` integer piastres; startup inserts it only if no default exists and never overwrites a staff edit, including zero. Amounts have no tax. Fees depend on governorate, not district, product, weight, or order quantity.

Public/guest reads need no token. Dashboard operations require a current B2C `superAdmin` or `admin` access token. Both roles can delete governorate overrides; this is the explicit exception to the usual admin deletion restriction. Moderators/customers cannot manage fees. No role can delete/clear the default through a Shipping API. There are no B2B Shipping routes.

All successes use the standard envelope, code `OK`, with HTTP 200 except override POST (201). Every JSON mutation requires application/json; dashboard calls use Bearer authentication. X-Language affects public names and all messages; dashboard names always contain both translations. Store/currency/actor come from the backend and cannot be chosen in the body.

## Every endpoint

| Method/path | Role | Request fields | Complete success `data` type |
| --- | --- | --- | --- |
| `GET /api/v1/b2c/shipping-fees` | Public | Optional page/limit query; no body | List `{items, default, pagination}` with localized item names. |
| `GET /api/v1/b2c/shipping-fees/quote` | Public | Required query governorateCode; no body | One quote, override or default. |
| `GET /api/v1/admin/b2c/shipping-fees` | superAdmin/admin | Optional page/limit query; no body | List with bilingual item names. |
| `GET /api/v1/admin/b2c/shipping-fees/default` | superAdmin/admin | No body/query/path parameters | Default settings DTO. |
| `PATCH /api/v1/admin/b2c/shipping-fees/default` | superAdmin/admin | Required JSON defaultFee | Updated default settings DTO. |
| `GET /api/v1/admin/b2c/shipping-fees/:feeId` | superAdmin/admin | Required ObjectId path feeId; no body/query | One bilingual override DTO. |
| `POST /api/v1/admin/b2c/shipping-fees` | superAdmin/admin | Create body below | Created bilingual override DTO, 201. |
| `PATCH /api/v1/admin/b2c/shipping-fees/:feeId` | superAdmin/admin | Required feeId plus partial body below | Updated bilingual override DTO. |
| `DELETE /api/v1/admin/b2c/shipping-fees/:feeId` | superAdmin/admin | Required feeId; no body/query | Null, 200. |

`/default` and `/quote` are literal routes, not fee IDs. DELETE `/default` is not implemented as a clear operation; the ID validator rejects that non-ObjectId string. Detail/edit/delete select records by `feeId` from returned `id`, while quotes select prices by stable governorateCode. These identifiers are different.

## Every request field

| Field/location | Type, required/default, validation | Meaning/source and retained state |
| --- | --- | --- |
| Path `feeId` | Required for detail/PATCH/DELETE; 24-character hexadecimal ObjectId | Backend-created override `id`. Retain after creation/list for dashboard actions. |
| List query `page` | Optional integer URL string 1–100000, default 1; coerced to number | 1-based requested page. |
| List query `limit` | Optional integer URL string 1–100, default 20; coerced to number | Page size. |
| Quote query `governorateCode` | Required string; trimmed, lowercased, 1–100 chars, pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Stable identifier from the frontend's governorate selection, e.g. cairo. Not the translated name, district, or fee ID. |
| Create/PATCH body `governorateCode` | Required at create; optional on PATCH; same normalization/constraints as quote | Unique B2C override lookup key. Omitted PATCH preserves it; a supplied normalized code must equal the existing code. A different code fails 409. Retain for governorate selection/quoting. |
| Create/PATCH body `name` | Object with recognized ar/en leaves | Human-facing governorate labels, not lookup keys. |
| `name.ar` | Required at create, optional on PATCH; trimmed string 1–150 chars | Arabic governorate label entered by staff. |
| `name.en` | Required at create, optional on PATCH; same constraints | English label. |
| Create/PATCH body `fee` | Required at create, optional on PATCH; actual JSON safe integer 0–1000000000 | This governorate's charge in EGP piastres, not pounds. No string/fraction/null/negative. |
| Default PATCH body `defaultFee` | Required actual JSON safe integer 0–1000000000 | Fallback charge for every governorate without an override. Zero is allowed. |

Unknown fields are dropped/ignored, including store, currency, IDs, actors, dates, and district. Omitted PATCH leaves preserve prior values. A single translated-name edit preserves the other language. Empty PATCH and a PATCH containing only unchanged governorateCode/unknown keys return 422 because no editable field is supplied. Including the same normalized governorateCode together with an editable field is allowed; including a different code returns 409 SHIPPING_CODE_IMMUTABLE. To change a lookup code, create the correct override and remove the old override deliberately; do not expect renaming its display label to change the key.

Lists sort ascending by governorateCode. There is no name search, district filter, configurable sort, or single public GET-by-feeId route. Supported query parameters are exactly those in the table. `?governorateCode=...` on a list does not act as a filter: use `/quote`.

## Every override response field

The same DTO is used for POST/PATCH/dashboard detail and list entries. Public list/override quote replace bilingual name with a localized string.

| Field | Type/presence/source | Meaning and frontend retention |
| --- | --- | --- |
| `id` | Always string on override DTO, generated ObjectId | Override record ID. Retain for staff get/edit/delete; not needed to quote. |
| `governorateCode` | Always normalized stable string | Stored lookup key. Keep in selected address/checkout state. |
| `name` | Dashboard: `{ar,en}` object; public: string | Stored bilingual labels or selected localized label. |
| `name.ar`, `name.en` | Strings on dashboard name only | Stored translations; use for bilingual edit forms. |
| `fee` | Always integer | Stored override charge in EGP piastres. Use null-aware logic: zero is free shipping, not missing. |
| `currency` | Always literal string EGP | Fixed backend currency. Display money consistently; not mutable. |

No store, district, version, isActive, createdAt, updatedAt, or audit fields are returned. Overrides do not have a deactivation flag; absence/deletion causes fallback. Every successful staff edit/deletion and default change commits with an audit record, but audit history is not an exposed endpoint.

## Every default and list field

Default GET/PATCH returns exactly:

```json
{ "configured": true, "defaultFee": 5000, "currency": "EGP" }
```

| Field | Type/source | Meaning/handling |
| --- | --- | --- |
| `configured` | Boolean computed from singleton existence | True if saved default exists; not whether the fee is greater than zero. |
| `defaultFee` | Integer or null | Saved default in piastres; null only if settings unexpectedly absent. Use it as staff edit value; do not interpret null as zero. |
| `currency` | Literal EGP | Currency for defaultFee. |

Normally startup sets configured true. Defensive missing-settings state is `{ "configured": false, "defaultFee": null, "currency": "EGP" }`; lists/default GET remain successful in that state, while a quote requiring missing fallback fails with 503.

List data has exactly `items` (array of override DTOs), `default` (the complete default DTO above), and `pagination` with integer page/limit/total/pages defined in shared conventions. Even if the requested page has no entries, default configuration is included. Total counts override records, not all governorates that can be delivered to. A list with no overrides after normal startup is:

```json
{
  "items": [],
  "default": { "configured": true, "defaultFee": 5000, "currency": "EGP" },
  "pagination": { "page": 1, "limit": 20, "total": 0, "pages": 0 }
}
```

## Every quote field and fallback rule

Query example: `GET /api/v1/b2c/shipping-fees/quote?governorateCode=CAIRO&unused=ignored`. The governorate code is normalized to cairo before lookup. An override quote with English localization has exactly this `data` payload:

```json
{
  "id": "507f1f77bcf86cd799439031",
  "governorateCode": "cairo",
  "name": "Cairo",
  "fee": 6000,
  "currency": "EGP",
  "source": "override"
}
```

Fallback quote has exactly:

```json
{
  "id": null,
  "governorateCode": "giza",
  "name": null,
  "fee": 5000,
  "source": "default",
  "currency": "EGP"
}
```

JSON key order is not semantically relevant. `source` is the only additional quote key, a literal override/default telling which configuration supplied the fee. `id` and `name` are null for fallback because no override record exists; do not treat those nulls as quote failure. The echoed governorateCode remains the requested normalized code. A fallback response does not generate a new override or provide a missing governorate translation; retain the label from the frontend selector.

The code validator checks syntax, not membership in an Egypt-wide governorate directory. The override list is not a complete delivery-coverage or valid-governorate list. Do not restrict checkout selections to configured overrides. The application currently has no independent governorate-directory endpoint. Saved Users addresses accept governorate text and are preserved as entered; new frontend selections should retain the stable code alongside their display label and supply a code for quotes. Existing Arabic/English address labels are not automatically converted by Shipping.

## Dashboard sequence and concrete requests

1. Sign in as B2C admin/superAdmin through Auth and retain the access JWT.
2. GET dashboard list/default and initialize bilingual names and piastre-based amounts.
3. PATCH default with `{ "defaultFee": 5000 }`, or another staff-selected integer, to update the fallback.
4. Create one override using the following complete body; retain the returned id and governorateCode.

```json
{
  "governorateCode": "cairo",
  "name": { "ar": "القاهرة", "en": "Cairo" },
  "fee": 6000
}
```

The POST returns HTTP 201 and the bilingual override DTO (same fields as override quote, but name is `{ar,en}` and there is no source). PATCH `{ "fee": 0 }` makes only this governorate free; PATCH `{ "name": { "en": "Greater Cairo" } }` preserves Arabic and the stable code. Re-fetch public quotes after fee edits instead of reusing an old preview.

DELETE an override with no body. A complete success response is:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": null,
  "requestId": "f138736c-2bce-4b41-b229-7b044998ceef"
}
```

Deleting an override leaves saved addresses intact, and subsequent quotes for its code use the current default. It does not delete default settings or rewrite historical Order snapshots. There is no client version for Shipping edits; ordinary edits use the last successfully committed value. Concurrent duplicate creates/initial default upserts can produce conflicts; refresh current state before retrying.

## All relevant errors and frontend recovery

| HTTP/code | Endpoint/trigger | What frontend should do |
| --- | --- | --- |
| 401 UNAUTHORIZED | Dashboard auth missing/stale/wrong store | Auth refresh/login recovery. |
| 403 FORBIDDEN | Dashboard wrong role | Hide management controls; moderator cannot manage Shipping. |
| 422 VALIDATION_ERROR | Any validated path/query/body or empty override PATCH | Correct fields; errors may be empty for service-level validation. |
| 404 SHIPPING_FEE_NOT_FOUND | Dashboard get/PATCH/DELETE valid ID missing | Reload list and remove stale row. |
| 409 SHIPPING_FEE_EXISTS | POST duplicate normalized governorate code | Edit the existing record instead of creating another. |
| 409 SHIPPING_CODE_IMMUTABLE | PATCH changes stable lookup key | Preserve code; create/remove deliberately if correcting a code. |
| 409 SHIPPING_CONFLICT | Concurrent default setup or conditional edit conflict | GET current state, then retry the intended edit if still needed. |
| 503 SHIPPING_NOT_CONFIGURED | Public quote has no override and settings absent | Show configuration failure; never silently charge zero. |
| 503 TRANSACTIONS_REQUIRED | Dashboard mutation needs supported MongoDB transactions | Operator issue, not customer choice. |

Shared JSON/body/CORS errors and unexpected 500s apply. Override lookup precedes default lookup, so explicit zero override remains zero even with a nonzero default or a missing setting. Failed writes/audits leave previous configuration unchanged. A preview quote can become stale before checkout; it is not a locked price.

## Future checkout boundary and source

Frontend may display this quote alongside a Cart subtotal as an estimate. The Orders checkout preview returns the actual server-calculated payable estimate; placement revalidates shipping and stores its amount/code/source/currency. The order also preserves the original quoted preview for offline review. Client-submitted shipping totals are ignored. Override/default changes or deletion never rewrite an existing order snapshot. Do not invent free-shipping thresholds, district prices, tax, carriers, minimum order values, or B2B delivery logic.

Source: Shipping routes/controller/validator/service/repository/model, shared response/context middleware, module mounting, Users address contract. Relevant evidence: shipping service/HTTP tests and the separate disposable-MongoDB integration test for unique codes, concurrent setup, rollback, admin deletion, fallback, and unchanged addresses. This documentation adds no new database/provider verification.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.
