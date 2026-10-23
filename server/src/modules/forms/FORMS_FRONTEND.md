# Forms frontend contract (B2B)

Source checked: 2026-10-13. This document covers the implemented form-definition editor and public definition reads. Read [API conventions](../../../../docs/frontend/api-conventions.md), [Auth](../auth/AUTH_FRONTEND.md), [B2B flow](../../../../docs/frontend/b2b-flow.md), and [architecture](../../../../docs/architecture.md) alongside it. [Leads](../leads/LEADS_FRONTEND.md) implements answer submission, private images, tracking, staff arrival events, and optional customer email jobs; [Wholesale](../wholesale/WHOLESALE_FRONTEND.md) implements pouch offers. Reading a form definition is not submitting a request.

## Business types, defaults and availability

There are exactly five built-in types. The `type` is a stable machine identifier and route parameter, not an editable title or Mongo ID.

| Type identifier | Initial English title | Initial Arabic title |
| --- | --- | --- |
| `spinning` | Spinning | الغزل |
| `weaving` | Weaving | النسيج |
| `fabric` | Fabric | الأقمشة |
| `school-uniforms` | School Uniforms | الزي المدرسي |
| `wholesale` | Wholesale | الجملة |

Startup initializes the unique `(store,type)` index and creates missing definitions with version 0, isActive false, empty helpText in both languages and fields: []. Repeated initialization preserves saved titles, fields, availability and versions. The user chose unpublished initial definitions; the public list is initially empty. Configure the real client questionnaire before enabling a form. No type-specific questions or material-description field are invented/seeded. The confirmed own-material requirement should be included by staff in the applicable questionnaire; whether any form requires supplied material remains unresolved.

There is one current definition per type. Editing an active form takes effect immediately; no separate draft, publish-copy, history, scheduling, form creation or deletion endpoint exists. Set isActive:true to publish and isActive:false to retire. Retiring preserves the definition and configurable fields. Every successful edit increments version, including help text, translations, availability and field ordering. Leads requires this public version and preserves independent bilingual submission snapshots; see its complete submission contract.

## Every endpoint and permission

All successful operations return HTTP 200 and code OK in the common success envelope. No operation returns 201 or 204.

| Method and exact path | Access | Request | Response data |
| --- | --- | --- | --- |
| `GET /api/v1/b2b/forms` | Public, no account required | No body, query or path fields | `{items,supportedFieldTypes}`; only active definitions, in built-in type order above. |
| `GET /api/v1/b2b/forms/:formType` | Public | Required formType path field | Complete localized active definition. Inactive/missing definition returns 404. |
| `GET /api/v1/admin/b2b/forms` | B2B superAdmin/admin | No body, query or path fields | `{items,supportedFieldTypes}`; all five definitions, including unpublished ones, in built-in order. |
| `GET /api/v1/admin/b2b/forms/:formType` | B2B superAdmin/admin | Required formType path field | Complete bilingual definition, whether active or inactive. |
| `PATCH /api/v1/admin/b2b/forms/:formType` | B2B superAdmin/admin | Required path formType, JSON version and at least one editable property below | Complete updated bilingual definition with incremented version. |

There are no B2C Forms routes. B2B moderators/customers receive 403 for these dashboard operations; moderators' permission to read Leads submissions does not grant form-management access. Public reads do not authenticate a supplied bearer header or attach an account: published definitions are the same public resource for everyone. Use only documented methods; POST, DELETE and nested field editing are not mounted under Forms. Submissions use the separate Leads routes.

### Transport fields

