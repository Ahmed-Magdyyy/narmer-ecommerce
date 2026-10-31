# Leads frontend contract

Last checked against mounted routes, validators, controllers, services, repositories, DTO builders, and shared middleware on 2026-10-13. Leads is B2B only. Read this with [shared API conventions](../../../../docs/frontend/api-conventions.md), [B2B flow](../../../../docs/frontend/b2b-flow.md), [Forms](../forms/FORMS_FRONTEND.md), [Wholesale](../wholesale/WHOLESALE_FRONTEND.md), and [Media](../media/MEDIA_FRONTEND.md). Those documents define shared envelopes and complete form/offer/image contracts; this file defines how Leads uses them.

## Scope and permissions

The API supports guest submissions, submissions by authenticated B2B customers, private guest tracking, customer-owned lead reads, and dashboard staff reads/contact marking. First submission also creates a staff dashboard notification and, when configured and an email was entered, a customer email job. It does not create a quote, sale, order, cart, payment, shipping charge or inventory reservation. A wholesale request is an inquiry snapshot only; its quantity is whole pouches and never changes stock.

Guests may prepare drafts, upload draft images, submit, and read a guest lead through its tracking token. B2B users may use those same draft routes and can list/read only leads whose <code>userId</code> is their own account. The optional <code>Authorization</code> header on draft routes must contain a valid B2B access token for a <code>user</code> account; staff tokens are rejected with 403. Omitting Authorization keeps the operation guest-owned. The server derives <code>userId</code> from the validated session, never from the request body. Matching email or phone does not associate a guest submission with an account.

Only <code>superAdmin</code>, <code>admin</code>, and <code>moderator</code> may use dashboard Leads routes. They can list/read leads, view private images, and mark a lead contacted. They cannot edit submitted answers, delete leads, or change submitted form/offer snapshots through these routes. Contacted attribution and time come from the authenticated staff identity and server clock.

All Leads routes set <code>Cache-Control: no-store</code>. Use the shared envelope, request IDs, language headers, and error format in [API conventions](../../../../docs/frontend/api-conventions.md). Guest draft secrets and tracking secrets are bearer credentials: keep them only in private client state, never in URLs, analytics, logs, or shared caches.

## Routes and request rules

The base paths are <code>/api/v1/b2b/leads</code> for guest/customer operations and <code>/api/v1/admin/b2b/leads</code> for staff. Successful JSON endpoints return the shared success envelope with <code>success</code>, <code>code</code>, <code>message</code>, <code>data</code>, and <code>requestId</code>. Binary image reads return WebP bytes rather than JSON.

| Method and path | Role | Success | Purpose |
| --- | --- | --- | --- |
| <code>POST /api/v1/b2b/leads/drafts</code> | Guest or B2B user | 201 | Start a 24-hour draft for one form type. |
| <code>GET /api/v1/b2b/leads/drafts/:draftId</code> | Guest or B2B user plus draft token | 200 | Resume/read draft expiry and uploaded image IDs. |
| <code>POST /api/v1/b2b/leads/drafts/:draftId/images</code> | Guest or B2B user plus draft token | 201 | Upload one private image as raw bytes. |
| <code>POST /api/v1/b2b/leads</code> | Guest or B2B user plus draft token | 201 new / 200 identical replay | Submit a lead and receive its snapshot/receipt. |
| <code>GET /api/v1/b2b/leads/tracking/:leadId</code> | Guest with <code>X-Lead-Token</code> | 200 | Read a guest-owned lead until 90-day tracking expiry. |
| <code>GET /api/v1/b2b/leads</code> | B2B user | 200 | List only that account's leads. |
| <code>GET /api/v1/b2b/leads/:leadId</code> | B2B user | 200 | Read only that account's lead. |
| <code>GET /api/v1/admin/b2b/leads</code> | <code>superAdmin</code>, <code>admin</code>, <code>moderator</code> | 200 | List dashboard leads. |
| <code>GET /api/v1/admin/b2b/leads/:leadId</code> | <code>superAdmin</code>, <code>admin</code>, <code>moderator</code> | 200 | Read a dashboard lead including private image IDs. |
| <code>GET /api/v1/admin/b2b/leads/:leadId/images/:imageId</code> | <code>superAdmin</code>, <code>admin</code>, <code>moderator</code> | 200 binary | Read an attached private image. |
| <code>PATCH /api/v1/admin/b2b/leads/:leadId/contacted</code> | <code>superAdmin</code>, <code>admin</code>, <code>moderator</code> | 200 | Mark a lead contacted, safely repeatable. |

Customer and staff lists accept optional <code>page</code>, <code>limit</code>, <code>formType</code>, and <code>status</code> queries; defaults are page 1 and limit 20. Page is an integer from 1 through 100000; limit is an integer from 1 through 100. <code>formType</code> is one of <code>spinning</code>, <code>weaving</code>, <code>fabric</code>, <code>school-uniforms</code>, or <code>wholesale</code>. <code>status</code> is <code>submitted</code> or <code>contacted</code>. The server sorts newest first, with ID descending as a stable tie-breaker. Pagination is <code>{ page, limit, total, pages }</code>; pages is zero when total is zero. Distinguish an empty <code>items: []</code> success from a failed read.

Use <code>Content-Type: application/json</code> for JSON requests; raw image bytes with matching Content-Type for uploads. Optional <code>X-Language: en|ar</code> controls localized form/offer DTO strings and messages. Staff/customer routes require <code>Authorization: Bearer &lt;B2B access token&gt;</code>. No Leads ownership cookie is required or consumed. A browser may send an existing Auth cookie according to its credentials/path settings; ownership is still determined from an Authorization bearer token or the draft secret. Never send a B2C bearer token. Draft GET, image upload, and submit require <code>X-Lead-Draft-Token</code>; missing/malformed values return <code>401 UNAUTHORIZED</code>. A syntactically valid but incorrect secret yields <code>409 LEAD_DRAFT_UNAVAILABLE</code> while the draft exists. Guest tracking requires <code>X-Lead-Token</code>; absent, wrong, or expired tokens return the same <code>404 LEAD_NOT_FOUND</code>.

Per-process endpoint IP limits: prepare 20 per 15 minutes; draft read and tracking 100 each per 15 minutes; image upload 30 per 15 minutes; submit 20 per 15 minutes. All routes also use API IP 240/minute; successfully authenticated customer/staff calls use store/account 120/minute. Customer image uploads additionally use 30/store-account/15 minutes across tokens/sessions/IPs. Guests use IP budgets and their private draft credential. Failures return 429 TOO_MANY_REQUESTS; RateLimit, RateLimit-Policy and Retry-After are exposed to allowed origins. Respect Retry-After and preserve draft/receipt state. All counters remain process-local; share them before scaling out.

