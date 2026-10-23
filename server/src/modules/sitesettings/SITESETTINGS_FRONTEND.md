# Site Settings frontend contract

Implemented and source-checked on 2026-10-22. This module owns public business contact details, four social links and default SEO metadata. B2C and B2B have independent settings and staff permissions. It does not own an individual Users profile, saved addresses, the Orders InstaPay account, homepage layouts, bookings or arbitrary pages.

Read [shared API conventions](../../../../docs/frontend/api-conventions.md), [Auth](../auth/AUTH_FRONTEND.md), [B2C flow](../../../../docs/frontend/b2c-flow.md), [B2B flow](../../../../docs/frontend/b2b-flow.md) and [security](../../../../docs/security.md). Shared conventions define all envelope fields, language negotiation, transport errors and 429 recovery. Examples here are synthetic, not client contact details.

## Every endpoint and permission

All six operations return HTTP 200 with `code: "OK"` on success. `store` below means the literal route segment `b2c` or `b2b`; it is not a body field or an account selector. There is exactly one settings document per store.

| Method | Exact path | Caller | Input | Success `data` |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/b2c/site-settings` | Anyone, including guests | No body, queries or path variables | PublicSiteSettings, localized strings |
| GET | `/api/v1/b2b/site-settings` | Anyone, including guests | No body, queries or path variables | PublicSiteSettings, localized strings |
| GET | `/api/v1/admin/b2c/site-settings` | Current B2C superAdmin/admin | Access JWT; no body, queries or path variables | AdminSiteSettings, both languages and version |
| GET | `/api/v1/admin/b2b/site-settings` | Current B2B superAdmin/admin | Access JWT; no body, queries or path variables | AdminSiteSettings, both languages and version |
| PATCH | `/api/v1/admin/b2c/site-settings` | Current B2C superAdmin/admin | Access JWT and JSON update below | Complete normalized AdminSiteSettings |
| PATCH | `/api/v1/admin/b2b/site-settings` | Current B2B superAdmin/admin | Access JWT and JSON update below | Complete normalized AdminSiteSettings |

Moderators and regular users receive 403 on both admin operations. A token from the other store receives 401. Roles and session/account state are checked server-side; dashboard visibility alone is not authorization. There are no POST, DELETE, reset, draft, publish, media upload, list/pagination, per-page SEO or audit-reading endpoints for this module. Even superAdmin has no settings deletion endpoint.

### Headers, cookies and cache behavior

| Name | Requirement, value and source | What to retain or do next |
| --- | --- | --- |
| `Authorization` | Required on admin GET/PATCH: `Bearer <accessToken>` from that store's Auth login/refresh `data.accessToken`. Public GET needs no token. Apidog native Bearer credentials use `{{JWT}}`. | Replace the access token after successful refresh. Never send a B2C token for B2B. |
| `Content-Type` | Required for PATCH: `application/json`. Body is an object, never multipart, raw image, form URL encoding or base64. | Serialize only documented fields. No request body on GET. |
| `X-Language` | Optional `en` or `ar`, normally the frontend UI language. Public address/title/description and shared messages follow negotiation. Admin data remains bilingual. | Keep language in UI state and key public settings caches by store and language. |
| `Accept-Language` | Optional fallback under shared negotiation rules; unsupported/absent preferences use the configured default, initially English. | Do not assume that every unsupported X-Language causes an error. |
| `Origin` | Browser-supplied. Shared CORS permits configured origins. There is no extra cookie-write Origin check for these Bearer-only operations. | Use the configured API/frontend origins; don't manually set Origin in browser code. |
| `X-Request-Id` | Response header; requestId in the body is the same shared tracing value. | Keep for support when a request fails, not as a resource ID or save token. |
| `Cache-Control` | Module handlers set `no-store`, including authorization/validation/service errors that reach this router. Earlier parser/CORS middleware failures follow shared behavior. | Do not publicly cache admin data. A successful edit requires invalidating any frontend-owned public settings state for the affected store/languages. No CDN invalidation API exists. |
| `Retry-After`, `RateLimit`, `RateLimit-Policy` | Shared limit headers where applicable. API IP budget 240/minute; authenticated account budget 120/minute, shared with that account's other protected requests. | On 429 stop repeated requests and wait at least Retry-After seconds. Counters are process-local for the confirmed single-process deployment. |

No refresh token, guest Cart cookie, tracking secret, draft token or idempotency header participates in these calls. Browser `credentials: 'include'` is not required by Site Settings itself; it remains required by Auth when acquiring/refreshing credentials. Settings calls do not set cookies.

## PATCH request: every field

Always read admin GET first, prefill its complete returned values, and retain `data.version`. Send that **actual JSON number** plus at least one editable property. Unknown keys are rejected at every documented object level, including languages. Omitted properties preserve stored values; nested objects merge supplied recognized keys rather than replacing the entire object. Empty nested objects are invalid.

| Body field | Type and requirement | Bounds, normalization, omission/clear behavior | Source and later use |
| --- | --- | --- | --- |
| `version` | Required nonnegative safe integer, 0–9007199254740991 | No numeric strings, fractions, negatives, null or unsafe integers. Must equal latest admin version. Maximum cannot increment and conflicts with 409. | Latest admin GET/PATCH `data.version`; never use public data or invent an increment locally. Retain returned next version after save. |
| `phone` | Optional string or null | Input is trimmed, at most 100 characters before phone normalization. Existing normalization removes spaces, parentheses and hyphens. Result must match optional leading `+` and 6–15 digits. Null clears; empty/blank string is invalid. | Staff enters the public business contact number. Response supplies normalized string/null for contact display and a derived frontend `tel:` link. Not a user's phone fallback. |
| `email` | Optional string or null | Trimmed, lowercased valid email, maximum 254 characters after trim. Null clears; empty/blank string is invalid. | Staff enters public business contact email. Response used for text/derived `mailto:`. Does not reconfigure SMTP, change account email or trigger verification/mail. |
| `address` | Optional non-empty object | Only `en` and `ar` keys. Null, array, string, unknown keys and `{}` invalid. Each supplied language merges; omitted language preserved. | Staff's public business address, independent of customer shipping addresses. |
| `address.en` | Optional string within supplied address | Trimmed, 0–1000 characters; `""` clears English only; null invalid. | English display text; public GET may use Arabic fallback if empty. |
| `address.ar` | Optional string within supplied address | Same rules as address.en. | Arabic display text; public GET may use English fallback if empty. |
| `mapUrl` | Optional string or null | URL policy below; null or trimmed empty string clears; omission preserves. | Staff pastes a supported map URL; frontend renders an external map link, not embed HTML. |
| `social` | Optional non-empty object | Only four keys below. Null, arrays, `{}` and unknown services invalid. Supplied keys merge; omitted services preserved. | Groups public links; not API credentials or a message-send request. |
| `social.instagramUrl` | Optional string or null | URL policy below, Instagram host only; null/blank clears. | Staff-provided Instagram profile/content link; show icon only for non-null value. |
| `social.whatsappUrl` | Optional string or null | URL policy below, WhatsApp hosts only; null/blank clears. | Staff-provided WhatsApp link. It does not send a message, verify a number or configure an API. |
| `social.tiktokUrl` | Optional string or null | URL policy below, TikTok hosts only; null/blank clears. | Staff-provided TikTok link. |
| `social.facebookUrl` | Optional string or null | URL policy below, Facebook hosts only; null/blank clears. | Staff-provided Facebook link. |
| `seo` | Optional non-empty object | Only title, description, keywords. Null, arrays, `{}` and unknown keys invalid. Supplied keys merge. | Default website metadata; not a per-page metadata editor. |
| `seo.title` | Optional non-empty translation object | Only en/ar; null/array/`{}` invalid. Each supplied language must be non-empty after trim. Omitted language preserved. | Staff edits fallback page title, independent of product names and homepage copy. |
| `seo.title.en` | Optional string within supplied title | Trimmed, 1–200 characters, null/empty invalid. | English default title. |
| `seo.title.ar` | Optional string within supplied title | Same rules as title.en. | Arabic default title. |
| `seo.description` | Optional non-empty translation object | Only en/ar; null/array/`{}` invalid. Omitted language preserved. | Default description; not HTML. |
| `seo.description.en` | Optional string within supplied description | Trimmed, 0–500 characters; empty clears this language; null invalid. | English default metadata; Arabic fallback can apply if empty. |
| `seo.description.ar` | Optional string within supplied description | Same rules as description.en. | Arabic default metadata; English fallback can apply if empty. |
| `seo.keywords` | Optional string | Trimmed, 0–1000 characters. Empty clears; null/array invalid. Plain comma-separated text; backend neither splits nor deduplicates it. | Staff-entered default keywords, shared across languages. No search functionality or ranking promise. |

At least one property beyond version is required. `{ "version": 0 }` is invalid. A recognized unchanged value is a valid save and increments version; the backend does not compute a no-op exception. Do not round-trip `store`, `updatedAt`, response envelopes, database `_id`, actors, image IDs or public localized strings as PATCH fields.

### Exact URL policy

Each non-empty URL is trimmed and limited to 2048 characters both before and after URL serialization. It must explicitly start with `https://` (case-insensitive). No internal whitespace, control character, backslash, embedded username/password or non-default port is accepted. HTTP, `javascript:`, `data:`, protocol-relative and arbitrary external hosts are rejected. Explicit default HTTPS port 443 is normalized away by the standard URL parser. Host case and URL escaping are canonicalized by that parser; a bare origin may gain a trailing slash. Query strings/fragments are preserved through normal URL serialization. Trailing-dot hostnames are not in the allowlist.

