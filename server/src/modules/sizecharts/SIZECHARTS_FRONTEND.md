# Size Charts: complete B2C frontend contract

Implemented on 2026-10-22; extended with editable tables on 2026-10-23. Read with [Products](../products/PRODUCTS_FRONTEND.md), [Media](../media/MEDIA_FRONTEND.md), [shared conventions](../../../../docs/frontend/api-conventions.md) and [security](../../../../docs/security.md). Normal JSON success/error envelopes, ObjectId and localization conventions apply. All IDs and addresses in examples are synthetic.

## Scope, ownership and permissions

A reusable chart contains a required bilingual name, optional bilingual alternative text, an optional numeric measurement table, and up to one processed public image per language. Assign one chart to any number of B2C simple/variant products. A chart is a size-guide display asset; it never defines sellable sizes, creates variants, changes stock/prices or authorizes a Cart selection. Measurement rows are shared across English and Arabic; the frontend localizes labels and must not infer whether values describe flat garment width or circumference. There is no category-wide automatic assignment, PDF/SVG upload, B2B chart, public chart directory or separate public chart-detail route.

B2C superAdmin/admin can list, read, create, edit and upload. Only superAdmin can permanently delete, and any assigned product (active or inactive) blocks deletion. Moderators/customers receive 403; missing/invalid/wrong-store bearer receives 401. All management routes set Cache-Control:no-store, including authentication failures. Public products expose only the localized chart projection below. Images are public Bunny catalog assets; never use this upload for private documents or payment proof.

## Every endpoint

| Method and exact path | Input | Success and data |
| --- | --- | --- |
| GET /api/v1/admin/b2c/size-charts | Optional list queries below, no body | 200; {items:[AdminSizeChart],pagination} |
| POST /api/v1/admin/b2c/size-charts | JSON create body | 201; AdminSizeChart |
| GET /api/v1/admin/b2c/size-charts/:chartId | Existing chart ID, no body/query controls | 200; AdminSizeChart |
| PATCH /api/v1/admin/b2c/size-charts/:chartId | Existing chart ID, JSON edit body with current version | 200; complete updated AdminSizeChart |
| DELETE /api/v1/admin/b2c/size-charts/:chartId | Existing chart ID, no body/version/query; superAdmin only | 200; data:null |
| POST /api/v1/admin/b2c/size-charts/:chartId/images/:language | Existing chart ID, en/ar language, one raw image | 201; public Image {id,url,width,height}; not automatically attached |

All routes require Authorization: Bearer <B2C accessToken>, from successful B2C login/refresh. Native Apidog uses Bearer {{JWT}}. No refresh/cart cookie or additional Origin ownership gate identifies a chart, but browser CORS must still allow the frontend origin. JSON POST/PATCH uses Content-Type:application/json; upload uses the actual image MIME. X-Language/Accept-Language selects messages; management name/alt remain bilingual regardless of message language. There is no ownerId/store input: store comes from the B2C route.

Path chartId is a server-issued 24-hex ObjectId, normalized lowercase. Obtain it from chart creation/list/detail data.id, never from the upload ID. Language is exactly en or ar, case-sensitive; it selects the image's immutable language ownership. There are no B2B/public Size Charts routes (404).

## List query fields and pagination

| Field | Type, bounds/default and normalization | Meaning/source/retention |
| --- | --- | --- |
| page | Optional URL integer 1–100000, coerced to Number; default 1 | Retain selected dashboard page. |
| limit | Optional URL integer 1–100, coerced to Number; default 20 | Page size. |
| isActive | Optional exact scalar true/false URL string, normalized to Boolean | Saved publishing flag; omission includes both states. |

Order is createdAt descending, then chart ID descending. The returned pagination always contains numeric page/limit/total/pages; total is matching charts, pages=ceil(total/limit). Empty lists have items:[], total:0, pages:0. Out-of-range pages may have empty items and a positive total. Unknown list query names are ignored; they are not search or assignment filters. No search or sorting parameter or assigned-product list exists; assignedProductCount is returned on each chart DTO.

## Create: every request field

| Body field | Required/type/bounds/default | Meaning/source and later use |
| --- | --- | --- |
| name | Required object containing exactly en and ar | Staff-entered chart name; not a product option key or image filename. |
| name.en, name.ar | Required strings, trimmed 1–200 characters each | Both translations must exist. Null, blank, arrays and extra language keys fail. |
| measurements | Optional null or complete table object (shape below); omission and null both store null on create | Numeric-only charts are supported; create may set isActive:true when a table is supplied. |
| isActive | Optional actual JSON Boolean, default false | True on creation requires a valid table, because imageIds cannot be attached during create. For an image-only guide, create inactive, upload, then attach/activate through PATCH. |