| Field | Requiredness, meaning and source | Retention |
| --- | --- | --- |
| `Authorization: Bearer <accessToken>` | Required on dashboard routes only; obtained from B2B Auth login/refresh. B2C tokens do not authorize dashboard requests. | Keep B2B access state separate; replace after refresh. |
| `Content-Type: application/json` | Required when sending the PATCH JSON body. No body is needed on GET. | Send only the editable fields, not a copied response DTO. |
| `X-Language` | Optional en/ar, case-insensitive, selecting public labels/messages. Unsupported/absent values fall back to Accept-Language negotiation, then configured default, initially en. | Cache public definitions per language. Dashboard labels remain bilingual regardless of this header. |
| `Accept-Language` | Optional fallback for localization. | Browser/frontend language preference. |
| `Origin` | Browser-managed and subject to general configured CORS. These routes do not add a cookie-authenticated Origin requirement. | Configure the real frontend origin; do not manually set in browser JavaScript. |
| Cookies | Forms issues/consumes no cookie. Dashboard requires bearer authentication, not refresh-cookie authentication. | B2B Auth refresh is a separate credentials-enabled call. |
| `formType` | Required on detail/PATCH paths; exactly one lowercase identifier in the table. No trimming/case conversion or Mongo ID lookup. | Keep returned type for future requests; changing title never changes this identifier. |

Queries are not consumed: no pagination, search, sort, active filter or language query parameter exists. No additional Forms-specific limiter is installed; general API IP and verified-account limits apply as documented below. Shared 100 KB JSON body limits, CORS, response headers and error handling apply. Content-Language describes message/public locale; X-Request-Id contains the server request ID. Dashboard returns both translations even when Content-Language is ar/en.

## Every PATCH body field

| Field | Type, requiredness, bounds and transformation | Source and effect |
| --- | --- | --- |
| `version` | Required JSON number, safe nonnegative integer. Strings, fractions and null are rejected. | Latest dashboard version from GET or successful PATCH. Required for every save, including publication changes. Never increment locally and guess. |
| `title` | Optional object with only ar/en properties; at least a valid translation must be supplied for a useful edit. Present values must be strings, trimmed, 1–150 characters. Omitted language preserves its saved value. Null, empty values and other language keys are invalid. | Staff editor. Changes visible form title; never changes type. Both saved languages remain nonempty. |
| `title.ar`, `title.en` | Strings subject to the title rules above. | Arabic/English text. Do not send localized public title as the entire title value. |
| `helpText` | Optional object containing only ar/en. Each supplied value is a trimmed string of 0–2000 characters; empty string explicitly clears that translation. Omitted language is preserved. Null is rejected. | Staff editor; optional explanation shown above the form. Public help text falls back to the other language if the selected translation is empty. |
| `helpText.ar`, `helpText.en` | Strings subject to the helpText rules above. | Arabic/English explanation. Saved empty strings are allowed. |
| `isActive` | Optional actual JSON boolean. | True publishes; false retires. Omission preserves current state. Publishing with no configurable fields is allowed after an explicit staff edit; the protected fixed fields still exist. |
| `fields` | Optional array, 0–40 complete configurable definitions below. Null is rejected. | Replaces the whole ordered configurable list. Omission preserves it; [] removes all configurable fields. Send every field you intend to retain, in display order. |

At least one of title/helpText/isActive/fields is required in addition to version. A version-only or unknown-only body returns INVALID_FORM. A valid identical edit still increments version and records an audit; an empty translation object preserves both values but still counts as an explicit edit. Do not use empty objects as a no-op heartbeat.

Top-level fixedFields, type, store and supportedFieldTypes are protected and explicitly rejected, even if copied unchanged from a response. Other unrecognized top-level properties such as id/actorId/timestamps are ignored and never written. Unknown keys inside title/helpText/fields/choices are rejected. IDs, version increments, constraints and audit attribution come from the server.

### Complete configurable field input

Each fields[] object accepts only the following keys. It has no nested groups, conditions, scripts, HTML template, upload rule, custom validator, arbitrary min/max, default answer or price/stock operation.