| Field | Exact allowed hostnames | Additional path rule |
| --- | --- | --- |
| instagramUrl | instagram.com, www.instagram.com | None |
| whatsappUrl | wa.me, whatsapp.com, www.whatsapp.com, api.whatsapp.com, chat.whatsapp.com | None |
| tiktokUrl | tiktok.com, www.tiktok.com, vm.tiktok.com, vt.tiktok.com | None |
| facebookUrl | facebook.com, www.facebook.com, m.facebook.com, fb.com, www.fb.com, fb.me | None |
| mapUrl | maps.google.com, maps.app.goo.gl, maps.apple.com | None |
| mapUrl | google.com, www.google.com, google.com.eg, www.google.com.eg, goo.gl | Case-sensitive pathname must be `/maps` or start `/maps/`. `/maps?q=Cairo` is valid; `/search` and `/maps-other` are not. |

Other subdomains/country hosts are not implicitly supported. An otherwise legitimate unlisted link returns 422; use a listed host or agree a future policy extension. The backend does not visit links, expand redirects, check account ownership, validate real map/profile existence or inspect destination content. A permitted short URL may redirect; the allowlist validates the submitted URL, not every eventual redirect. Frontend should use normal external anchors with `rel="noopener noreferrer"` when opening a new tab. Render text as text and metadata through safe framework properties; do not execute stored HTML or insert arbitrary markup.