Unknown create keys are rejected with 422, including alt/imageIds/version/id/store/images. Alternative text is set through PATCH. Duplicate names are allowed; chart identity is its ID. Creation is transactional with audit. No deterministic create-idempotency key exists: do not blindly repeat a timed-out create; reconcile through the dashboard list/current selection first.

```json
{
  "name": { "en": "Shirt sizes", "ar": "مقاسات القمصان" },
  "isActive": false,
  "measurements": { "unit": "cm", "rows": [
    { "size": "M", "chest": 52.5, "length": 70, "sleeve": 21 }
  ] }
}
```

`measurements` is `null` or an object with exactly `unit` and `rows`. `unit` must be the literal `"cm"`. `rows` must contain 1–50 entries in display order. Each row has exactly `size`, `chest`, `length`, and `sleeve`: `size` is trimmed, non-empty, at most 30 Unicode codepoints, and unique without case sensitivity; each measurement is a required JSON number from 0.01 through 1000 inclusive, with at most two decimal places. Values are normalized to two decimals to remove floating-point noise. Strings, numeric coercion, missing fields, null cells, extra keys, and duplicate labels fail with 422. Row order is preserved. No unit conversion or measurement meaning is inferred.

## PATCH: every request field and clearing rule

At least one editable top-level field beyond version is required. An empty translation/imageIds object fails. Unknown top-level or nested keys fail 422 instead of being silently ignored. ID/store/timestamps/resolved images are not writable.

| Body field | Type and validation | Omission/null/clear behavior and source |
| --- | --- | --- |
| version | Required actual JSON nonnegative safe integer, 0–9007199254740991 | Current AdminSizeChart.version. Numeric strings fail. Stale value fails 409; the maximum value also conflicts because increment would overflow. |
| name | Optional non-empty object containing en and/or ar | Merge supplied language leaves, preserving omitted languages; null rejected. |
| name.en, name.ar | Supplied strings trimmed 1–200 | Staff edits; cannot clear to blank/null. |
| alt | Optional non-empty object containing en and/or ar | Merge supplied leaves; null object rejected. |
| alt.en, alt.ar | Supplied strings trimmed 0–500 | Empty string clears that language. Null rejected. Public text falls back to the other language, then chart name if both are blank. |
| isActive | Optional actual JSON Boolean | Omission preserves. True requires a table or at least one attached image after this patch; false hides the public guide while preserving assignment/table/image records. |
| imageIds | Optional non-empty object containing en and/or ar | Partial language merge, not full replacement. Omitted language retains its image. Null object rejected. |
| imageIds.en, imageIds.ar | Supplied 24-hex upload ID strings or null; IDs normalized lowercase | Use data.id from upload for this exact chart and language. Null clears only that language. Arbitrary URLs, product images, another chart/language's IDs and expired/retired assets fail. |
| measurements | Optional `null` or full table object as specified above | Omission preserves. An object replaces the whole table and row order. Null clears only the table, retaining images. Clearing the last content on an active chart fails unless the same PATCH sets `isActive:false`. |

To clear the last active image without a valid table remaining, include isActive:false in that same PATCH; otherwise the entire request fails 422 and keeps the existing image/activation. If valid measurements remain, the last image can be cleared while active. Clearing one language while the other remains attached also preserves activation. No automatic language migration occurs.

```json
{
  "version": 0,
  "imageIds": { "en": "66f000000000000000000020", "ar": null },
  "measurements": { "unit": "cm", "rows": [
    { "size": "M", "chest": 52.5, "length": 70, "sleeve": 21 }
  ] },
  "alt": { "en": "Chest and length in centimetres", "ar": "الصدر والطول بالسنتيمتر" },
  "isActive": true
}
```

Successful PATCH increments version exactly once and returns the complete admin DTO. Retain the new version immediately. Concurrent saves have one accepted version; 409 requires fresh detail and human reconciliation, not automatic version substitution. Repeating an already successful PATCH with the old version conflicts. A malformed/failed edit does not partially attach/retire an image or update the chart/audit.

To clear only the table, send `"measurements": null`; this keeps attached images. If the chart is active and has no image, also send `"isActive": false` in the same PATCH. Omitting measurements preserves the existing table.

```json
{ "version": 1, "measurements": null, "isActive": false }
```

## AdminSizeChart: every response field