## Prepare and resume a draft

### <code>POST /api/v1/b2b/leads/drafts</code>

Request JSON has one required field, <code>formType</code> (string, one of the five identifiers above). The selected form must currently be published and available to the public. This does not save contact answers or bind a guest by email.

Request:
~~~json
{ "formType": "fabric" }
~~~

The <code>201</code> response <code>data</code> has:

| Field | Type | Meaning and retention |
| --- | --- | --- |
| <code>draftId</code> | 24-character hexadecimal string | Server-created draft ID; retain for reads, uploads, and submit. |
| <code>draftToken</code> | 43-character base64url string | Secret generated from 32 random bytes; retain securely and send as <code>X-Lead-Draft-Token</code> on protected draft operations. |
| <code>formType</code> | Supported form identifier | Selected type, fixed for this draft. |
| <code>expiresAt</code> | ISO-8601 UTC timestamp | Deadline, 24 hours after creation. Start a new draft after expiry. |

The ID is not a credential. The token is returned only at creation; the server persists its SHA-256 hash. A later GET does not return the token.

### <code>GET /api/v1/b2b/leads/drafts/:draftId</code>

Path <code>draftId</code> is required and must be a Mongo ObjectId (24 hex digits). Send the retained draft token header. <code>data</code> contains <code>draftId</code>, <code>formType</code>, and <code>expiresAt</code> as above, <code>images</code> (ready references <code>{ id, width, height }</code>), and <code>uploadingCount</code> (integer count of uploads in progress). Failed/expired images do not appear. At most five image slots can be reserved per draft, including uploads in progress.

Empty draft example (<code>data</code>):
~~~json
{
  "draftId": "111111111111111111111111",
  "formType": "fabric",
  "expiresAt": "2026-10-13T12:00:00.000Z",
  "images": [],
  "uploadingCount": 0
}
~~~

## Private image upload and ownership

### <code>POST /api/v1/b2b/leads/drafts/:draftId/images</code>

Path needs a valid 24-hex <code>draftId</code>; headers need the draft token and one supported image media type: <code>image/jpeg</code>, <code>image/png</code>, or <code>image/webp</code>. Body is the raw file byte stream. Do not send JSON, base64, or multipart form data. Compressed request bodies are rejected; send uncompressed bytes. Maximum size is 5 MiB. Empty files, corrupt bytes, MIME mismatch, animated/multipage files, or images over 20 million pixels are rejected. The server rotates according to orientation, strips metadata, resizes within 1600 by 1600 without enlargement, and encodes WebP at quality 82. The response records processed width and height; byte size and original filename are not returned.

<code>201</code> response <code>data</code> is <code>{ "id": "&lt;24-hex image ID&gt;", "width": 1200, "height": 800 }</code>. Retain each returned ID and dimensions. A submitted image ID must be unique, ready, unexpired, and owned by the same draft. Upload completion is a storage write followed by a database state change; if response is lost, GET the draft and reuse an ID appearing in <code>images</code>. If it does not appear, retry with a new upload while a slot remains. Failed uploads release their reserved slot; background cleanup removes abandoned or expired objects. Image URLs and storage credentials are never returned.

If an uncertain upload is still counted by uploadingCount, wait and re-read with bounded backoff before starting another upload; do not exhaust slots by retrying the same in-flight file. There is no upload idempotency key.

Images are private. Public tracking/customer DTOs expose only <code>imageCount</code>, never image IDs or URLs. Staff DTOs expose <code>imageIds</code>, and staff may fetch each through the protected binary route. This is the selected staff-only viewing behavior. Backing storage uses the existing private Bunny adapter and <code>bunnyProof</code> configuration, but this does not establish live provider behavior.

## Submit a lead

### <code>POST /api/v1/b2b/leads</code>

Send JSON and <code>X-Lead-Draft-Token</code>. Body fields:

| Field | Required | Type and bounds | Meaning |
| --- | --- | --- | --- |
| <code>draftId</code> | Yes | 24-hex string | Draft returned by prepare. |
| <code>formVersion</code> | Yes | Non-negative safe integer | Exact current published Forms version used to render the form. Stale versions fail. |
| <code>contact</code> | Yes | Object with exactly the fields below | User-entered contact snapshot. |
| <code>answers</code> | No | Object keyed by current configurable field keys; defaults to <code>{}</code> | Configurable responses only. Fixed contact fields belong in <code>contact</code>. |
| <code>imageIds</code> | No | Array of at most five unique 24-hex IDs; defaults to <code>[]</code> | IDs returned by this draft's uploads. |
| <code>wholesaleRequests</code> | No | Array; defaults to <code>[]</code>; at most ten | Required non-empty for wholesale form; must be empty for other forms. |

<code>contact</code> requires exactly <code>name</code>, <code>phone</code>, <code>governorate</code>, and <code>district</code>; <code>email</code> is optional and nullable. No other properties are allowed.

| Contact field | Required | Accepted value and normalization |
| --- | --- | --- |
| <code>name</code> | Yes | Non-empty after trim; at most 100 characters. Stored trimmed. |
| <code>phone</code> | Yes | String at most 32 characters before normalization. Spaces, parentheses, and hyphens are removed; result must match optional leading <code>+</code> followed by 6–15 digits. |
| <code>email</code> | No | Missing, null, or empty string becomes null; otherwise trimmed, lowercased, at most 254 characters, and valid email syntax. A whitespace-only string fails HTTP validation. |
| <code>governorate</code> | Yes | Non-empty after trim; at most 150 characters. Stored trimmed. |
| <code>district</code> | Yes | Non-empty after trim; at most 150 characters. Stored trimmed. |

Each answer must match selected form's current configurable fields from [Forms](../forms/FORMS_FRONTEND.md). Unknown keys are rejected. Required unanswered values fail. Optional unanswered values should be omitted; null/empty text/select and empty multiselect count as missing. Text/textarea values are trimmed. <code>number</code> must be a finite JSON number inside its form constraints; <code>boolean</code> accepts true or false, including false for required fields; <code>select</code> must equal one configured stable choice key; <code>multiselect</code> must contain unique configured choice keys and no more than 50 values. Numeric zero is a supplied answer when within configured bounds. The Forms document defines each field's exact constraints and labels. Do not submit fixed contact keys as configurable answers.