| Field | Exact rule | Meaning and source |
| --- | --- | --- |
| `key` | Required string matching `[a-z][a-z0-9_-]{0,39}` exactly; lowercase, 1–40 characters. No trim/case normalization. | Stable answer identifier chosen by staff, e.g. material-description. Unique within the form and cannot equal fixed name/phone/email/governorate/district or constructor/prototype/__proto__. Retain it when editing the same question. |
| `type` | Required literal text/textarea/number/select/multiselect/boolean. | Supported widget/answer kind; changing it changes the form version. |
| `label` | Required bilingual object with exactly ar/en string properties, each trimmed and nonempty, maximum 150 characters. | Staff-provided question label. Both translations are mandatory in a replacement field list. |
| `label.ar`, `label.en` | Required strings under label. | Display translations; never use the label as an answer key. |
| `required` | Required actual boolean. No implicit default. | Whether an eventual submission must supply an answer. An optional boolean answer may still be false; required does not mean “must be true.” |
| `choices` | Required nonempty array for select/multiselect, 1–50 entries. For other types, omit it or send []; nonempty choices and null are rejected. | Ordered selectable values. Every returned field has choices:[] when no choices apply. |
| `choices[].key` | Required machine string with the same pattern, 1–40 characters, and unsafe-key exclusions as field key. Unique within this field. | Stable submitted choice value; retain it when only relabeling. Numeric labels can use a machine key such as grade-1. |
| `choices[].label` | Required object with only ar/en; both trimmed nonempty strings up to 150 characters. | Choice display label, not its submitted value. |
| `choices[].label.ar`, `.en` | Required strings. | Arabic/English label. |

The list replacement is explicit: removing a field or choice from the submitted list removes it from the current form. The server does not match/recover an omitted field, preserve its missing translations, or merge choices. A key change is a changed question identity for future submissions. Historical answers are preserved in Lead snapshots; Forms does not edit submitted Leads.

## Every response field

Success envelope is `{success:true,code:"OK",message,data,requestId}`. Message is the selected locale's shared success text; requestId is a server-generated UUID also in X-Request-Id, useful for support, not a retry credential. Lists have a non-null data object even when no forms are active. Details/PATCH contain a single non-null definition. Errors do not contain data.

### List data

| Field | Type, source and frontend handling |
| --- | --- |
| `items` | Array of complete definitions below. Public length 0–5; dashboard normally 5 after startup. No total/pagination/next cursor. Empty public list means no available forms; a failed request is different. |
| `supportedFieldTypes` | Always the ordered string array [text,textarea,number,select,multiselect,boolean], owned by server. |

Use supportedFieldTypes for the dashboard type selector. Phone/email occur only in protected fixed definitions and are not permitted configurable types. Retain supportedFieldTypes as metadata, but never send it back in PATCH. Detail/PATCH responses omit it; obtain it from the list contract.

### Definition fields

| Field | Exact presence, source and meaning | Retention |
| --- | --- | --- |
| `id` | Always lowercase 24-hex string, generated for the persisted definition on initialization. | Read-only stable database identity; path uses type instead. Never send as an edit field. |
| `type` | Always one of the five stable identifiers. | Keep for public/dashboard detail and PATCH path. |
| `title` | Public localized string; dashboard object {ar,en}, each nonempty trimmed string up to 150 characters. | Public display; dashboard editor retains both languages. |
| `helpText` | Public localized string, possibly empty; dashboard object {ar,en}, each string up to 2000 characters. Public empty selected translation falls back to other language. | Public display; retain both saved values for editor, including empty strings. |
| `isActive` | Always boolean; public results always true, dashboard may be false. | Dashboard publish/retire state. Inactive forms return 404 publicly, rather than a false detail. |
| `version` | Always nonnegative safe integer, persisted current definition revision, initially 0. | Dashboard must send this exact latest value on next PATCH. Public frontend retains it as formVersion with the rendered form for Leads submission. |
| `fixedFields` | Always ordered array of five server-owned field objects below. | Render before configurable fields. Read-only; do not include in PATCH or allow dashboard removal/relabeling/reordering. |
| `fields` | Always ordered array of 0–40 configurable field objects below. | Render in order. Dashboard must preserve all retained fields/choices/keys and both labels when replacing the list. |