## Every response field

All data fields listed below are always present. Neither DTO exposes database IDs, createdAt, audit actor, storage path/credentials or contact-owner credentials. No arrays, totals, pagination or resource ID are needed: the route's store identifies the singleton.

| Field in `data` | AdminSiteSettings | PublicSiteSettings | Meaning, source and retention |
| --- | --- | --- | --- |
| `store` | String b2c/b2b | Same | Comes from selected route/document key; partition frontend state by this store. Read-only; do not send in PATCH. |
| `version` | Nonnegative safe integer | **Absent** | Admin optimistic save token, initially 0; use current value in next PATCH. Public responses never provide editor state. |
| `phone` | Normalized string or null | Same | Stored public business number, initially null. Hide null contact action. No fallback to staff/user number. |
| `email` | Lowercase string or null | Same | Stored public contact email, initially null; hide null contact action. |
| `address` | Object with both en/ar strings | Localized string | Stored business address; defaults empty in both languages. Public chooses requested non-empty language, then other language, else empty. |
| `address.en`, `address.ar` | Always strings, including empty | Not separate public properties | Admin translation values used to prefill editor independently. |
| `mapUrl` | Canonical HTTPS string or null | Same | Stored map link, initially null; hide link for null. Not an image/iframe API. |
| `social` | Object | Same | Always has exactly four nullable URL fields below. |
| `social.instagramUrl` | Canonical string or null | Same | Stored Instagram link, initially null. |
| `social.whatsappUrl` | Canonical string or null | Same | Stored WhatsApp link, initially null. |
| `social.tiktokUrl` | Canonical string or null | Same | Stored TikTok link, initially null. |
| `social.facebookUrl` | Canonical string or null | Same | Stored Facebook link, initially null. |
| `seo` | Object with title/description/keywords | Same property names, localized values | Always present. Use as default metadata when a page does not supply its own fixed metadata. |
| `seo.title` | Object with en/ar strings | Localized non-empty string | Default stored title is English Narmer, Arabic نارمر. Public chooses requested language with other-language fallback. |
| `seo.title.en`, `seo.title.ar` | Always non-empty strings | Not separate public properties | Both values are editor fields, never translate labels into keys. |
| `seo.description` | Object with en/ar strings | Localized string, possibly empty | Initially empty; public language fallback as address. |
| `seo.description.en`, `seo.description.ar` | Always strings, possibly empty | Not separate public properties | Stored editor translations, not a public bilingual object. |
| `seo.keywords` | String, possibly empty | Same | One shared plain string, initially empty. |
| `updatedAt` | UTC ISO-8601 string or null | Same | Server-managed timestamp of latest saved document. Null for untouched GET defaults; a successful PATCH always returns a timestamp string. Display save time if desired; never use as version or send in PATCH. |

