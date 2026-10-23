# Media frontend contract (B2C and native B2B catalog images)

## Apidog file selection

Open the upload request's Request tab, choose Body > Binary and click Upload to select a local JPEG, PNG or WebP file, at most 5 MiB. Set the body MIME/Content-Type to match that file: image/jpeg, image/png or image/webp. Keep native Bearer Token authentication with {{JWT}}. The binary picker contains the image itself; it has no JSON image/file field and accepts no multipart/form-data wrapper. Portable examples deliberately do not contain a local file path or image bytes, so you must select a file before sending. An empty JSON editor is the wrong request mode for this endpoint.

For B2C categories, set kind to category and targetId to the existing category's returned data.id. Save the upload response's data.id as imageId, then PATCH that category with {"imageId":"<uploaded image ID>"}. For B2C products use kind=product and that product's ID; attach the returned ID through the Products imageIds flow. For native B2B products use the B2B Media route with kind=product and the native Wholesale product's ID. The ID origin, attachment ownership and version rules for each target remain defined below and in its module contract. B2B does not support category images.

Apidog's OpenAPI round trip can normalize a primary image body into text/plain and discard the binary marker. After any import, verify the actual Request tab still shows Binary with an Upload picker and the correct image Content-Type; a schema-only export is not enough evidence. Do not change the backend to JSON or multipart to accommodate an incorrectly imported client request.

This document describes the Media HTTP contract checked against source on 2026-10-13. Shared request IDs, headers, success/error envelopes, and common field errors are documented in [API conventions](../../../../docs/frontend/api-conventions.md). Related flows: [B2C flow](../../../../docs/frontend/b2c-flow.md), [Products](../products/PRODUCTS_FRONTEND.md), and [Categories](../categories/CATEGORIES_FRONTEND.md).

This is a dashboard-only raw-image upload API for existing B2C products/categories and native B2B Wholesale products. It returns a temporary server-generated image ID and public catalog URL. A later PATCH to the existing target's Products or Categories endpoint attaches that ID. There is no media list, fetch, or delete endpoint, no private-file storage, and no API to upload directly to a future product/category ID.

## Endpoint and access

`POST /api/v1/admin/b2c/media/:kind/:targetId`

| Path key | Required value |
|---|---|
| `kind` | `product` or `category` |
| `targetId` | Existing 24-hex product/category ID in B2C |

Complete upload input contract:

| Input | Requiredness and accepted form | Source, meaning, and retention |
|---|---|---|
| `:kind` | Required path segment: `product` or `category` | Selects which existing dashboard resource is checked and binds ownership. Keep the matching kind with the pending upload in client state. |
| `:targetId` | Required path segment: 24-hex Mongo ID | ID of an existing B2C product/category. The server lowercases it and verifies the target exists and is readable by staff before processing. Keep this target association; IDs cannot move to another target. |
| `Authorization` | Required header `Bearer <accessToken>` | Staff access token; only `superAdmin` and `admin` pass. The browser supplies it from the current admin session; never persist it with the image. |
| `Content-Type` | Required supported image media type `image/jpeg`, `image/png`, or `image/webp`; optional parameters accepted | Declares the source format and must match the decoded image. The server returns processed WebP regardless of input. |
| Request body | Required non-empty raw binary image bytes; maximum 5 MiB | The selected file bytes themselves. Do not wrap in multipart, JSON, base64, or URL. The server decodes, processes, uploads, and returns a temporary image reference. |
| `Content-Length` | Optional HTTP transport header | Usually supplied automatically by the HTTP client; it does not replace the server's 5 MiB streaming body limit. Do not set a stale length manually. |
| Query parameters | None are defined | Do not send processing, naming, URL, or ownership query options; the server does not accept client-selected transformations or object names. |
| `X-Language` / `Accept-Language` | Not required for this binary operation | These select shared response-message localization only; they do not change the image result or file processing. |