No store, timestamps, audit entries, actor ID, submission URL, lead ID, user data, attachments, response count or database __v is returned. Forms has no expiration/TTL.

### Every returned field/choice property

Both fixedFields[] and fields[] always have key/type/label/required/choices/constraints. Key/type/required have the input meanings above. Public label is a localized string; dashboard label is {ar,en}. choices is always an array of {key,label}; public choice labels are strings, dashboard labels bilingual objects. Fixed and non-choice fields have choices:[]. Configurable key/type/required come from validated saved configuration; fixed values and every constraints object come from server constants, never administrator-controlled scripts.

constraints contains only the properties listed below for its particular type. Missing constraint keys are absent, not null. A select/boolean field has constraints:{}. Do not copy constraints into PATCH fields; the server rejects unsupported field properties. These definitions describe UI limits enforced by Leads submission; required false booleans and valid zero numbers are supplied answers.

| Configurable type | Answer/widget meaning | Exact returned constraints |
| --- | --- | --- |
| `text` | Short text input | minLength:1, maxLength:500 |
| `textarea` | Long text area | minLength:1, maxLength:5000 |
| `number` | Finite numeric value, including decimals; no unit or pricing arithmetic implied | min:-1000000000, max:1000000000 |
| `select` | One stable choices[].key | Empty object; valid values come from choices. |
| `multiselect` | Unique selected choices[].keys | minItems:1, maxItems:50, uniqueItems:true |
| `boolean` | Yes/no boolean control | Empty object; false is a value, not absence. |

An optional unanswered field should be represented as absent in the later submission contract; its minLength/minItems apply to a supplied answer, not to whether an optional question appears. Send configurable keyed answers under answers and fixed contact under contact through the linked Leads contract. Labels/help text are plain content: escape it in rendering rather than executing or injecting it as HTML.

### Protected fixed fields

Every form has these five fields in this exact order. Fields/choices arrays cannot reuse these keys or change their required flags. Fixed definitions are never stored as editable copies on a FormDefinition.

| key | type | Required | English/Arabic label | Exact constraints |
| --- | --- | --- | --- | --- |
| name | text | true | Name / الاسم | minLength:1, maxLength:100 |
| phone | phone | true | Phone / رقم الهاتف | maxLength:32 |
| email | email | false | Email / البريد الإلكتروني | maxLength:254 |
| governorate | text | true | Governorate / المحافظة | minLength:1, maxLength:150 |
| district | text | true | District / area / المنطقة / الحي | minLength:1, maxLength:150 |

These limits describe the definition/UI. The [Leads handoff](../leads/LEADS_FRONTEND.md) documents submitted contact trimming, phone normalization/format, email validation, answer envelope and errors. The API does not derive governorate/district from saved addresses or shipping-fee codes; those are distinct B2C/address contracts. Building/street/floor/apartment are not fixed lead fields. No contact values are filled by this module; any customer-profile prefill is frontend convenience and must remain editable.

### Where returned form values go next