The enclosing success body always contains `success: true`, `code: "OK"`, localized `message`, `data` and `requestId`. An error contains `success: false`, stable `code`, localized `message`, `errors` array and `requestId`; it has no success `data`. Individual validator errors contain `field`, `location`, `code`, `message` as explained in shared conventions. Strict service/root rejection and conflicts can have `errors: []`; do not depend on every error identifying a field.

### Untouched public settings: complete empty/default response

GET /api/v1/b2c/site-settings with X-Language: en returns 200, not 404, null or an empty response. GET never creates a database row. B2B behaves identically with `store: "b2b"`.

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "store": "b2c",
    "phone": null,
    "email": null,
    "address": "",
    "mapUrl": null,
    "social": { "instagramUrl": null, "whatsappUrl": null, "tiktokUrl": null, "facebookUrl": null },
    "seo": { "title": "Narmer", "description": "", "keywords": "" },
    "updatedAt": null
  },
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

Admin GET returns the same defaults with version 0 and translation objects: address/seo.description `{ "en": "", "ar": "" }`, seo.title `{ "en": "Narmer", "ar": "نارمر" }`. There is no seed requiring staff cleanup, and no client number/email/address/social URL is invented.

### Full save request and complete admin success

Read admin GET, then PATCH the same store path. The first save uses version 0. Values here are examples; replace them with client-approved input.