Get `targetId` from the selected product/category dashboard DTO's `data.id` (or `data.items[].id` in a list). Use that canonical ID in the URL; product slug, SKU, category slug, and a client-generated ID are not valid target substitutes. The selected file supplies the raw request bytes and matching `Content-Type`.

Requires `Authorization: Bearer <accessToken>` for `superAdmin` or `admin`. Missing/invalid token is `401 UNAUTHORIZED`; other roles get `403 FORBIDDEN`. The server reads the target through the dashboard service before processing the image. A valid ID for a missing target returns `404 PRODUCT_NOT_FOUND` or `404 CATEGORY_NOT_FOUND`. A malformed ID or unsupported `kind` returns `422 VALIDATION_ERROR` with an `INVALID_FIELD` error. No locale header is needed for the binary upload; standard request context headers still apply.

Send the file bytes as the entire request body, with a media type of `image/jpeg`, `image/png`, or `image/webp` (optional media-type parameters are accepted). This is not multipart form data, JSON, a URL, base64, or a presigned upload. Example:

```http
POST /api/v1/admin/b2c/media/product/66f000000000000000000001 HTTP/1.1
Authorization: Bearer <accessToken>
Content-Type: image/jpeg
Content-Length: <file byte length>

<raw JPEG bytes>
```

The parser does not inflate compressed HTTP bodies (Content-Encoding uploads are unsupported). Catalog uploads have both IP and store/account allowances of 60 per 15 minutes, in addition to general API IP 240/minute and account 120/minute controls. A reached limit returns 429 TOO_MANY_REQUESTS; respect exposed Retry-After and retain the target/file selection. Account limits span sessions/tokens/IPs. Counters are process-local; use shared counters before deploying multiple processes. Native B2B product object paths are accepted by the Bunny adapter; B2B category/offer and private namespaces are rejected. Live provider behavior is still unverified.

## File acceptance and processing

The request body limit is 5 MiB (5 × 1024 × 1024 bytes). The API checks both the declared media type and the decoded file format. JPEG bytes declared as PNG, corrupt/truncated files, empty uploads, or files over 20 million decoded pixels are rejected. Animated/multipage images are rejected. SVG is unsupported.

Sharp applies EXIF orientation, resizes within 1600 × 1600 pixels using `fit: inside` without enlarging smaller images, strips metadata by decoding/re-encoding, and encodes catalog delivery as WebP at quality 82. The returned `width` and `height` are the resulting WebP pixel dimensions, each at least 1 and at most 1600. The source file name is not used or returned. Uploaded storage object keys always end in `.webp`, independent of source MIME type.

## Success DTO

On success the endpoint returns HTTP `201` with this exact `data` shape inside the shared success envelope:

| Key | Type | Source and meaning | Frontend retention |
|---|---|---|---|
| `id` | 24-character lowercase hex string | Server-generated asset ID. | Keep with the selected target; submit it in a later PATCH as `imageIds` or `imageId`. |
| `url` | Absolute HTTPS string | Server-computed public catalog CDN URL for the processed object. | Use for preview/display only. Do not construct, edit, or submit the URL as an image reference. |
| `width` | Integer, 1–1600 | Pixel width of the processed WebP after orientation and resize. | May be used for layout/aspect ratio; it is read-only and must not be sent back. |
| `height` | Integer, 1–1600 | Pixel height of the processed WebP after orientation and resize. | May be used for layout/aspect ratio; it is read-only and must not be sent back. |

Example (complete `data`; envelope fields are defined in [API conventions](../../../../docs/frontend/api-conventions.md)):

```json
{
  "id": "66f000000000000000000020",
  "url": "https://cdn.example/narmer/b2c/catalog/product/66f000000000000000000001/66f000000000000000000020.webp",
  "width": 1200,
  "height": 1600
}
```

Do not expect or submit `kind`, `targetId`, `actorId`, `objectKey`, storage endpoint/zone, status, or expiry metadata. Those are server-owned. The API returns neither a private proof URL nor a provider credential.