| Forms value | Use in the next request | Retention and stale-data handling |
| --- | --- | --- |
| Definition `type` | Public detail path `/api/v1/b2b/forms/:formType`; prepare body `{ "formType": "..." }`; it also selects the later Leads rules. | Retain with the visitor's unsent answers and draft. It is stable and is not derived from the editable title or definition `id`. |
| Definition `version` | Dashboard PATCH JSON `version`; for a public submission, Leads JSON `formVersion`. | Retain the exact version rendered with the answers. PATCH conflicts require a fresh dashboard GET and merge; Leads `FORM_CONFLICT` requires reloading the public definition and user review. |
| Definition `id` | No Forms or Leads request accepts this ID. | Read-only database identity; do not substitute it for `type` or `formVersion`. |
| `fixedFields[].key` | Maps to the corresponding property under Leads `contact` (`name`, `phone`, `email`, `governorate`, `district`), never `answers`. | The five keys/order/required flags are server-owned. Keep any prefilled value editable and apply the Leads contact normalization on submit. |
| Configurable `fields[].key` | Property name under Leads `answers`, e.g. `answers[ field.key ]`. | Keep the exact key with the rendered form version. If a field disappears or changes, preserve the user's draft for review; do not map by label. |
| Configurable `fields[].type` and `constraints` | Selects the JSON answer type and client validation; number is a JSON number, boolean is a JSON boolean, text values are strings, multiselect is an array. | Do not coerce strings into numbers/booleans. Optional unanswered answers are omitted; `0` and `false` are real values. Server validates again. |
| `choices[].key` | Value for `answers[field.key]` on select, or an element of that array on multiselect. | Retain the stable key, not the localized label. If the current definition no longer contains the key, reload and ask the user to review the answer. |
| Localized public title/help/labels | Display in the visitor form; answers/contact use stable keys and entered values, not those labels. | A saved Lead snapshot retains configured translations and later views localize that historical snapshot. Dashboard editors instead prefill the bilingual title/helpText/field label/choice label objects from dashboard GET, edit those supported content fields, and submit the documented PATCH schema; never replace a bilingual object with one public localized string. |

## Complete request/response examples

Read all dashboard definitions with GET /api/v1/admin/b2b/forms and Authorization: Bearer <b2b-staff-access-token>. Public GET /api/v1/b2b/forms needs no token. Initially its complete success body is:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "items": [],
    "supportedFieldTypes": ["text", "textarea", "number", "select", "multiselect", "boolean"]
  },
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

Read a dashboard definition, retain its version, then send a replacement list and publication change:

```http
PATCH /api/v1/admin/b2b/forms/spinning
Authorization: Bearer <b2b-staff-access-token>
Content-Type: application/json
```

Example request body; these material questions are illustrative admin configuration, not seeded defaults:

```json
{
  "version": 0,
  "isActive": true,
  "helpText": { "en": "Describe the material you will bring.", "ar": "صف الخامة التي ستحضرها." },
  "fields": [
    { "key": "material-description", "type": "textarea", "label": { "ar": "وصف الخامة", "en": "Material description" }, "required": false },
    { "key": "material-type", "type": "select", "label": { "ar": "نوع الخامة", "en": "Material type" }, "required": true,
      "choices": [{ "key": "cotton", "label": { "ar": "قطن", "en": "Cotton" } }] }
  ]
}
```

GET /api/v1/b2b/forms/spinning with X-Language:en then returns this complete localized public response. IDs/content are synthetic:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "id": "222222222222222222222222",
    "type": "spinning",
    "title": "Spinning",
    "helpText": "Describe the material you will bring.",
    "isActive": true,
    "version": 1,
    "fixedFields": [
      { "key": "name", "type": "text", "label": "Name", "required": true, "choices": [], "constraints": { "minLength": 1, "maxLength": 100 } },
      { "key": "phone", "type": "phone", "label": "Phone", "required": true, "choices": [], "constraints": { "maxLength": 32 } },
      { "key": "email", "type": "email", "label": "Email", "required": false, "choices": [], "constraints": { "maxLength": 254 } },
      { "key": "governorate", "type": "text", "label": "Governorate", "required": true, "choices": [], "constraints": { "minLength": 1, "maxLength": 150 } },
      { "key": "district", "type": "text", "label": "District / area", "required": true, "choices": [], "constraints": { "minLength": 1, "maxLength": 150 } }
    ],
    "fields": [
      { "key": "material-description", "type": "textarea", "label": "Material description", "required": false, "choices": [], "constraints": { "minLength": 1, "maxLength": 5000 } },
      { "key": "material-type", "type": "select", "label": "Material type", "required": true,
        "choices": [{ "key": "cotton", "label": "Cotton" }], "constraints": {} }
    ]
  },
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