This object is data on create/detail/PATCH, or one data.items[] element on list. All keys below are always present.

| Field | Exact type, origin and meaning | Retain/use |
| --- | --- | --- |
| id | Lowercase 24-hex chart ID, generated on creation | Use as chartId in URLs and Product sizeChartId. It is not an asset ID. |
| version | Nonnegative safe integer, initially 0 | Required on the next chart PATCH; independent of Product.version. Upload alone does not increment it. |
| name | Object with en/ar non-empty stored strings | Populate both editor translations. |
| name.en, name.ar | Trimmed staff input, 1–200 characters | Display/edit as text. |
| isActive | Stored Boolean, initially false | Public availability flag, independent of product isActive. |
| images | Object with en/ar keys | Current attached images, not every uploaded asset. |
| images.en, images.ar | Image or null | Null means no image attached for that language. |
| images.<language>.id | Lowercase 24-hex Media ID | Reuse in matching imageIds.<language> if retaining/replacing via explicit PATCH. |
| images.<language>.url | Server-owned public Bunny HTTPS URL | Render image; never submit URL for attachment. |
| images.<language>.width, images.<language>.height | Integer 1–1600, processed pixels | Layout/aspect ratio. |
| alt | Object with en/ar strings, initially both empty | Populate alternative-text editor. |
| alt.en, alt.ar | Stored trimmed text, 0–500 | May be empty; public fallback is derived at read time. |
| measurements | Always table object or null; legacy records without the field are returned as null | Populate the optional numeric table editor; preserve this value when not editing it. |
| measurements.unit | Literal `"cm"` | Shared unit for every row. |
| measurements.rows | Ordered array of 1–50 row objects | Render in this order; English and Arabic share the same row data. |
| measurements.rows[].size | Trimmed label string, 1–30 Unicode codepoints, case-insensitive unique in this table | Display size label; it does not create a Product option or variant. |
| measurements.rows[].chest, `.length`, `.sleeve` | Required finite JSON numbers, 0.01–1000 inclusive, normalized to at most 2 decimals | Display numeric values with localized labels; the server does not define flat/circumference meaning. |
| assignedProductCount | Nonnegative integer, always returned | Informational count of extant B2C Products assigned to this chart, including inactive/hidden Products; each Product counts once regardless of variants. It can change without chart.version changing. |
| createdAt, updatedAt | ISO UTC strings with milliseconds from MongoDB timestamps | Display/sort timestamps; never use as edit versions or send back as writable fields. |

No assignment list, author ID, audit details, objectKey, storage credentials or provider zone is returned. Assignment count is batched for each returned page/detail and inside the mutation session; it is informational and does not replace the transactional Product reference check used by deletion. Upload itself does not change updatedAt; only successful chart mutations do.