## Attach an upload to a product or category

An upload does not change its target record. Persist the returned `id` in the client form state and submit it to the existing target's PATCH endpoint:

1. For an existing product, call the upload endpoint with `kind=product` and that product's ID once for each image.
2. Add returned IDs in the desired gallery order to product `imageIds`, or to a variant's `imageIds`.
3. `PATCH /api/v1/admin/b2c/products/:productId` persists the gallery. Include the current product `version` and send `imageIds` for any gallery being changed. See [Products](../products/PRODUCTS_FRONTEND.md) for replacement, omission, and version rules.
4. For an existing category, call the endpoint with `kind=category`; then submit the ID as `imageId` in `PATCH /api/v1/admin/b2c/categories/:categoryId`. Category has one image, not a gallery. A newly created category also must be created first, then uploaded to, then patched. See [Categories](../categories/CATEGORIES_FRONTEND.md).

Product create does not accept a client-chosen product ID, and the upload route requires a product that already exists. Therefore the frontend cannot upload to a not-yet-created product before its `POST`. Create the product without images, upload against the returned product ID, then attach with a versioned `PATCH`. The same limitation applies to variants created as part of that product: create the product and variants without images, upload against the existing product ID, then PATCH the product with the current version, retained variant IDs, complete variant list, and desired per-variant `imageIds`.

Each product gallery and each individual variant gallery accepts up to 10 IDs; a variant product can have up to 100 variants. Gallery order is the ID array order. Product and variant galleries are independent. Dashboard product DTOs return each variant's own gallery, including an empty array. Public product DTOs use the product gallery as a display fallback when a variant has no own images. In the UI, the first image is the main gallery image.

## Ownership, expiry, replacement, and reuse

Each image ID is bound to its B2C or B2B store, `kind`, and exact `targetId` used for upload. An image uploaded for one product cannot be attached to a different product, to a category, or vice versa. Trying to attach a missing, expired, cross-target, or otherwise retired ID returns `409 MEDIA_CONFLICT`; upload it again for the correct existing target.

Ready unattached uploads expire after 24 hours. The response does not include the expiry timestamp; treat the returned ID as short-lived and attach it promptly. Once attached, an image does not expire. There is no endpoint to refresh, renew, or manually delete an unattached image. Expired and abandoned upload records are removed by server cleanup; no frontend cleanup request is needed.

An image already attached to a product can be used by more than one gallery on that same product, including product and variant galleries. Send all desired IDs in the update. The image remains attached while at least one product or variant gallery still references it. It becomes eligible for deletion when the final reference is removed. IDs cannot be reused across products or categories, and the API has no transfer operation. When an image has been detached and retired, upload it again before reusing it.

For each gallery: omit its `imageIds` on patch to preserve its current images; send `[]` to clear it; send a complete ordered ID array to replace it. Product `imageIds` and each variant `imageIds` follow these same rules. A changed variant list follows Products replacement semantics: retain `id` to keep the existing variant (and its gallery when `imageIds` is omitted), and include every variant that should remain.

Attachment changes occur in the same database transaction as the owning product/category write and its audit record. If validation, concurrency, audit, or transaction work fails, the image references do not partially attach. When images are removed, the server records a durable cleanup obligation and attempts cleanup after the database commit. The browser must not infer that a failed product patch attached the image; refetch the product before retrying.

## Storage and public URL limits

The returned URL is a public catalog URL suitable for image display; it must not hold sensitive proofs or identity documents. Orders and Leads have implemented separate private upload/read contracts. Do not construct Bunny URLs or expose storage credentials; retain the returned Media ID for attachment and use its URL only for public display.

Storage object deletion is retried by the backend cleanup process. CDN cache behavior is controlled by the configured pull zone; removing an image from a gallery or deleting its storage object does not guarantee immediate CDN purge. Avoid treating an already-delivered public URL as an authorization boundary.

## Errors and frontend action