Each wholesale row has exactly <code>offerId</code> (24-hex ID), <code>version</code> (non-negative safe integer from public offer DTO), and <code>quantity</code> (integer 1–10000 whole pouches requested). IDs must be distinct. At least one row and at most ten are required on wholesale form; other types must omit this field or send an empty array. The current offer/version must remain active and available. Quantity means complete configured pouches; offer composition defines pieces per pouch. There is no price, variant selection, subtotal, stock, or reservation. See [Wholesale](../wholesale/WHOLESALE_FRONTEND.md) for offer/product fields snapshotted.

Complete synthetic request:
~~~json
{
  "draftId": "111111111111111111111111",
  "formVersion": 3,
  "contact": {
    "name": "Example Buyer",
    "phone": "+201001234567",
    "email": "buyer@example.test",
    "governorate": "Cairo",
    "district": "Nasr City"
  },
  "answers": {
    "monthly_volume": 1200,
    "preferred_finish": "matte"
  },
  "imageIds": ["222222222222222222222222"],
  "wholesaleRequests": []
}
~~~

For a wholesale form, use the same structure with formType <code>wholesale</code> on prepared draft and a row such as <code>{ "offerId": "333333333333333333333333", "version": 2, "quantity": 4 }</code>. Example answer keys/choices must be replaced by current form values; they are illustrative, not server-configured fields.

On first success the server validates and snapshots the published form and selected offers inside the transaction that claims images, creates the lead, and completes the draft. It returns HTTP 201 with <code>data</code> containing <code>lead</code>, <code>trackingToken</code>, and <code>trackingExpiresAt</code>. The top-level success envelope does not contain internal <code>created</code>. An identical replay returns HTTP 200 with the same receipt shape and original lead snapshot. Retain the complete normalized request, draft token, and first successful guest tracking token until the result is known. The server fingerprints normalized content while ignoring object key ordering; it is not a client-provided idempotency key. Guest tracking tokens are deterministic from the server HMAC secret and submission identity. If that server secret changes, an identical replay may return <code>trackingToken: null</code> because its recomputed candidate no longer matches the stored hash; the previously issued token still works for tracking because the tracking route compares it with the stored token hash and does not recompute it from the HMAC secret. The original expiry stays fixed, and replay does not extend or rotate it.

<code>data.lead</code> on submit and public tracking contains:

| Field | Type / null behavior | Meaning |
| --- | --- | --- |
| <code>id</code> | 24-hex string | Lead ID; retain for tracking/account reads. |
| <code>formType</code> | Supported form identifier | Original selected type. |
| <code>status</code> | <code>submitted</code> or <code>contacted</code> | Current staff workflow status. |
| <code>contact</code> | Object; email always string or null | Normalized submitted contact snapshot, not live profile data. |
| <code>form</code> | Full saved definition snapshot | <code>id</code>, <code>type</code>, <code>title</code>, <code>helpText</code>, <code>isActive</code>, <code>version</code>, <code>fixedFields</code>, <code>fields</code>. Nested definitions/choices include <code>key</code>, <code>type</code>, localized <code>label</code>, <code>required</code>, <code>choices</code>, and <code>constraints</code>. Historical snapshot is unchanged by future edits. Public labels/title/help text are localized strings with fallback to other language. |
| <code>answers</code> | Object | Validated answer keys/values; text/textarea trimmed and unanswered optional values absent. |
| <code>wholesaleRequests</code> | Array; empty for non-wholesale leads | Selected offer snapshots with requested pouch quantity. |
| <code>imageCount</code> | Integer 0–5 | Count of attached images; IDs hidden from submitter. |
| <code>createdAt</code> | ISO-8601 UTC timestamp | Server creation time. |
| <code>contactedAt</code> | ISO timestamp or null | Server time staff first marked contacted. |

The <code>form</code> object has the following complete shape. On guest/customer reads and submission receipts, localized labels/title/help text are strings selected by <code>X-Language</code> (default language is shared API configuration) with fallback to the other language. Dashboard reads have no locale projection and return bilingual <code>{ ar, en }</code> objects. This difference also applies recursively to field and choice labels.

| Form field | Type / bounds | Meaning, source, null/omission, and retention |
| --- | --- | --- |
| <code>id</code> | String, 24-hex identifier | Form record ID from Forms; stable for the definition record. |
| <code>type</code> | String enum | One of <code>spinning</code>, <code>weaving</code>, <code>fabric</code>, <code>school-uniforms</code>, <code>wholesale</code>; equals lead <code>formType</code>. |
| <code>title</code> | Localized string or bilingual object | Current title copied into the immutable submission snapshot. |
| <code>helpText</code> | Localized string or bilingual object; may be empty | Current help copy copied into snapshot. |
| <code>isActive</code> | Boolean | Was true when accepted; snapshot records that state and does not track later publication changes. |
| <code>version</code> | Non-negative integer | Exact Forms version accepted; equal to submitted <code>formVersion</code>. Retain for interpreting this historical form. |
| <code>fixedFields</code> | Exactly five field objects, in fixed order | Server-defined contact fields below. These do not come from configurable form answers. |
| <code>fields</code> | Array of 0–40 configurable field objects | Current administrator-configured fields, snapshotted at submit. Empty array is valid. |

Each object in <code>fixedFields</code> and <code>fields</code> has the following properties; keys are stable machine names and labels are presentation text.

| Nested field property | Type / bounds | Meaning and source |
| --- | --- | --- |
| <code>key</code> | String, 1–40 characters; regex <code>^[a-z][a-z0-9_-]{0,39}$</code> for configurable keys | Unique answer/contact key. Configurable keys cannot reuse the five reserved fixed keys. Retain exactly for mapping <code>answers</code>. |
| <code>type</code> | Fixed type or one of six configurable types | Fixed fields use <code>text</code>, <code>phone</code>, <code>email</code>; configurable fields use <code>text</code>, <code>textarea</code>, <code>number</code>, <code>select</code>, <code>multiselect</code>, or <code>boolean</code>. |
| <code>label</code> | Localized string or bilingual <code>{ ar, en }</code> object | Fixed labels are server constants; configurable labels come from saved form definition. Render as text, not HTML. |
| <code>required</code> | Boolean | For configurable fields, controls whether an answer may be absent. Fixed flags are server-owned and do not change by form. |
| <code>choices</code> | Array; empty for fixed/non-choice fields; select/multiselect has 1–50 entries | Each choice has <code>key</code> and localized <code>label</code>. Choice keys are stable values submitted in answers; labels can change later without changing a saved lead snapshot. |
| <code>constraints</code> | Object; properties depend on type | Server-provided UI and validation bounds listed below. Missing constraints are not null; select/boolean use an empty object. |