Complete synthetic create response:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "id": "66f000000000000000000010",
    "version": 0,
    "name": { "en": "Shirt sizes", "ar": "مقاسات القمصان" },
    "isActive": false,
    "images": { "en": null, "ar": null },
    "alt": { "en": "", "ar": "" },
    "measurements": { "unit": "cm", "rows": [{ "size": "M", "chest": 52.5, "length": 70, "sleeve": 21 }] },
    "assignedProductCount": 0,
    "createdAt": "2026-10-22T10:00:00.000Z",
    "updatedAt": "2026-10-22T10:00:00.000Z"
  },
  "requestId": "f138736c-2bce-4b41-b229-7b044998ceef"
}
```

## Image upload: bytes, response, ownership, expiry and cleanup

1. Create/read the chart and retain data.id as chartId plus its current version.
2. POST /api/v1/admin/b2c/size-charts/<chartId>/images/en (or ar). Send one actual file as raw bytes, Content-Type image/jpeg, image/png or image/webp matching decoded input. No JSON field, multipart/form-data, base64, PDF, SVG or animation.
3. Existing Sharp rules apply: at most 5 MiB (5242880 bytes), at most 20 million decoded pixels; corrupt/type-mismatched input fails. Output is metadata-stripped WebP, quality82, rotated/resized inside 1600x1600 without enlargement.
4. A 201 upload returns exactly {id,url,width,height}. All fields have the Image meanings above. Save this new data.id as imageIds.en/ar for the chart PATCH; it is different from chartId.
5. Upload does not attach, publish or increment chart version. PATCH the chart with its current version and the returned asset ID. Read detail after successful save to use canonical images/version. Multiple uploaded files do not form a gallery; one chosen image per language is attached.

Apidog: Bearer {{JWT}}, Body > Binary > Upload, choose a real local image and matching Content-Type. Portable request templates cannot select a local file for you. An empty JSON/text editor is the wrong upload mode. The ordinary /media/:kind/:targetId route still accepts only product/category; do not invent kind=sizechart. Dedicated chart uploads are internally bound to chart+language and cannot attach across languages/charts/products/stores.

Unattached uploading/ready assets expire after 24 hours, measured from upload creation. The upload DTO does not return expiresAt: do not invent one or treat the ID as permanent. Attached assets do not expire on that timer. Timeouts can leave a storage cleanup obligation even without a received ID. There is no unattached-image list/delete/recovery API: keep known successful IDs and avoid blind repeated uploads; abandoned assets are cleaned by existing Media cleanup. Replacement/clear/delete retires old attachments in the database transaction; physical Bunny deletion runs after commit and failed deletion remains queued for existing cleanup. Deactivating a chart keeps its attached images. Public CDN caches may retain a previously delivered image after deletion; these are public guides, not private revocable media.

Catalog IP upload allowance is 60/15 minutes for the chart router, plus the shared authenticated Media allowance of 60/15 minutes across chart and catalog uploads for that store/account. API IP240/min and account120/min also apply. The chart IP bucket is separate from the existing ordinary Media router bucket. Auth/role and applicable account budgets run before raw image parsing. Counts include rejected calls that reach a limiter. All counters are process-local; see shared security for scaling/deployment requirements. Preserve chart version, upload IDs and file selection on429, honor Retry-After and pause retries. Never refresh JWT to evade429.

## Product assignment and public projection

Existing B2C Product POST/PATCH accepts optional sizeChartId:24-hex string|null. Create omission defaults null; PATCH omission preserves; null clears. Reference must be an existing B2C chart, including inactive charts. Keep Product.version from its dashboard DTO for Product PATCH; a chart version is not interchangeable. Chart IDs come from this module's list/create/detail, not from an image or label. Product dashboard DTOs always include sizeChartId, null when unset or absent on legacy records. No data migration or automatic assignment was performed.

Public B2C Product list/detail always include `sizeChart`, either null or a non-null PublicSizeChart. An active chart with either measurements or an attached image is returned. Numeric-only charts have `image:null`; image-only legacy charts have `measurements:null`; mixed charts return both. The frontend renders numeric data first and uses the image as fallback otherwise. The server does not select a presentation mode.

| Public field | Type/source | Frontend use |
| --- | --- | --- |
| sizeChart.id | Chart ID string | Resource identity only; it does not select a clothing variant. |
| sizeChart.name | Localized chart name string | Display guide title. |
| sizeChart.image | Image {id,url,width,height} or null | Selected-language image, otherwise the other attached language image; null for numeric-only charts. Both are public. |
| sizeChart.image.id | Public asset ID | Image identity only; visitors cannot attach it elsewhere. |
| sizeChart.image.url | Public processed WebP URL | Show image in an accessible guide/dialog. |
| sizeChart.image.width, sizeChart.image.height | Processed integer pixel dimensions, 1–1600 | Reserve layout/aspect ratio. |
| sizeChart.alt | Localized stored alternative text; other-language fallback, then localized chart name | Set image alternative text. No HTML. |
| sizeChart.measurements | Table object or null | Numeric table described above; null when absent on a legacy/image-only chart. |
| sizeChart.measurements.unit | Literal `"cm"` | Shared row unit. |
| sizeChart.measurements.rows | Ordered 1–50 row objects | Render this order; values are shared across locales. |
| sizeChart.measurements.rows[].size | Display label string | Show as provided; does not select a variant. |
| sizeChart.measurements.rows[].chest, `.length`, `.sleeve` | Number in centimetres, 0.01–1000, at most 2 decimals | Localize labels in the frontend. Meaning (flat width/circumference) is not inferred. |

The requested X-Language governs name/alt and image preference. Fallback image may contain the other language's printed text; do not claim an automatic translation. No chart version, sizeChartId field, actor, provider key or other-product list appears in public Product DTOs. Product option/variant arrays remain the authoritative selectable sizes. A null guide hides its button without hiding the product.

Cart, Wishlist, Orders and price-free B2B Wholesale projections do not gain chart fields; load B2C Product detail for its current guide. B2B-native products cannot assign charts. Public Products reads resolve referenced charts in a batch; deactivation affects subsequent product reads without copying chart images into product galleries. Previously fetched frontend data must be invalidated/refetched after chart edits.

## Complete dashboard/customer sequence and retained state

Dashboard: list charts; load/create one; retain chartId/version; enter ordered numeric measurements and save with the chosen isActive value. Upload language images only when an image guide/fallback is wanted; retain each upload ID and language, then PATCH to attach. Store the canonical returned version after each save. Separately open a Product editor, load its own version, choose chartId and PATCH sizeChartId. Keep independent versions per chart/product. An inactive selection is allowed but should be shown as not publicly visible. Saving does not force publication: preserve the current isActive unless the user chooses a publication change; new charts default inactive.

Customer: load Product detail; if sizeChart is non-null show its localized title and render numeric data first, using the image as fallback otherwise. Localize measurement labels, preserve row order, and do not infer flat/circumference meaning. Maintain focus/close controls in the frontend. A guide selection never adds a product to Cart. If an image fails to load, show an unavailable-image state; do not disable normal valid variant selection.

Delete: superAdmin reads current chart, chooses deletion, and receives 409 if any Product still references it. Clear each known Product assignment explicitly through its versioned Product PATCH, or deactivate instead. The chart API provides no assignment browser, bulk detachment or cascade. Successful delete is permanent and audited, retires its language images, and returns data:null. Repeating delete returns404, not a recreated record. Assignment/edit/delete operations share the existing transactional catalog guard so competing Product assignments cannot leave dangling chart references.

## Every relevant error and frontend recovery

All errors use success:false/code/message/errors/requestId, no data. Normal errors[].field/location/code/message follow shared conventions; structural/business validation may have errors:[].

| HTTP/code | Trigger | Recovery |
| --- | --- | --- |
| 401 UNAUTHORIZED | Missing/invalid/wrong-store/revoked bearer | Existing one-refresh/sign-in flow for B2C; preserve editor state. |
| 403 FORBIDDEN | Forbidden role; admin tries delete | Hide that action; refresh cannot grant deletion permission. |
| 404 SIZE_CHART_NOT_FOUND | Missing chart on read/edit/delete/upload or Product assignment | Refresh chart list, remove stale selection or clear assignment; never invent an ID. |
| 409 SIZE_CHART_CONFLICT | Stale PATCH version or increment at MAX_SAFE_INTEGER | Fetch current detail, compare and explicitly reconcile before saving again. |
| 409 SIZE_CHART_IN_USE | Any active/inactive Product references a deleted chart | Deactivate or clear Product assignments; no automatic cascade. |
| 409 MEDIA_CONFLICT | Image bound elsewhere, expired, retired, not ready or wrong language | Upload/select a valid asset for that chart/language; keep chart editor version in sync. |
| 422 VALIDATION_ERROR | Invalid fields, unknown nested/editable keys, missing translations/version, empty edit, invalid measurement table, or active chart without an image/table | Correct input; errors identify a body field (measurement examples include `measurements.rows[0].chest`, location `body`, code `INVALID_FIELD`) with localized generic message and never echo entered values. Failed transaction preserves existing chart and attachments. |
| 422 INVALID_IMAGE / INVALID_FIELD | Corrupt/oversized-buffer/type-mismatched data; malformed upload scope/parameters | Correct path/file; HTTP parser can return413 before processing oversized data. |
| 413 BODY_TOO_LARGE | More than5MiB raw file or shared100KiB JSON body | Reduce file/body. |
| 415 IMAGE_TYPE_UNSUPPORTED / UNSUPPORTED_ENCODING | Unsupported MIME/compression/encoding | Use one supported uncompressed raw image with matching MIME. |
| 429 TOO_MANY_REQUESTS | API/account/catalog upload budget | Preserve state, honor Retry-After, back off; do not refresh-loop. |
| 503 MEDIA_UNAVAILABLE / 502 MEDIA_STORAGE_FAILED | Missing/changed public Bunny configuration or upload failure | Preserve selected file/editor; operator checks provider. Do not report attached/saved before PATCH success. |
| 503 TRANSACTIONS_REQUIRED / NOT_READY | Required MongoDB transaction/catalog guard unavailable | Operator fixes deployment; browser retries cannot provide a replica set. |
| 500 INTERNAL_ERROR or fetch failure | Unexpected failure or uncertain response | Keep inputs/IDs. Reconcile via chart detail/list; successful creates/uploads are not blindly replay-safe. |

No new environment key/provider dependency is required. Reuse existing public Bunny configuration and Media cleanup. The six-layer module, Products assignment, storage namespace and security checks are covered by focused tests; exact final verification is recorded in the main readiness/audit files. In-memory tests do not establish live Bunny, real MongoDB contention, browser dialogs or deployment acceptance.