| HTTP | Code | Meaning and action |
|---|---|---|
| `201` | `OK` | Upload accepted; retain its `id` and attach it to the same target. |
| `401` | `UNAUTHORIZED` | Sign in and retry with a current bearer token. |
| `403` | `FORBIDDEN` | Only the target store's admins and superAdmins may upload its supported catalog images. |
| `404` | `PRODUCT_NOT_FOUND` / `CATEGORY_NOT_FOUND` / `WHOLESALE_PRODUCT_NOT_FOUND` | Refresh the dashboard target; upload requires an existing target. B2C Products returns `PRODUCT_NOT_FOUND`; Categories returns `CATEGORY_NOT_FOUND`; native B2B Wholesale products return `WHOLESALE_PRODUCT_NOT_FOUND`. |
| `413` | `BODY_TOO_LARGE` | Select an image no larger than 5 MiB. |
| `415` | `IMAGE_TYPE_UNSUPPORTED` | Use JPEG, PNG, or WebP and set the matching `Content-Type`. SVG and other types are unsupported. |
| `415` | `UNSUPPORTED_ENCODING` | Send uncompressed raw bytes without `Content-Encoding`. |
| `422` | `VALIDATION_ERROR` | Fix `kind` or `targetId`; check field-level details in the shared error envelope. |
| `422` | `INVALID_IMAGE` | File is empty, corrupt, MIME-mismatched, animated/multipage, above 20 million pixels, or otherwise undecodable. |
| `409` | `MEDIA_CONFLICT` | On upload, upload record could no longer transition to ready; retry only after checking state. On attachment, ID expired, was retired, or has wrong ownership; upload again for this target. |
| `429` | `TOO_MANY_REQUESTS` | API IP/account or upload IP/account allowance exhausted. Respect exposed Retry-After; retain target/file state and reconcile attachments before replaying an uncertain upload. |
| `502` | `MEDIA_STORAGE_FAILED` | Provider upload/delete failed or timed out. Do not claim the file is available; retry later. An upload may have left an incomplete server record that cleanup will reconcile. |
| `503` | `MEDIA_UNAVAILABLE` | Storage configuration is absent/changed; retry after service configuration is restored. |

Malformed target and MIME checks happen before image decoding. The correct raw-image request is not JSON-parsed. The shared JSON parser runs before all routers: accidentally sending `Content-Type: application/json` can produce `400 INVALID_JSON` or the 100 KiB JSON limit before Media checks, rather than an image-format response. Send the documented image MIME and raw bytes. All error response fields and localized messages follow the shared conventions.

## Frontend implementation checklist

Keep pending upload IDs with the selected target and gallery. Render previews from returned `url`; submit ordered IDs through the owner-module API. Do not persist an ID as a permanent image reference until the product/category write succeeds. For product create, save the product first, then upload and patch. For patch, include the latest product `version`. If an upload fails, keep the current server gallery unchanged; if attachment returns `MEDIA_CONFLICT`, refresh and re-upload to the correct target.

## Private payment-proof boundary

InstaPay proof uploads and authorized image reads belong to [Orders](../orders/ORDERS_FRONTEND.md). They use a separate private Bunny zone, checkout/order ownership and a proof DTO without any public URL. Do not upload sensitive payment screenshots through this public catalog endpoint or attach proof IDs as catalog image IDs. The existing public catalog image DTO and attachment flow are unchanged.

## Private B2B Lead-image boundary

[Leads](../leads/LEADS_FRONTEND.md) implements guest/customer raw image uploads under /api/v1/b2b/leads/drafts/:draftId/images, authorized by X-Lead-Draft-Token, with optional B2B customer bearer. These files use the private zone shared with payment proofs, separate constrained B2B paths and a private metadata DTO {id,width,height} without URL. At most five JPEG/PNG/WebP files per draft, each at most 5 MiB, use the existing Sharp checks. Lead IDs cannot attach to public catalog products/categories, and public catalog Media IDs cannot attach to Leads. Only B2B staff can read attached private files through Leads; guest/customer tracking returns only imageCount. Cleanup follows the Leads lifecycle, not Media's public-target retirement.