PATCH returns the same complete definition structure but title/helpText/each field label/each choice label are bilingual objects. No labels are omitted from dashboard responses. Example complete dashboard data for the next unconfigured type (weaving), before editing:

```json
{
  "id": "333333333333333333333333",
  "type": "weaving",
  "title": { "ar": "النسيج", "en": "Weaving" },
  "helpText": { "ar": "", "en": "" },
  "isActive": false,
  "version": 0,
  "fixedFields": [
    { "key": "name", "type": "text", "label": { "ar": "الاسم", "en": "Name" }, "required": true, "choices": [], "constraints": { "minLength": 1, "maxLength": 100 } },
    { "key": "phone", "type": "phone", "label": { "ar": "رقم الهاتف", "en": "Phone" }, "required": true, "choices": [], "constraints": { "maxLength": 32 } },
    { "key": "email", "type": "email", "label": { "ar": "البريد الإلكتروني", "en": "Email" }, "required": false, "choices": [], "constraints": { "maxLength": 254 } },
    { "key": "governorate", "type": "text", "label": { "ar": "المحافظة", "en": "Governorate" }, "required": true, "choices": [], "constraints": { "minLength": 1, "maxLength": 150 } },
    { "key": "district", "type": "text", "label": { "ar": "المنطقة / الحي", "en": "District / area" }, "required": true, "choices": [], "constraints": { "minLength": 1, "maxLength": 150 } }
  ],
  "fields": []
}
```

To retire spinning after the example update, PATCH the same dashboard path with `{ "version": 1, "isActive": false }`. The response has version 2 and retains both configured questions. Public detail then returns FORM_NOT_FOUND. To remove configurable questions, PATCH fields:[] with the latest version; fixed fields remain. Removing choices/fields is editing a definition, not deleting a type or a Lead.

## Complete dashboard and public flows

1. Staff signs in through B2B Auth, then GETs the dashboard list. Use supportedFieldTypes for the type selector. Select a definition by type and keep id/type/version, both title/help translations, and the ordered complete fields/choices. Show fixedFields as protected read-only content.
2. Edit bilingual labels, choices and required flags; add/remove/reorder configurable fields within the bounds. Keep stable keys when changing only labels. Strip response-only constraints from the PATCH field objects. Send version plus actual intended edits; omitted top-level properties are preserved. A field-list edit sends the complete replacement list, not an individual field patch.
3. Save serially per form. On success replace editor state with the complete returned bilingual DTO, including new version. On a network timeout, read the latest dashboard definition and compare it with the intended changes. Repeating an already-committed PATCH with its old version returns FORM_CONFLICT rather than replaying success. There is no idempotency key or request deduplication endpoint.
4. If version conflicts, retain unsaved input, GET the current definition and review/merge edits before retrying with the fresh version. Do not blindly overwrite another staff member's list or bump the version locally. A database/audit failure rolls the edit back atomically; show the error and preserve draft input.
5. When the real questionnaire is ready, publish with isActive:true and latest version. This makes the current definition public immediately. An edited active form has no separate publish step. Leads now enables submission with the displayed formVersion; an edit can make a visitor's current form stale. Retire with isActive:false when needed; no answers/submissions are deleted by this operation.
6. Guests/public visitors GET the public list, choose a returned type, then GET its current detail. Render fixedFields followed by fields in order, using localized labels, choices and server constraints. Keep type/version with local form state for Leads submission. Refetch after changing locale. Never request inactive dashboard definitions as a public fallback.
7. If a form becomes unavailable or later changes version, preserve user draft input for review but reload/review the current definition before submission. No complete questionnaire or submission route should be hard-coded from this example. Images use the Leads private draft upload contract, not B2C catalog Media endpoints. Wholesale pouch selection uses the implemented Wholesale offers, not ordinary choice fields pretending to validate source products/variants; its submission payload belongs to the implemented Leads contract.

## Error envelope and every recovery case