Each configurable field's <code>choices[]</code> row (used only by select/multiselect) has this exact shape:

| Choice property | Type / bounds | Meaning, source, and retention |
| --- | --- | --- |
| <code>key</code> | Unique string within that field; 1–40 characters matching lowercase letter followed by lowercase letters, digits, underscore, or hyphen | Stable machine value submitted in <code>answers</code>. It comes from saved Forms configuration; retain the exact key if the display label later changes. |
| <code>label</code> | Localized string or bilingual <code>{ ar, en }</code> object; each configured translation is required, non-empty, and at most 150 characters | Saved Forms display text, localized for customer/guest reads and bilingual for dashboard reads. Render as text. |

The fixed fields are always present in this order. The <code>email</code> field is optional; the other four are required.

| Fixed key | Type | Required | Submitted value bound and meaning |
| --- | --- | --- | --- |
| <code>name</code> | <code>text</code> | Yes | Trimmed non-empty string, maximum 100 characters; contact name. |
| <code>phone</code> | <code>phone</code> | Yes | Maximum 32 characters before normalization; normalized number must be optional plus sign and 6–15 digits. |
| <code>email</code> | <code>email</code> | No | Missing, null, or empty becomes null. Otherwise trimmed/lowercase valid email, maximum 254 characters. Whitespace-only HTTP value is invalid. |
| <code>governorate</code> | <code>text</code> | Yes | Trimmed non-empty string, maximum 150 characters. |
| <code>district</code> | <code>text</code> | Yes | Trimmed non-empty string, maximum 150 characters. |

Configurable field constraints and answer values are:

| Type | Answer JSON type and accepted value | Exact <code>constraints</code> object |
| --- | --- | --- |
| <code>text</code> | String; server trims it; supplied length must be 1–500 characters. | <code>{ "minLength": 1, "maxLength": 500 }</code> |
| <code>textarea</code> | String; server trims it; supplied length must be 1–5000 characters. | <code>{ "minLength": 1, "maxLength": 5000 }</code> |
| <code>number</code> | Finite JSON number, inclusive bounds -1,000,000,000 through 1,000,000,000. Zero and decimals are valid when within range. | <code>{ "min": -1000000000, "max": 1000000000 }</code> |
| <code>select</code> | One string exactly equal to a configured choice key. | <code>{}</code> |
| <code>multiselect</code> | Array of distinct strings, each exactly a configured choice key; 1–50 values when supplied. | <code>{ "minItems": 1, "maxItems": 50, "uniqueItems": true }</code> |
| <code>boolean</code> | JSON boolean; both true and false are values, including for a required field. | <code>{}</code> |

An optional unanswered field is omitted from <code>answers</code>. Null, empty text/textarea/select, and an empty multiselect count as missing; required missing values fail. A supplied optional number equal to zero and boolean false are not missing. Answers contain only configurable field keys; the fixed contact values are in <code>contact</code>.

Every <code>wholesaleRequests[]</code> snapshot includes <code>id</code>, localized <code>name</code>/<code>description</code>, <code>sourceStore</code>, <code>productId</code>, <code>composition[]</code> (<code>variantId</code> string or null and integer piece <code>quantity</code>), derived <code>piecesPerPouch</code>, <code>isActive</code>, <code>isAvailable</code>, <code>product</code> object or null, <code>version</code>, and requested <code>quantity</code> (whole pouches). <code>product</code> includes <code>id</code>, <code>type</code>, localized <code>name</code>/<code>description</code>, <code>images[]</code>, <code>options[]</code>, and <code>variants[]</code> as in Wholesale's public projection. Option/value names are localized strings. Simple products have empty options/variants and null composition variant IDs; variant products include selected variant IDs and values. These are snapshots: later offer/source edits do not rewrite the lead.

The exact selected wholesale offer object fields are:

| Offer snapshot field | Type / null behavior | Source and meaning |
| --- | --- | --- |
| <code>id</code> | 24-hex string | Saved wholesale offer ID, copied from current public offer. |
| <code>name</code>, <code>description</code> | Localized strings for public/customer DTOs; bilingual objects on dashboard DTOs | Offer's saved display text at submit time. Description may be empty. |
| <code>sourceStore</code> | <code>b2c</code> or <code>b2b</code> | Identifies which catalog owns the source product. |
| <code>productId</code> | 24-hex string | Source product identifier. |
| <code>composition</code> | Array of 1–100 distinct composition rows | Offer's configured pieces per pouch, copied as <code>{ variantId, quantity }</code>. Each variantId is a distinct 24-hex string or null for a simple product; each piece quantity is an integer 1–10000. A simple product has exactly one null-variant row; a variant product has non-null variant IDs. |
| <code>piecesPerPouch</code> | Integer 1–1,000,000 | Sum of composition row piece quantities; computed by server from at most 100 rows, each capped at 10000. |
| <code>isActive</code> | Boolean | Saved offer active flag at submission; valid selections are true. |
| <code>isAvailable</code> | Boolean | Computed as active offer plus a valid composition against the source projection. A B2C source projection is supplied only for an active product in a visible category; a B2B source must be an available native product. A successful submission requires true. This is not a stock or inventory claim. |
| <code>product</code> | Product projection; nullable in the general Wholesale DTO | Current B2B native-product or B2C read-only source projection, copied at submission. For a successfully selected submission offer it is present because a missing projection makes the offer unavailable. |
| <code>version</code> | Non-negative integer | Current saved offer version supplied by client and revalidated at submission. |
| <code>quantity</code> | Integer 1–10000 | Customer's requested count of whole pouches. This is added by Leads and is not a catalog offer field. |

Stable Wholesale URL fields `slug` and `slugAliases` are intentionally excluded from Lead submission snapshots. Snapshot identity remains the offer ID and saved version; URL changes do not rewrite historical inquiries. A slug-only offer PATCH increments the offer version, so a pending selection may receive the existing `409 WHOLESALE_CONFLICT` and must be refreshed and reviewed by the customer.

The nested <code>product</code> fields are:

| Product field | Type / null behavior | Source and meaning |
| --- | --- | --- |
| <code>id</code> | 24-hex string | Source product ID. |
| <code>type</code> | <code>simple</code> or <code>variant</code> | Source catalog product type. Native B2B products use <code>simple</code>. |
| <code>name</code>, <code>description</code> | Localized strings for public/customer DTOs; bilingual objects on dashboard | Source product text at submission. Description may be empty. |
| <code>images</code> | Array of 0–10 image DTOs | Public catalog images from the source product, not private lead attachments. Each image has <code>id</code> (24-hex catalog image ID), <code>url</code> (catalog display URL), <code>width</code>, and <code>height</code> (integers 1–1600). These are existing public product-image DTOs; do not treat their URL as a credential. |
| <code>options</code> | Array; empty for simple products, 1–5 entries for variant source | Each entry has <code>key</code>, localized <code>name</code>, and ordered <code>values</code> array of 1–50 entries. |
| <code>options[].key</code> | String, 1–40 characters; starts lowercase a–z, then lowercase letters/digits/underscore/hyphen | Stable machine key from source option definition; unique within product. |
| <code>options[].name</code> | Localized string or bilingual object; source label max 200 characters | Human-readable option name, such as Size. |
| <code>options[].values[]</code> | Object with <code>key</code> and <code>name</code> | One configured option value. Its key is 1–40 characters, starts lowercase letter or digit, then lowercase letters/digits/underscore/hyphen; keys are unique within that option. Name is localized/bilingual, up to 200 characters. |
| <code>variants</code> | Array; empty for simple products, 1–100 entries for variant source | Source variants in the projection. |
| <code>variants[].id</code> | 24-hex string | Stable source variant ID used in offer composition; not a Lead image ID. |
| <code>variants[].values</code> | Object from option key to option-value key | Contains exactly one selected value for every option, using the stable keys above. Values are not localized labels. |
| <code>variants[].images</code> | Array of up to 10 public catalog image DTOs | Variant gallery when it has images; otherwise falls back to product-level <code>images</code>. Each DTO has <code>id</code>, <code>url</code>, <code>width</code>, and <code>height</code>. |

Lead attachment privacy is separate from <code>product.images</code>: uploaded request images are stored privately, listed only by staff DTO <code>imageIds</code>, and fetched only through the authenticated dashboard image endpoint. Their public/customer DTO contains only <code>imageCount</code>; no attachment URL is present. Catalog image URLs above are normal source-product display images and may appear in these snapshots.

### End-to-end value handoff and retained state

| Source response/value | Later request field/path/header | Retain, expiry, and recovery |
| --- | --- | --- |
| Public Forms `type` and `version` | `POST /drafts` JSON `formType`; final `POST /leads` JSON `formVersion`. | Keep type/version with the exact rendered definition and answers. A draft has its own `formType`, but does not freeze the form version. If `FORM_CONFLICT` occurs, reload the active definition and ask the user to review answers. |
| `form.fields[].key`, `.type`, `.constraints` | `POST /leads` JSON `answers` object: property name is the exact field key and value is that type's JSON value. | Keep with the rendered version. Text/textarea are trimmed strings; number stays a finite JSON number (including zero); boolean stays a JSON boolean (including false); select uses one configured choice key; multiselect uses an array of unique choice keys. Omit unanswered optional keys; do not send null or empty values as substitutes. |
| `form.fields[].choices[].key` and localized label | Choice key is the submitted answer value; label is display-only. | Keep stable keys, not labels. The accepted submission snapshots the full bilingual form definition even though the submit/tracking/customer response localizes labels and title/help text; staff DTOs return bilingual objects. Answers remain key/value data and are not rewritten when published labels later change. |
| Fixed form field keys and user-entered values | `POST /leads` JSON `contact` properties `name`, `phone`, optional `email`, `governorate`, `district`. | Values originate in this form or editable frontend prefill; there is no profile ID or address ID in the request. Server trims/normalizes contact as documented above. |
| Prepare response `draftId`, `draftToken`, `expiresAt` | `draftId` path in draft GET/upload; body `draftId` on submit; secret header `X-Lead-Draft-Token` on draft GET, upload, and submit. | Keep ID and secret together in private client state for at most 24 hours. The ID alone grants no access. The secret is returned only once and cannot be refreshed; expired/submitted drafts cannot accept a new submission. |
| Draft GET `images[].id` (with width/height) | Include each selected ready ID in submit JSON `imageIds[]`. | This array is the usable ready-upload list, not a count. `uploadingCount` counts in-progress uploads only and supplies no IDs; it is not an uploaded-image count and must never be converted into `imageIds`. Re-read the draft after uncertain upload and wait for completion before selecting. |
| Upload response `data.id` (with processed dimensions) | Submit JSON `imageIds[]`; after submission, the same attached private IDs appear only in staff lead DTO `imageIds[]`, consumed by `GET /api/v1/admin/b2b/leads/:leadId/images/:imageId`. | Upload success creates a private ready image; only successful submission attaches selected IDs. Public/customer `imageCount` is the number attached to the Lead, not upload count, draft slot count, or `uploadingCount`. At most five slots include in-flight uploads; there is no delete or renew endpoint. |
| Public offer `id`, `version`; customer-entered pouch count | Each `wholesaleRequests[]` row uses `offerId`, `version`, and `quantity`. | Retain these values with the customer's selection until receipt/replay is known. Current offer/version is revalidated at submit. Stale or unavailable offers require a fresh offer read and customer review; quantity is a whole pouch count, while snapshotted composition/piecesPerPouch describe contents per pouch. |
| Submit receipt `lead.id`, `trackingToken`, `trackingExpiresAt` | Guest uses `GET /api/v1/b2b/leads/tracking/:leadId` with `lead.id` in the path and token in `X-Lead-Token`. B2B users instead use authenticated `GET /api/v1/b2b/leads` and `/api/v1/b2b/leads/:leadId`. | Store a non-null guest token privately and securely; it is not a URL parameter. Guest tracking ends at its returned fixed 90-day expiry; account reads have no guest-token expiry. Identical replay can return null after signing-secret rotation, so preserve the first issued token. |
| Staff lead `imageIds[]` | Authenticated binary GET `/api/v1/admin/b2b/leads/:leadId/images/:imageId` for each ID. | These are private attached Lead images, distinct from catalog `product.images[].id` and B2B Media upload IDs. Use only the returned staff IDs and revoke temporary browser object URLs after display. |