## Native B2B product upload extension — 2026-10-12

The actual mounted pattern is POST /api/v1/admin/b2b/media/:kind/:targetId. For a successful B2B upload, replace :kind with the literal product. Although the shared path validator recognizes category, the B2B service rejects it with 422 INVALID_FIELD. This differs from B2C, which supports both product and category. The targetId must come from a native B2B product, and upload ownership remains bound to that exact store/kind/target.

POST /api/v1/admin/b2b/media/product/:targetId uses the same complete raw-image headers, byte/decoded-pixel/format/animation limits, processing, 201 image DTO, upload expiry and cleanup/error contract documented above. Authorization must be a B2B superAdmin/admin bearer token. targetId is an existing native product ID from [Wholesale](../wholesale/WHOLESALE_FRONTEND.md), not a B2C product ID or an offer ID. product is the only allowed B2B kind; category yields 422 INVALID_FIELD. B2C credentials yield 401 on this B2B endpoint. Uploads are public catalog images, not private Lead/transfer attachments.

Create the native product first; upload one raw file at a time; retain each returned image.id and its store/target association. PATCH /api/v1/admin/b2b/wholesale/products/:resourceId with current native version and ordered imageIds to attach up to ten images. Omission preserves, [] clears, first image is main. A source B2C product referenced by an offer remains read-only in B2B; use B2C staff credentials and original B2C Media/Products routes for authorized retail edits. No offer-owned image upload exists.

Provider object keys are server-generated under narmer/b2b/catalog/product/<targetId>/<assetId>.webp, while original B2C paths stay unchanged. Records/indexes enforce store/kind/target ownership; assets cannot attach across stores even if a target ID coincides. Native image changes and retirement share Wholesale transactions/audits, and failed cleanup remains in the existing hourly/manual retry sweep. No Bunny environment/zone/dependency change was needed. Live provider/CDN behavior remains unverified.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.


## Size Chart image integration — 2026-10-22

Reusable B2C guides use the same public Bunny processing, Image DTO, 24-hour unattached expiry and transactional retirement/cleanup through the [Size Charts module](../sizecharts/SIZECHARTS_FRONTEND.md). Upload only through POST /api/v1/admin/b2c/size-charts/:chartId/images/:language with en/ar. Internal size-chart-en/ar kinds bind chart and language; these are not accepted by the ordinary /media/:kind route, whose public path values remain product/category (B2B product only). Charts share the Media authenticated account upload budget60/15min; the dedicated chart router has its own IP60/15min counter. No public library/delete API, new Bunny credential, private chart storage or B2B guide was added. Existing MIME/byte/pixel/security rules apply.

## Homepage image integration — 2026-10-22

Both stores now reuse this pipeline through POST /api/v1/admin/{store}/homepage/media/:slotKey/:device, with a fixed store-specific key and desktop/mobile device. These dedicated raw JPEG/PNG/WebP routes return Image201; retain data.id, then attach through Homepage PATCH slots[].desktopImageId/mobileImageId with the current homepage version. Upload alone does not publish/create settings;24h ready expiry, Sharp validation and durable post-commit retirement/cleanup remain the same. Internal homepage-desktop/mobile kinds and deterministic target IDs bind store/area/device; frontend must not construct them or use them on ordinary Media routes. Product/category input kinds remain unchanged, with B2B product only. Bilingual alt and mobile fallback are owned by [Homepage](../homepage/HOMEPAGE_FRONTEND.md), which describes every field and example. Public assets are not private Lead/proof uploads. All authenticated catalog/chart/homepage uploads share Media account60/15min; each store's homepage upload router has its own IP60/15min. Existing API IP/account limits also apply; preserve uploads/version and honor Retry-After on429. No Bunny credential or environment change is needed.