```json
{
  "version": 0,
  "phone": "+20 (100) 123-4567",
  "email": " INFO@EXAMPLE.TEST ",
  "address": { "en": "Example address", "ar": "عنوان تجريبي" },
  "mapUrl": "https://www.google.com/maps?q=Cairo",
  "social": {
    "instagramUrl": "https://www.instagram.com/example/",
    "whatsappUrl": "https://wa.me/201001234567",
    "tiktokUrl": "https://www.tiktok.com/@example",
    "facebookUrl": "https://www.facebook.com/example"
  },
  "seo": {
    "title": { "en": "Narmer clothing", "ar": "نارمر للملابس" },
    "description": { "en": "Example shop description", "ar": "وصف تجريبي" },
    "keywords": "clothing, cotton"
  }
}
```

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "store": "b2c",
    "version": 1,
    "phone": "+201001234567",
    "email": "info@example.test",
    "address": { "en": "Example address", "ar": "عنوان تجريبي" },
    "mapUrl": "https://www.google.com/maps?q=Cairo",
    "social": {
      "instagramUrl": "https://www.instagram.com/example/",
      "whatsappUrl": "https://wa.me/201001234567",
      "tiktokUrl": "https://www.tiktok.com/@example",
      "facebookUrl": "https://www.facebook.com/example"
    },
    "seo": {
      "title": { "en": "Narmer clothing", "ar": "نارمر للملابس" },
      "description": { "en": "Example shop description", "ar": "وصف تجريبي" },
      "keywords": "clothing, cotton"
    },
    "updatedAt": "2026-10-22T12:00:00.000Z"
  },
  "requestId": "22222222-2222-4222-8222-222222222222"
}
```

Admin GET after this save returns that same data without incrementing version. Public Arabic GET returns all the public keys, address `"عنوان تجريبي"`, seo.title `"نارمر للملابس"`, seo.description `"وصف تجريبي"`, unchanged shared contact/social/keywords/updatedAt, and no version. The message is localized separately.

### Partial edit and clearing

After version 1, this saves version 2. Only supplied language/service keys change. English address/description, TikTok, Facebook, title and keywords are retained.

```json
{
  "version": 1,
  "phone": null,
  "email": null,
  "address": { "ar": "" },
  "mapUrl": "",
  "social": { "instagramUrl": null, "whatsappUrl": " " },
  "seo": { "description": { "ar": "" } }
}
```

Admin returns phone/email/mapUrl/Instagram/WhatsApp as null, Arabic address/description as empty strings, preserved English values, version 2 and updatedAt. Public Arabic address/description consequently fall back to English; an empty language value is not a command to suppress the other language. To hide address/description in both languages, clear both translations. Title cannot be cleared. For an ordinary minimal save, `{ "version": 2, "seo": { "title": { "en": "Updated title" } } }` is valid and preserves Arabic title and other properties.

## Frontend screen flow and state to retain

1. Website bootstrap/contact/footer: fetch the correct public path with current language. Render plain contact text, safe external anchors and page-default SEO; hide null links and empty address/description/keywords rather than showing placeholders as real client details. This is a read, never create-on-read.
2. Loading/failure: show a non-blocking settings loading state. If fetching fails, keep approved static brand defaults if available, hide unknown contact actions and allow core browsing/request/order flows to continue. Do not substitute real reference-company details. Distinguish a valid empty 200 from a network/server failure. No settings are needed in Checkout or Lead payloads.
3. Dashboard: hide Settings editing from moderator/user. After store-specific staff login, GET admin settings. Retain the complete data and version in editor state; edit English/Arabic independently. Null optional values can appear as empty form controls, but convert cleared phone/email to null on PATCH. Cleared URLs may be null or empty strings. Do not convert a required SEO title to blank.
4. Save: send latest version and changed recognized fields, disable duplicate submission while pending, and use the entire normalized success data as the new editor baseline. Saving publishes immediately. There is no second Publish step or unpublished draft. Invalidate/refetch this store's English/Arabic public state; other store is independent. Backend no-store is not a global CDN purge or cross-tab event.
5. Conflict: keep unsaved user input separately, fetch current admin settings, show that another save occurred, and let staff review/reapply desired differences against the newly fetched version. Do not silently overwrite newer content or auto-merge unknown competing edits.
6. Auth recovery: refresh once using Auth when appropriate, replace access JWT, and retry only under the version policy below. On 403 clear protected editor state/disable actions and reconcile current role. Clear private state on logout/store/account changes.

| Retained item | Origin | Next use and lifetime |
| --- | --- | --- |
| Store and UI language | Frontend routing/preference | Choose public/admin path and public localization; no body field. Cache lifetime is frontend-controlled and must respect no-store/publication rules. |
| Access JWT | Same-store Auth login/refresh | Authorization on admin GET/PATCH until expiry/replacement. No new token is returned by this module. |
| Admin data.version | Latest admin GET/PATCH | Exact next PATCH version. Discard stale value after conflicting/new save; never obtain from public GET. |
| Editable bilingual/contact data | Admin GET or successful PATCH | Prefill/editor baseline; build only documented editable subset. Preserve local unsaved changes separately during refresh/conflict. |
| Public data | Public GET for one store/language | Footer/contact/default SEO only; not an admin PATCH source. Refetch on language/store change and after a known successful save. |
| requestId | Response envelope/header | Diagnostics only. Never authorization, idempotency or concurrency control. |

## Publication, atomicity and retry behavior

Settings row creation/update and its audit entry commit in one MongoDB transaction. An audit failure rolls the write back. First save creates the singleton at version 1; a concurrent first save cannot create another row because store is the unique document key. Existing edits compare current version and increment once. A stale save or version-overflow returns 409 SITE_SETTINGS_CONFLICT. Other-store writes never share this singleton. MongoDB transaction support remains a deployment requirement, as for existing modules.

There is no idempotency key or replay receipt. After a timed-out save, GET current admin data before deciding to retry; the write might have committed. Retrying the exact old version will normally conflict if it did. A version change can also be another admin's save, so compare fields and do not assume success solely from increment. Same-value saves still increment. Do not blindly replace the version in a failed body with the newest number and resubmit it. No mail, notification, provider request, file upload/deletion or account change occurs from settings edits. The audit contains actor/store/new version/top-level edited field names and is internal.

## Errors and recovery

| HTTP / stable code | Trigger | Frontend recovery |
| --- | --- | --- |
| 401 UNAUTHORIZED | Missing/malformed/expired/revoked access credentials, wrong store | Follow Auth refresh/relogin; preserve unsaved input in safe local state. |
| 403 FORBIDDEN | Current role is not superAdmin/admin | Stop editing; reconcile role. Do not retry with another store's token. |
| 403 CORS_DENIED | Request's Origin is outside configured allowlist | Fix environment/origin setup; browser may expose this as fetch failure. |
| 422 VALIDATION_ERROR | Bad/missing version, no editable fields, unknown top/nested key, invalid type/empty object/bounds/URL/email/phone | Keep editor input and show correction; inspect field errors when present, otherwise show a general validation error. |
| 409 SITE_SETTINGS_CONFLICT | Stale version, concurrent first creation/update or unsafe next increment | Reload/reconcile as above; at maximum version request backend maintenance, not endless retry. |
| 429 TOO_MANY_REQUESTS | Existing API IP or account limit | Wait Retry-After, stop polling/repeated saves. This is not a settings validation conflict. |
| 400 INVALID_JSON | Malformed JSON parser input | Fix serialization; not a successful settings save. |
| 413 BODY_TOO_LARGE | Shared JSON request exceeds 100 KiB | Send documented fields within limits; no upload belongs here. |
| 415 UNSUPPORTED_ENCODING | Unsupported compressed/character-encoded request | Send ordinary UTF-8 JSON. |
| 404 NOT_FOUND | Wrong/unmounted path or unsupported method | Correct path/method; absent settings themselves produce full defaults, not 404. |
| 500 INTERNAL_ERROR | Unexpected database/transaction/audit failure | Keep input and requestId; GET before retry if response outcome is uncertain. No partial success is promised. |

Example stale-save error; requestId is illustrative:

```json
{
  "success": false,
  "code": "SITE_SETTINGS_CONFLICT",
  "message": "The website settings changed. Reload them before saving.",
  "errors": [],
  "requestId": "33333333-3333-4333-8333-333333333333"
}
```

## Verification and boundaries

Focused unit and actual Express HTTP tests use isolated in-memory persistence/auth fixtures. They cover all six operations, both-store isolation, staff roles, default/no-write GET, complete projections, language merge/fallback, null/blank normalization, supported/malicious URLs, strict unknown fields/types/bounds, stale first/existing saves, audit rollback, safe version overflow and repository compare/update predicates. These establish application behavior with fixture persistence; they do not establish live MongoDB contention, deployed browser/SEO rendering, real link destinations or production cache invalidation. Exact final suite and Apidog/package evidence is recorded in [readiness](../../../../docs/frontend/integration-readiness.md).