Errors have success:false, stable code, localized message, errors:[], and UUID requestId; there is no data field. Validation errors include entries with field/location/code/message. Path formType errors use location params and field formType. Top-level PATCH shape errors use location body and the affected field name. Protected properties get INVALID_FIELD. Nested configuration/business errors use INVALID_FORM with an empty errors array; review the supplied fields against this contract rather than expecting a nested field path.

| HTTP | Code | Trigger and frontend action |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | Missing/invalid/expired/wrong-store token, inactive account or invalidated session on dashboard. Follow Auth refresh once where appropriate, otherwise sign in. |
| 403 | `FORBIDDEN` | B2B user/moderator attempts dashboard access. Refresh does not grant privileges. |
| 404 | `FORM_NOT_FOUND` | Public inactive/missing type, or missing initialized dashboard definition. Public UI removes/hides the unavailable form; staff can inspect publication state through dashboard. Startup initialization issues require backend correction. |
| 404 | `NOT_FOUND` | Wrong route/method, B2C Forms, POST/DELETE or an unimplemented submission endpoint. Correct the integration. |
| 409 | `FORM_CONFLICT` | Submitted version is stale or conditional update lost a race. GET current definition and reconcile unsaved edits. |
| 422 | `VALIDATION_ERROR` | Unsupported/case-mismatched formType, missing/noninteger version, wrong title/helpText/fields/isActive shape, or protected top-level property. Use errors[] to correct input. |
| 422 | `INVALID_FORM` | Empty usable patch, invalid translations, nested unknown field/choice properties, reserved/duplicate/unsafe keys, unsupported type, invalid required flag or invalid choices/bounds. Correct the entire definition configuration. |
| 503 | `TRANSACTIONS_REQUIRED` | Dashboard writes need MongoDB replica-set transactions. Backend configuration must be fixed; no partial update is committed. Reads do not require a write transaction. |
| 500 | `INTERNAL_ERROR` | Unexpected database/authorization infrastructure/audit failure. Preserve editor input, retain requestId and retry after recovery. |
| 403 | `CORS_DENIED` | Frontend origin is not configured. Browser may surface only fetch/network failure. Fix deployment origin. |
| 400 | `INVALID_JSON` | Malformed PATCH JSON. Serialize ordinary JSON. |
| 413 | `BODY_TOO_LARGE` | JSON exceeds 100 KB. Overall body limit applies even if individual field/choice/label bounds are satisfied. Reduce the definition/request. |
| 415 | `UNSUPPORTED_ENCODING` | Shared parser rejects supplied content encoding/charset. Use supported ordinary JSON transport. |

Invalid internal store context produces 400 INVALID_STORE; normal B2C Forms URLs are not mounted and return 404. Lists and public reads do not leak unpublished fields, labels or help text. The server controls staff identity and audit fields; a supplied actorId cannot change attribution.

## Verification and next integration boundary

Focused service/HTTP checks cover all six types, unpublished defaults, bilingual/public DTOs, protected contacts, add/remove/reorder/replace behavior, safe/unique keys, choices, invalid schema/rules, permissions, store isolation, publication/retirement, optimistic conflicts and audit rollback. The full local suite passed 117 tests with the opt-in database test skipped. The separate authorized MongoDB integration test passed concurrent initialization, preserved edits on restart, version contention and audit rollback; disposable test collections were removed and verified absent. No dependency, provider configuration or environment secret was changed. Wholesale offer selection is implemented separately. Leads now implements submission validation, historical snapshots/tracking and private image attachments; its separate checks are recorded in the Leads handoff. No live browser/provider behavior is established here.

When Leads submits, its internal getForSubmission operation obtains a bilingual definition snapshot inside the caller's MongoDB transaction and writes a private submission revision on that definition. It requires the current public version and active state; stale versions return FORM_CONFLICT and retired forms return FORM_NOT_FOUND. This serializes capture against definition edits without changing the exposed version or creating a history engine. The revision is not a DTO/write field. The saved Lead snapshot remains independent of later edits, and the submitter must review a changed form rather than silently remapping answers.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.