Example complete non-wholesale receipt data with a localized <code>en</code> response, no configurable fields, no answers, and no attachments:
~~~json
{
  "lead": {
    "id": "666666666666666666666666",
    "formType": "fabric",
    "status": "submitted",
    "contact": {
      "name": "Example Buyer",
      "phone": "+201001234567",
      "email": null,
      "governorate": "Cairo",
      "district": "Nasr City"
    },
    "form": {
      "id": "777777777777777777777777",
      "type": "fabric",
      "title": "Fabric",
      "helpText": "",
      "isActive": true,
      "version": 3,
      "fixedFields": [
        { "key": "name", "type": "text", "label": "Name", "required": true, "choices": [], "constraints": { "minLength": 1, "maxLength": 100 } },
        { "key": "phone", "type": "phone", "label": "Phone", "required": true, "choices": [], "constraints": { "maxLength": 32 } },
        { "key": "email", "type": "email", "label": "Email", "required": false, "choices": [], "constraints": { "maxLength": 254 } },
        { "key": "governorate", "type": "text", "label": "Governorate", "required": true, "choices": [], "constraints": { "minLength": 1, "maxLength": 150 } },
        { "key": "district", "type": "text", "label": "District / area", "required": true, "choices": [], "constraints": { "minLength": 1, "maxLength": 150 } }
      ],
      "fields": []
    },
    "answers": {},
    "wholesaleRequests": [],
    "imageCount": 0,
    "createdAt": "2026-10-12T10:00:00.000Z",
    "contactedAt": null
  },
  "trackingToken": "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg",
  "trackingExpiresAt": "2027-01-10T10:00:00.000Z"
}
~~~

Example complete <code>wholesaleRequests[]</code> entry for a selected simple B2B catalog offer with one public product image. Identifiers, URL, dimensions, text, and version are synthetic; request-image attachments are not part of <code>product.images</code>.
~~~json
{
  "id": "888888888888888888888888",
  "name": "30-shirt pouch",
  "description": "Thirty plain shirts",
  "sourceStore": "b2b",
  "productId": "999999999999999999999999",
  "composition": [{ "variantId": null, "quantity": 30 }],
  "piecesPerPouch": 30,
  "isActive": true,
  "isAvailable": true,
  "product": {
    "id": "999999999999999999999999",
    "type": "simple",
    "name": "Wholesale shirt",
    "description": "Plain cotton shirt",
    "images": [{ "id": "aaaaaaaaaaaaaaaaaaaaaaaa", "url": "https://images.example.test/catalog/shirt.webp", "width": 1200, "height": 1200 }],
    "options": [],
    "variants": []
  },
  "version": 2,
  "quantity": 4
}
~~~

This example shows the public/customer localized DTO. Dashboard DTOs use bilingual objects for offer/product labels. A variant-product source uses each option as <code>{ key, name, values: [{ key, name }] }</code>; each variant has <code>{ id, values, images }</code>, where <code>values</code> maps stable option keys to stable choice keys and <code>images</code> is the variant image array or product-image fallback. Both projections omit prices, stock, SKU, and retail availability numbers.

<code>data.trackingToken</code> is a 43-character base64url guest secret, or null for a B2B user lead. <code>data.trackingExpiresAt</code> is an ISO timestamp 90 days after guest submission, or null for a user lead. The token is returned only in the successful receipt. Store it securely and show it in the guest acknowledgment. Configured customer email now delivers a private tracking link through the [email infrastructure](../../shared/infrastructure/email/EMAIL_DELIVERY_FRONTEND.md); the frontend must not send tokens through a separate email provider. Web push remains deferred. Customer-owned leads use B2B authentication and have no guest tracking token. Retain the first non-null token: a replay can return null after server HMAC-secret rotation, and successful replay never rotates or extends the original token/expiry.

On ambiguous timeout, retry the exact same request with the same draft ID/token. Matching replay before guest expiry returns HTTP 200 and the same lead; changed normalized content returns <code>409 LEAD_REQUEST_CONFLICT</code>. Guest replay at/after <code>trackingExpiresAt</code> returns <code>404 LEAD_NOT_FOUND</code> even if the original submission succeeded. Account replay remains available while the B2B account/session is valid. Do not create another draft after uncertain submit until the result is reconciled.

Unknown prepare-body properties are ignored. For submission, root userId/store/status/contactedBy/formSnapshot/trackingToken/imageUrls properties are explicitly rejected with 422 VALIDATION_ERROR; other unknown root properties are ignored by the request whitelist. Unknown contact/selection properties and unknown answer keys are rejected by service validation. Optional answers/imageIds/wholesaleRequests may be omitted but cannot be JSON null at the HTTP boundary. Select keys are exact strings without trimming/case conversion; number/boolean answers are not coerced from strings. Object key order is ignored by replay matching, but image/offer/multiselect array order is retained. Path and submitted ID values accept uppercase hexadecimal and normalize to lowercase.

Snapshot catalog image URLs are ordinary public source images, not retained private copies. Later catalog image replacement/cleanup can make an old URL unavailable; render a missing-image fallback while preserving the original textual snapshot. Source product projections include all projected variants, while composition selects the variants actually contained in that pouch.

## Track and read leads

### <code>GET /api/v1/b2b/leads/tracking/:leadId</code>

<code>leadId</code> is a required 24-hex path parameter and <code>X-Lead-Token</code> is required. This public route has a 100-per-15-minute IP limit. It authenticates only X-Lead-Token; an Authorization header is ignored on this tracking endpoint. It returns the public lead DTO above; images appear only as <code>imageCount</code>. Missing lead, customer-owned lead, incorrect token, or expired credential returns <code>404 LEAD_NOT_FOUND</code>. Tracking does not renew expiry.

### <code>GET /api/v1/b2b/leads</code> and <code>GET /api/v1/b2b/leads/:leadId</code>

Both require B2B role <code>user</code>. The list accepts shared Leads filters and returns <code>{ items, pagination }</code>; it scopes results to authenticated user ID regardless of query. Items use customer DTO (no <code>userId</code>, <code>contactedBy</code>, or <code>imageIds</code>). Empty list is <code>{ "items": [], "pagination": { "page": 1, "limit": 20, "total": 0, "pages": 0 } }</code>. Detail returns one customer DTO or <code>404 LEAD_NOT_FOUND</code> for absent/other-owned leads. These durable customer reads do not have guest tracking expiry.

### <code>GET /api/v1/admin/b2b/leads</code> and <code>GET /api/v1/admin/b2b/leads/:leadId</code>

Require <code>superAdmin</code>, <code>admin</code>, or <code>moderator</code>. Lists are dashboard-wide, sorted newest first, with the same filters/pagination. Detail returns a staff DTO or <code>404 LEAD_NOT_FOUND</code>. Staff DTO adds <code>userId</code> (24-hex string or null for guest), <code>contactedBy</code> (staff account ID or null), and <code>imageIds</code> (attached IDs) to the public DTO. Dashboard labels are bilingual <code>{ ar, en }</code> objects, not localized strings. Never expose staff-only fields in guest/customer views.

## Staff image read and contacted action

### <code>GET /api/v1/admin/b2b/leads/:leadId/images/:imageId</code>

Requires <code>superAdmin</code>, <code>admin</code>, or <code>moderator</code>; both path IDs are valid 24-hex Mongo IDs. Success returns <code>Content-Type: image/webp</code>, <code>X-Content-Type-Options: nosniff</code>, and private processed image bytes, with no JSON envelope. Image must be attached to specified lead. Missing lead/image or an image not attached to that lead returns <code>404 LEAD_IMAGE_NOT_FOUND</code>. Never accept a client object key or construct a public URL. Render fetched bytes in authenticated staff view and revoke temporary browser object URLs when done.

### <code>PATCH /api/v1/admin/b2b/leads/:leadId/contacted</code>

Requires staff role and valid 24-hex <code>leadId</code>. Takes no body. First call atomically changes <code>submitted</code> to <code>contacted</code>, stores server time in <code>contactedAt</code>, staff actor in <code>contactedBy</code>, and writes an audit record. Repeating after already contacted returns current staff DTO without changing original attribution/time or writing another transition. Success data is the complete staff lead DTO. A racing transition returns <code>409 LEAD_STATUS_CONFLICT</code>; reload detail. There is no notes, assignment, quote, or contact-event API.

## Errors and recovery

All JSON errors use shared envelope: <code>success:false</code>, stable <code>code</code>, localized <code>message</code>, <code>errors</code> array, and <code>requestId</code>; no <code>data</code>. Validator errors include <code>field</code>, <code>location</code>, <code>code</code>, and localized <code>message</code>. Service validation may have empty errors. Preserve user input and requestId; do not parse translated messages. Shared transport errors are detailed in [API conventions](../../../../docs/frontend/api-conventions.md).

| HTTP | Code | Trigger and recovery |
| --- | --- | --- |
| 400 | <code>INVALID_JSON</code> | Malformed JSON; fix serialization. |
| 400 | <code>INVALID_STORE</code> | Internal store routing error; not expected on documented B2B URL. |
| 401 | <code>UNAUTHORIZED</code> | Missing/invalid B2B auth on protected routes, or absent/malformed draft token. Omit optional Authorization only to act as guest intentionally. |
| 403 | <code>FORBIDDEN</code> | Role not permitted; staff cannot use guest/customer draft route and customers cannot use dashboard. Refresh cannot grant a role. |
| 403 | <code>CORS_DENIED</code> | Origin not configured. Browser may expose only a network failure. |
| 404 | <code>NOT_FOUND</code> | Wrong URL/method; verify route. |
| 404 | <code>FORM_NOT_FOUND</code> | Form unpublished/retired or unavailable; reload Forms and choose an available form. |
| 404 | <code>LEAD_NOT_FOUND</code> | Missing/foreign lead, wrong/expired tracking token, or guest replay after tracking expiry. Cases intentionally indistinguishable. |
| 404 | <code>LEAD_IMAGE_NOT_FOUND</code> | Staff image does not belong to lead or was removed; reload lead. |
| 409 | <code>LEAD_DRAFT_UNAVAILABLE</code> | Draft expired, submitted, missing, or token mismatch. Resolve uncertain submission before starting another draft; credentials cannot be renewed. |
| 409 | <code>LEAD_REQUEST_CONFLICT</code> | Draft already has a different normalized submission. Do not overwrite original; recover through tracking/account list. |
| 409 | <code>LEAD_IMAGE_LIMIT</code> | Five slots reserved. Reuse ready images or start a new draft after resolving submission; no image-delete endpoint. |
| 409 | <code>LEAD_IMAGE_CONFLICT</code> | Image missing, expired, not ready, claimed, or from another draft. Refresh image list and retry upload if a slot remains. |
| 409 | <code>LEAD_STATUS_CONFLICT</code> | Concurrent staff transition; reload detail. |
| 409 | <code>FORM_CONFLICT</code> | Form version stale or changed during submit. Read current public form and have user review answers; do not silently remap. |
| 409 | <code>WHOLESALE_CONFLICT</code> | Offer version stale. Reload offers and have user review changed pouch. |
| 409 | <code>WHOLESALE_SOURCE_UNAVAILABLE</code> | Offer/source no longer active or visible. Refresh and require current selection. |
| 422 | <code>VALIDATION_ERROR</code> | Path/query/validator shape error; read errors[] and correct indicated location. |
| 422 | <code>INVALID_LEAD</code> | Invalid contact, answer, image list, version shape, or selection structure. Errors may be empty. Preserve input and correct against current definitions. |
| 413 | <code>BODY_TOO_LARGE</code> | JSON exceeds shared 100 KiB or image exceeds 5 MiB. Reduce request/file. |
| 415 | <code>IMAGE_TYPE_UNSUPPORTED</code> | Not JPEG, PNG, or WebP. Select supported file and matching header. |
| 415 | <code>UNSUPPORTED_ENCODING</code> | Unsupported encoding/charset. Send uncompressed raw image bytes. |
| 422 | <code>INVALID_IMAGE</code> | Empty/corrupt/MIME-mismatched/animated/too many pixels/undecodable image. Choose valid still image. |
| 429 | <code>TOO_MANY_REQUESTS</code> | Route IP limit reached. Respect rate headers and wait. |
| 500 | <code>INTERNAL_ERROR</code> | Unexpected database/audit/application error. Keep input/requestId; if submit uncertain, replay only exact request/token before guest expiry. |
| 502 | <code>LEAD_STORAGE_FAILED</code> | Private storage operation failed. Preserve input; after uncertain upload, GET draft before retry. |
| 503 | <code>LEAD_STORAGE_UNAVAILABLE</code> | Private storage unconfigured/unavailable or zone changed. Text-only submit can still work; retry image operations after recovery. |
| 503 | <code>TRANSACTIONS_REQUIRED</code> | Database lacks transaction support. Deployment must be fixed; retries cannot repair it. |

On browser timeout/rejection there may be no response body. Preserve input and credentials. Prefer safe GET, account list, tracking read, or exact replay to creating a second request. Keep guest tokens out of URLs and do not cache private data across users.

## User flows and retained state

1. Load published definition through Forms and, for wholesale, public Wholesale offers. Keep exact form <code>type</code>/<code>version</code>; keep each selected offer <code>id</code>, <code>version</code>, and desired whole-pouch <code>quantity</code>. Display current fields and available offers.
2. Create a draft. Securely retain <code>draftId</code>/<code>draftToken</code> with entered contact/answers. API provides no recovery by account, email, or cookie.
3. Upload optional images as raw bytes. Retain returned IDs/dimensions, never a public URL. Use GET draft to reconcile uncertain upload outcomes.
4. Submit with displayed form version, contact, answers, image IDs, and wholesale selections only for wholesale form. Preserve whole request until receipt is confirmed.
5. For a guest, show and securely retain returned tracking token/expiry; screen remains the immediate delivery channel. Configured email may deliver the same private link asynchronously; do not wait for it before showing success. Track using the token header. SMS, web push, token recovery and renewal are not implemented.
6. In dashboard, load/filter/page leads. Render saved form snapshot and answers, not today's definition. Fetch images through authenticated staff binary GET. After offline follow-up, call contacted and use returned attribution/time.

Draft expiry is logically enforced at exactly 24 hours by every draft operation; MongoDB TTL deletion is asynchronous and should not be treated as the expiry check. Each image row gets its own 24-hour deadline from its upload reservation. The upload PUT runs outside the database transaction and has a 15-second provider request timeout. If the PUT fails, its row becomes failed and its draft slot is released; cleanup can remove the failed object/row after that row's own 24-hour deadline. If the PUT succeeds after the draft has expired, the row becomes delete-pending rather than ready. A successful submission marks selected images attached and, in the same transaction, marks any remaining ready images delete-pending so cleanup can remove them. A periodic cleanup task runs hourly when private Bunny configuration exists; provider deletion failures remain durable cleanup work for retry. Attached images have no expiry cleanup, and Lead records have no TTL. A guest lead can be tracked for 90 days. Snapshots remain readable through staff/customer account paths; public guest tracking ends at expiry. Customer leads have no expiry on authenticated reads. There is no draft or individual draft-image deletion API. Concurrent upload/submission is guarded by transactional state checks; conflicts require refresh or user review.

## Integration status and verification

Customer submission/contacted emails are implemented through shared SMTP delivery when configured, using optional submitted contact.email; SMTP inbox arrival is not guaranteed by submission success. A successful first submission also commits one B2B staff arrival record through [Notifications](../notifications/NOTIFICATIONS_FRONTEND.md), independently of email configuration. Web push is deferred. Full field definitions and offer/product projection constraints are in linked Forms and Wholesale documents. Shared envelope, headers, cookie conventions, pagination, and transport errors are in API conventions.

Source inspection confirms all 11 mounted routes and the contract above. Focused Leads service/HTTP/private-storage checks passed 10 tests. The full suite passed 135 tests with one opt-in database test skipped, and syntax checks passed 165 JavaScript files. The authorized disposable MongoDB integration passed one test covering parallel submission/token replay, audit rollback and contact races, image attachment/staff read/retention, the five-image concurrency limit, cleanup, wholesale reference protection, immutable offer snapshots, and 90-day tracking/replay expiry; teardown verified disposable collections were removed. Bunny storage was not configured in the local environment, and no provider request was made. Live Bunny, deployed TLS/CORS, and browser/device acceptance remain unverified.

## Customer email side effects — 2026-10-12

Read the [complete email delivery contract](../../shared/infrastructure/email/EMAIL_DELIVERY_FRONTEND.md). No Lead endpoint, submission/response field or permission changed. With SMTP and B2B_TRACKING_URL_TEMPLATE configured, a first successful submission with non-null contact.email queues lead.submitted, and the first submitted → contacted transition queues lead.contacted. Optional email remains optional: omission/null/empty string means no email job, including for authenticated users whose profile has an email. The immutable submitted contact email is the recipient; profile edits do not redirect it.

Language is taken from the first successful submission and persisted internally; later staff language and replay language do not replace it. Matching submit/contact retries do not create another email. Queue insertion shares the existing submission/contact transaction and rolls it back on insertion failure. SMTP delivery happens afterward and never undoes a committed Lead/contact action. The response exposes no email state/sent flag; show and retain the receipt immediately rather than waiting for email.

Guest links use the existing 90-day tracking token in a URL fragment; frontend JavaScript sends X-Lead-Token to the existing tracking route. Account links have an empty token value and require customer JWT/account detail flow. Key rotation or token expiry does not generate a replacement/extended credential: the email is sent without a tracking URL and directs the recipient to a saved unexpired link or staff. Original issued links retain their original expiry.

Messages contain the request reference, recorded status/time and customer name; answers, phone/location, image IDs/bytes/URLs and staff attribution are excluded. Delivery can be delayed, repeated after an uncertain SMTP acknowledgment, or arrive out of order; latest tracking/customer detail is authoritative. While the B2B template is blank, no customer email job is inserted and old events are not backfilled. Staff arrivals still commit. Email contains no recovery/resend API; lost-link recovery is offline and web push remains deferred.

## Staff arrival feed integration (2026-10-13)

Every first successful submission inserts one B2B lead.submitted staff event through [Notifications](../notifications/NOTIFICATIONS_FRONTEND.md), even when contact.email is omitted or SMTP/templates are disabled. The event shares the Lead transaction with saved snapshots, draft completion, image attachment/retirement and any eligible customer email job. Staff-event or enabled email-job insertion failure rolls back the business changes. Later SMTP failure does not.

No Lead/draft request or response field changed. Successful replay creates no second arrival, and marking contacted creates no additional arrival. B2B superAdmin/admin/moderator reads GET /api/v1/admin/b2b/notifications or /notifications/unread-count, acknowledges PATCH /notifications/:notificationId/read using notification.id, and opens GET /api/v1/admin/b2b/leads/:leadId using resource.id. Feed rows contain no contact, answer, image, tracking token or actor data.

Read acknowledgment is personal and does not mark the Lead contacted, change snapshots, or alter another staff member's badge. Offline follow-up still uses the separate contacted endpoint. A Lead detail/image request can fail independently after a successful read acknowledgment. See the linked module for precise query/DTO fields, first-read concurrency, retry and polling behavior.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.

## Branded request emails (2026-10-31)

Submitted/contacted emails use Narmer-branded English/Arabic HTML plus plain text and the supplied inline logo. Request receipt and contacted-state updates have distinct wording, without B2B/B2C brand labels. Optional contact email, saved locale, Lead ID, private fragment/header tracking and source/retry rules remain unchanged. No payment/order claim, new event, public endpoint or frontend field is added. See [email delivery](../../shared/infrastructure/email/EMAIL_DELIVERY_FRONTEND.md) for all template and packaging details.
