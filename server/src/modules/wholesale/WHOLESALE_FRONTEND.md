# Wholesale frontend contract (B2B)

Source checked: 2026-10-13. This module owns simple B2B-only products and wholesale pouch offers. Offers may reference these products or publicly visible B2C simple/variant products. Read [API conventions](../../../../docs/frontend/api-conventions.md), [B2B flow](../../../../docs/frontend/b2b-flow.md), [Products](../products/PRODUCTS_FRONTEND.md), [Media](../media/MEDIA_FRONTEND.md), [Forms](../forms/FORMS_FRONTEND.md) and [Auth](../auth/AUTH_FRONTEND.md). [Leads](../leads/LEADS_FRONTEND.md) implements submission, private attachments, tracking, staff arrival events, and optional customer email jobs.

## Confirmed scope and resource separation

Native products are created only for B2B. They have bilingual name/description, a product image gallery, availability and a version. They are always simple products: no variants, SKU, category, retail price, discount, stock, shipping, Cart or checkout. Their records are separate from B2C Product records and never appear in B2C Products or Cart. Native products are managed through the dashboard and displayed publicly through their published offers; there is no standalone public native-product API.

B2C reuse stores an explicit sourceStore/productId reference, not a cloned product. B2B staff can select only active B2C products whose complete category ancestry is visible. This does not grant B2C dashboard mutation permissions. The selection/projection excludes price, stock, SKU, sale, currency and dashboard version information. Source names/descriptions/images and variant choices are read from the current source on each offer response.

Offers contain a fixed pouch composition. A simple source uses one null-variant line with a positive piece count, such as 30. A B2C variant source can mix sizes/colors using distinct variant IDs and a quantity for each. The server sums composition quantities into piecesPerPouch. Different pouch sizes may be separate offers for the same product. Customers choose whole-number quantities of pouches per offer in the Leads request; they do not change a pouch's composition. That submission payload is defined in the Leads handoff, with offerId/version/quantity entries.

No price is displayed or calculated. B2C stock does not restrict an inquiry and is never reserved/deducted by this module. B2C source visibility and native product isActive still govern availability. Offer publication is independent: newly created native products default active; newly created offers default unpublished unless staff explicitly supplies isActive:true.

## Every endpoint and status

All dashboard endpoints require an active, confirmed B2B superAdmin/admin bearer identity. Only superAdmin deletes. B2B moderator/user receives 403; a B2C token receives 401 on B2B protected routes. Public endpoints require no account and do not authenticate a supplied Authorization header. No B2C Wholesale endpoints are mounted.

| Method and exact path | Permission | Input | Successful data/status |
| --- | --- | --- | --- |
| `GET /api/v1/b2b/wholesale/offers` | Public | Offer list queries below | Localized available offers plus pagination; 200 |
| `GET /api/v1/b2b/wholesale/offers/:resourceId` | Public | Offer ID path | One localized available offer; 200 |
| `GET /api/v1/b2b/wholesale/offers/resolve/:offerKey` | Public | Saved slug, alias, or legacy ID | Complete canonical public offer DTO; 200 |
| `GET /api/v1/admin/b2b/wholesale/b2c-products` | B2B superAdmin/admin | Selector queries | Bilingual read-only B2C projections plus pagination; 200 |
| `GET /api/v1/admin/b2b/wholesale/b2c-products/:resourceId` | B2B superAdmin/admin | B2C Product ID path | One bilingual visible B2C projection; 200 |
| `GET /api/v1/admin/b2b/wholesale/products` | B2B superAdmin/admin | Native product list queries | Bilingual native products plus pagination; 200 |
| `POST /api/v1/admin/b2b/wholesale/products` | B2B superAdmin/admin | Native create body | New bilingual native product; 201 |
| `GET /api/v1/admin/b2b/wholesale/products/:resourceId` | B2B superAdmin/admin | Native product ID | Bilingual native product, including inactive; 200 |
| `PATCH /api/v1/admin/b2b/wholesale/products/:resourceId` | B2B superAdmin/admin | Native update body | Complete updated product/version; 200 |
| `DELETE /api/v1/admin/b2b/wholesale/products/:resourceId` | B2B superAdmin | Native product ID | Permanent unreferenced deletion; 200, data:null |
| `GET /api/v1/admin/b2b/wholesale/offers` | B2B superAdmin/admin | Offer list queries | Bilingual offers including unpublished/unavailable plus pagination; 200 |
| `POST /api/v1/admin/b2b/wholesale/offers` | B2B superAdmin/admin | Offer create body | Complete new bilingual offer; 201 |
| `GET /api/v1/admin/b2b/wholesale/offers/:resourceId` | B2B superAdmin/admin | Offer ID | Complete bilingual offer; 200 |
| `PATCH /api/v1/admin/b2b/wholesale/offers/:resourceId` | B2B superAdmin/admin | Offer update body | Complete updated offer/version; 200 |
| `DELETE /api/v1/admin/b2b/wholesale/offers/:resourceId` | B2B superAdmin | Offer ID | Permanent deletion; 200, data:null. Historical Lead selections block deletion with WHOLESALE_REFERENCED. |

Native image upload additionally uses `POST /api/v1/admin/b2b/media/product/:targetId`, B2B superAdmin/admin only, with raw JPEG/PNG/WebP bytes and 201 image DTO. This endpoint belongs to [Media](../media/MEDIA_FRONTEND.md); it is not an offer upload or Lead attachment endpoint. B2B category uploads are rejected. Reused B2C images cannot be edited through B2B Media.

### Headers, cookies and path fields

| Field | Requiredness and exact behavior | Source/retention |
| --- | --- | --- |
| Authorization | Required Bearer access JWT on dashboard and image upload. Refresh cookie alone is insufficient. | B2B Auth login/refresh. Keep separate from B2C credentials. |
| Content-Type | application/json for POST/PATCH JSON. No body needed on GET/DELETE. Image uploads use image/jpeg, image/png or image/webp with raw bytes. | HTTP transport, not a multipart upload. |
| X-Language | Optional en/ar, case-insensitive; public labels/messages resolve this locale. Absent/unsupported falls back to Accept-Language, then server default initially en. | UI language; cache public offers per locale. Dashboard content remains bilingual. |
| Accept-Language | Optional localization fallback. | Browser/UI setting. |
| Origin | Browser-managed, subject to configured general CORS. No additional cookie-write Origin gate in Wholesale/Media. | Configure real frontend origin; do not manually set in browser JavaScript. |
| Cookies | Wholesale/Media issue/consume no ownership cookie. | Refresh cookie belongs to separate Auth flow. |
| resourceId | Required on detail/update/delete paths, exactly 24 hex characters; uppercase accepted and lowered. | Relevant returned native/offer/source id. The path resource kind determines which collection is searched. |
| offerKey | Required only on `GET /api/v1/b2b/wholesale/offers/resolve/:offerKey`; one decoded path segment, at most 150 characters for slug lookup, uppercase slug text normalized to lowercase, or exactly 24 hexadecimal characters for legacy ID lookup. No request body. | Current public offer slug, an alias, or existing offer ID. URL decoding occurs once; encoded separators do not create another path segment. |
| targetId | Media path: native B2B product ID, exactly 24 hex, normalized by service. | Create native product first, then upload to its ID. A B2C product ID does not identify a native target. |

Responses use the shared success/error envelopes, X-Request-Id and Content-Language. No ETag, client idempotency key or special Wholesale cookie is used. Wholesale has no additional module-specific limiter; general API IP and verified-account limits apply as documented below. Media uploads additionally have both IP and store/account allowances of 60 per 15 minutes. General JSON bodies are bounded to 100 KB; images to 5 MB and 20 million decoded pixels.

## Every list query and pagination field

| Query | Routes | Type, bounds, default and meaning |
| --- | --- | --- |
| page | All three lists: public/dashboard offers, native products, B2C selector | Optional integer query string 1–100000, converted to number; default 1. |
| limit | All lists | Optional integer query string 1–100, converted to number; default 20. |
| q | All lists | Optional string, trimmed, 1–100 characters after trim. Literal case-insensitive substring search of bilingual names; B2C selector also searches slug. Regex characters are escaped, never executed as patterns. |
| isActive | Native/dashboard offer list; accepted but overridden on public offer list | Optional exact string true/false, converted to boolean. Omitted dashboard filter includes both. Public always requires active offers regardless of this input. |
| sourceStore | Public/dashboard offer list only | Optional exact b2c/b2b, filtering the source business area. Not the request owner's store. |
| productId | Public/dashboard offer list only | Optional 24-hex source ID, normalized lowercase. Combine with sourceStore when selecting one source; IDs alone do not authorize source access. |
| type | B2C selector only | Optional exact simple/variant. Native products are always simple, so their list has no type query. |

Unknown query fields are ignored and not passed as Mongo filters. No category query, arbitrary sort, SKU search, source active override or cursor is implemented. Lists sort newest created first with ID descending as tie-breaker. Empty lists return items:[] with pagination; they are not errors.

Every list data object has exactly items and pagination. pagination has page/limit (resolved numbers), total (matching records), and pages (ceil(total/limit); zero when total=0). Public totals are filtered by active offer and active/visible source IDs; source eligibility is rechecked during DTO construction, so a concurrent visibility change can shorten a page. Read again after changes; pagination does not reserve source availability. Beyond-last pages are successful empty lists with the requested page and existing total/pages.

## Native product request bodies

| Field | Create | Update | Exact rule/source |
| --- | --- | --- | --- |
| name | Required bilingual object | Optional partial bilingual object | Only ar/en properties. Both required on create; supplied values trimmed, nonempty strings up to 200 characters. Omitted update language preserved. Null/empty strings/other language keys rejected. |
| name.ar, name.en | Required strings | Optional individually | Staff translations; display names, not machine IDs. |
| description | Optional bilingual object | Optional partial bilingual object | Only ar/en; supplied strings trimmed, 0–10000 characters. Omitted create translations default empty; omitted update languages preserved. Empty string clears a translation. Null rejected. |
| description.ar, description.en | Optional strings | Optional strings | Public selected-language text falls back to other language when empty. |
| isActive | Optional actual boolean, defaults true | Optional boolean; omission preserves | Controls source eligibility for offers. Does not publish an offer by itself. |
| imageIds | Optional ordered array, defaults [] | Optional replacement array | 0–10 distinct 24-hex upload IDs, normalized lowercase. Must belong to this native product/store and be ready/unexpired or currently attached here. [] clears gallery; omission preserves. First image is main. Never submit URLs/image DTOs. |
| version | Not a create field; server starts 0 | Required safe nonnegative JSON integer | Latest dashboard version from GET/PATCH. String/fraction/null rejected. |

Create with no images, retain id, upload each image through B2B Media, then PATCH imageIds with the returned IDs and current version. Uploads require an existing native target, so unrelated ready assets cannot legitimately be supplied on initial create. The first save returns a version 0 record; after successful image attachment it becomes version 1.

price/stock/discountedPrice/sku/options/variants/categoryId/type/sourceStore/productId/composition are explicitly rejected on native requests. No native variant, pricing or inventory API exists. Other unrecognized top-level fields such as ownerId/id/actorId are ignored, never trusted or stored. A version-only/unknown-only PATCH is invalid. Names/description reject nested keys outside ar/en. isActive, imageIds, name and description cannot be null.

## Offer request bodies and every composition field

name/name.ar/name.en/description/description.ar/description.en have the same create/update rules and limits as native products. isActive is an actual optional boolean; create defaults false, update omission preserves. PATCH requires the current safe nonnegative integer version. At least one editable field must be supplied.

| Field | Create/update rules | Source and meaning |
| --- | --- | --- |
| sourceStore | Required b2c/b2b on create; may be omitted or repeated unchanged on update | b2c uses the selector Product ID; b2b uses native product ID. Cannot switch source after creation. |
| productId | Required valid 24-hex on create; may be omitted/repeated unchanged on update; normalized lowercase | Current visible source selected by staff. Cannot switch to another product after creation. Create another offer for a different source. |
| composition | Required ordered array of 1–100 complete lines on create; optional full replacement on update | Fixed pieces in one pouch. Omission preserves; [] or null is invalid. Reordering/replacing removes omitted lines. |
| composition[].variantId | Optional null/omitted for simple source; required valid ID for every variant-source line | Source variant ID from B2C projection. Every non-null ID must belong to that product. Uppercase normalized. No duplicate/null duplicate lines. |
| composition[].quantity | Required safe integer JSON number 1–10000 | Pieces of this selected variant, or total pieces for a simple product. Not the customer's requested number of pouches. |

A simple source must have exactly one line with variantId:null; native B2B products use this shape. A variant source needs one or more distinct valid variants, each with quantity; it cannot use a null line. No price/name/image/options/other key is accepted inside composition lines. piecesPerPouch is derived as the sum, at most 1,000,000 pieces; it is not writable. No independently editable total can disagree with the composition.

New offers require an active visible source even if initially unpublished. Publishing or explicitly changing composition rechecks source eligibility and variant membership. A hidden/missing source blocks creation, enabling, and composition edits with WHOLESALE_SOURCE_UNAVAILABLE. Staff can still edit name/description or disable an existing hidden-source offer while retaining its original composition. Its product becomes null and isAvailable false. Source/variant references remain protected even on disabled offers.

price/stock/discountedPrice/sku/options/variants/categoryId/type/imageIds are explicitly rejected on offers. Offers do not have their own upload/gallery; they display source images. Other unknown top-level fields are ignored and never stored, including piecesPerPouch. A source-only identical update still increments version; a changed source returns WHOLESALE_SOURCE_IMMUTABLE. Do not copy response product/derived fields into a write payload.

## Every response field, nested projection and null rule

The common envelope contains success (true), code (OK), localized message, data (object or null on successful DELETE), and requestId (server UUID, also X-Request-Id). Lists use items/pagination above. Native details and mutations return one complete bilingual management DTO. Selector details return a B2C projection. Offer details/mutations return one complete offer DTO. No internal Mongo __v, timestamps, actor ID, audit data or credentials are exposed.

### Price-free product projection

Selector items and each non-null offer.product use this exact shape. Dashboard translations are objects; public offers resolve them into strings. Native product management adds isActive/version to this projection. No categoryId, slug, SKU, price, stock, discount, activeSale, currency or retail dashboard version is exposed.

| Field | Exact type/source | Meaning/retention |
| --- | --- | --- |
| id | Lowercase 24-hex string, native or B2C source Product ID | Retain together with sourceStore. Selector sourceStore is implicitly b2c; native management implicitly b2b. |
| type | simple or variant; native always simple | Determines composition editor; do not send as a native type setting. |
| name | Bilingual {ar,en} on dashboard, localized nonempty string publicly; up to 200 characters | Current source name. Offer name is separate and editable. |
| description | Bilingual {ar,en} or localized string, up to 10000 characters, may be empty | Current source description; public fallback to other language when empty. |
| images | Ordered array of 0–10 image objects | Source product gallery. First is main; empty needs UI placeholder. |
| options | Always array; [] for simple, 1–5 stored option definitions for variant | Defines source variants; customers do not customize the fixed pouch through these options. |
| variants | Always array; [] for simple, 1–100 source variants | Admin uses variant IDs for mixed composition. Only ID/values/images are included. |

Every image has exactly id (24-hex Media ID), url (public server-owned Bunny CDN URL), width/height (integer pixels, 1–1600 each). Images are public catalog assets; removing storage objects does not immediately purge cached CDN copies. No storage path/zone/key is exposed in the image object.

Every options[] object has key (stable lowercase machine string up to 40 characters), name (bilingual dashboard/localized public label up to 200 characters), values (ordered array of 1–50 choices). Each options[].values[] has key (stable lowercase machine string up to 40 characters) and name (bilingual/localized label). Keys come from B2C Product option definitions, never a Wholesale edit. Every variants[] object has id (24-hex source variant ID), values (object mapping every option key to its configured value key), and images (0–10 image objects above, using product images if the variant has no own images). No variant prices, stocks or SKUs are returned. See Products for exact option key patterns; this module accepts only selected IDs/quantities, not option definitions.

Native management responses additionally have isActive (stored boolean) and version (current nonnegative integer). Native type is simple, options/variants are [], and names/descriptions are always bilingual even with X-Language:ar. The native id never addresses a B2C Products record. Native images are managed independently; B2C product galleries remain read-only for B2B credentials.

### Offer fields

| Field | Exact type/source | Meaning/retention |
| --- | --- | --- |
| id | Lowercase 24-hex offer ID | Detail/edit/delete path, and Leads selection identity. |
| slug | Required lowercase ASCII slug, 1–150 characters; 24-hex values are reserved | Stable URL key for this offer, independent of names/source Product. Shared across languages. |
| slugAliases | Required array of distinct prior slugs; initially [] | Former canonical keys retained permanently for this offer. Never includes current slug and never appears inside product. |
| name | Bilingual dashboard object or localized public string, up to 200 characters | Offer display label authored by B2B staff. |
| description | Bilingual dashboard object or localized public string, up to 10000 characters; may be empty | Offer explanation; public empty selected translation falls back. |
| sourceStore | b2c or b2b, immutable saved source area | Retain with productId; never use as a credential switch. |
| productId | Lowercase 24-hex source ID, always present | Referenced original/native product. Equals product.id when product non-null. |
| composition | Ordered nonempty array of {variantId,quantity} | Saved pouch mix; null variantId for simple, lowercase ID for selected B2C variants. Quantities as above. |
| piecesPerPouch | Integer sum of composition quantities, 1–1000000 | Display fixed piece count; no money calculation. A requested pouch quantity will multiply this count in Leads. |
| isActive | Stored boolean | Offer publication; public details always true. |
| isAvailable | Derived boolean | True only when offer is active and source is visible with valid current composition. Zero retail stock does not affect it. Public offers always true. |
| product | Complete current price-free projection above, or null | Dashboard null when source missing/hidden. Do not render cached hidden source content as the latest result. Public inaccessible offer returns 404 rather than this null detail. |
| version | Nonnegative safe integer, public and dashboard | Dashboard sends it on the next PATCH. Public clients retain it with selected offer IDs for Leads stale-composition validation. |

There is no customer pouch quantity, selected customer variant, payable price, subtotal, stock, reservation, imageIds, updatedAt, status history or lead ID in the offer response. Keep the intended pouch quantity in frontend draft state and submit it through Leads wholesaleRequests. Changing a source's name/images updates future reads; offer name/description, slug and composition remain their independently saved values.

### Where catalog values go next

| Returned value | Next request/use | Retention and refresh behavior |
| --- | --- | --- |
| Native product `id` | Media upload path `/api/v1/admin/b2b/media/product/:targetId`; native detail/update path `/api/v1/admin/b2b/wholesale/products/:resourceId`. | Retain as the B2B media target and product identity. It is not a B2C source ID. |
| Media upload `data.id` | Native product PATCH `imageIds[]`, together with the current native product `version`. | Retain only while the upload is ready/unexpired; the patch attaches it and returns the ordered catalog `images[]`. On `MEDIA_CONFLICT`, upload again. Do not put this ID in Lead `imageIds`. |
| Selector product `id` | Offer create `productId`, paired with `sourceStore: "b2c"`; native source uses its own ID paired with `"b2b"`. | Retain the pair, not the ID alone. Product detail/selector read again if it becomes unavailable; sourceStore/productId cannot be changed after offer creation. |
| Source `variants[].id` | Offer create/update `composition[].variantId` for that selected variant; send one quantity per distinct variant. | Retain with the selected source `productId`. These IDs describe fixed pieces in the pouch; customers do not submit variants separately. A source change/removal can make composition unavailable. |
| Source `options[].key`, `options[].values[].key`, and `variants[].values` | Display source attributes and explain the returned variant combination; no offer/Lead request takes these keys directly. Staff selects `variants[].id` for composition instead. | Keep only as source display context. A value key is not a variant ID and must not be sent as `variantId` or customer answer unless separately configured as a Forms choice. |
| `product.images[]` and `variants[].images[]` `id`/`url` | Display catalog imagery only; no Lead or offer field consumes these as private attachment inputs. | These are public catalog assets. A cached URL can stop working after source image replacement; show a placeholder if needed. |
| Native product or offer `version` | Matching dashboard PATCH body's `version`. | Send the last returned version exactly. On `WHOLESALE_CONFLICT`, GET the record, compare, and reconcile before saving. Native and offer versions are independent. |
| Public offer `id` and `version` | Leads POST `wholesaleRequests[]` as `offerId` and `version`, with frontend-entered whole-pouch `quantity`. | Retain all three together until submission is known. `WHOLESALE_CONFLICT` or `WHOLESALE_SOURCE_UNAVAILABLE` means reload offers and have the customer review changed availability/composition; do not silently replace a selection. |
| Offer `composition`, `piecesPerPouch`, `product`, names and catalog image DTOs | Display/describe the offer; no corresponding Leads write fields except the selected offer ID/version/quantity. | Leads stores its own bilingual offer/product/composition snapshot. Catalog image URLs are public source images; they are not private uploaded inquiry attachments. |
| Offer `product.images[].id` | No Wholesale or Leads request accepts this as an attachment ID. | Read-only catalog image identity. Only staff native product edits use Media upload IDs in native `imageIds`; Lead attachment IDs come from the Lead draft upload route. |

## Complete examples

Create a native product with POST /api/v1/admin/b2b/wholesale/products, B2B staff bearer and application/json:

```json
{ "name": { "ar": "قميص الجملة", "en": "Wholesale shirt" } }
```

Complete successful native creation data (inside the shared 201 envelope), with a synthetic id:

```json
{
  "id": "111111111111111111111111", "type": "simple",
  "name": { "ar": "قميص الجملة", "en": "Wholesale shirt" },
  "description": { "ar": "", "en": "" }, "images": [], "options": [], "variants": [],
  "isActive": true, "version": 0
}
```

Upload optional image bytes to POST /api/v1/admin/b2b/media/product/111111111111111111111111, retain returned image.id, then PATCH the native product with `{ "version": 0, "imageIds": ["<actual-upload-id>"] }`. Use an actual 24-hex ID; the placeholder is explanatory, not valid JSON input for the API.

Create an active native-source pouch with POST /api/v1/admin/b2b/wholesale/offers:

```json
{
  "name": { "ar": "عبوة 30 قميصًا", "en": "30-shirt pouch" },
  "sourceStore": "b2b", "productId": "111111111111111111111111",
  "composition": [{ "variantId": null, "quantity": 30 }], "isActive": true
}
```

GET /api/v1/b2b/wholesale/offers/:resourceId with X-Language:en returns this complete public envelope when the native product has no images:

```json
{
  "success": true, "code": "OK", "message": "Request completed successfully.",
  "data": {
    "id": "222222222222222222222222", "slug": "30-shirt-pouch", "slugAliases": [], "name": "30-shirt pouch", "description": "",
    "sourceStore": "b2b", "productId": "111111111111111111111111",
    "composition": [{ "variantId": null, "quantity": 30 }], "piecesPerPouch": 30,
    "isActive": true, "isAvailable": true, "version": 0,
    "product": { "id": "111111111111111111111111", "type": "simple", "name": "Wholesale shirt",
      "description": "", "images": [], "options": [], "variants": [] }
  },
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

A mixed B2C offer create body uses B2C IDs from the read-only selector:

```json
{
  "name": { "ar": "عبوة مقاسات متنوعة", "en": "Mixed-size pouch" },
  "sourceStore": "b2c", "productId": "333333333333333333333333",
  "composition": [
    { "variantId": "444444444444444444444444", "quantity": 10 },
    { "variantId": "555555555555555555555555", "quantity": 20 }
  ],
  "isActive": true
}
```

A complete dashboard source projection returned by GET /api/v1/admin/b2b/wholesale/b2c-products/:resourceId might be:

```json
{
  "id": "333333333333333333333333", "type": "variant",
  "name": { "ar": "قميص", "en": "Shirt" }, "description": { "ar": "", "en": "" }, "images": [],
  "options": [{ "key": "size", "name": { "ar": "المقاس", "en": "Size" }, "values": [
    { "key": "small", "name": { "ar": "صغير", "en": "Small" } },
    { "key": "42", "name": { "ar": "٤٢", "en": "42" } }
  ] }],
  "variants": [
    { "id": "444444444444444444444444", "values": { "size": "small" }, "images": [] },
    { "id": "555555555555555555555555", "values": { "size": "42" }, "images": [] }
  ]
}
```

Dashboard offer data uses the same complete public offer structure, with name/description and product/option/choice labels as bilingual objects. Source projection has no version. A disabled/hidden-source dashboard offer retains its id/sourceStore/productId/composition/piecesPerPouch/name/description/version; product may be null and isAvailable false. To disable offer version 0, PATCH its dashboard path with `{ "version": 0, "isActive": false }`. Successful response version becomes 1. GET the latest before another edit.

Complete empty public list envelope:

```json
{
  "success": true, "code": "OK", "message": "Request completed successfully.",
  "data": { "items": [], "pagination": { "page": 1, "limit": 20, "total": 0, "pages": 0 } },
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

## Full dashboard workflow and retained state

1. Sign in with B2B staff credentials. Choose a source: GET the read-only b2c-products selector or GET native products. Keep sourceStore and selected product.id. For B2C variant products retain available variant IDs and their values/images; no retail editing is granted.
2. To create a native product, send bilingual name and optional description/availability. Retain id/version. Upload images to that native ID and PATCH only returned imageIds, preserving order. On upload failure/expiry re-upload; do not switch to a B2C upload target or send arbitrary URLs. Media cleanup is shared, scoped by store/target.
3. Create an offer with bilingual display name, immutable source references and complete composition. For simple/native sources use one null variant line. For variants build distinct lines from selector IDs and positive piece quantities. Display the returned derived piecesPerPouch. Publish explicitly with isActive:true or later PATCH using current version.
4. Keep each native and offer version separately. Native image/name edits do not change offer version; the offer's embedded product is live information. Save serially per record. A conflict requires a fresh dashboard read and reviewed reconciliation; do not bump versions locally or discard another operator's composition.
5. Unknown result of POST may mean it committed: there is no create idempotency key, and duplicate offers/pouch sizes are intentionally allowed. Reconcile the dashboard list before creating again. Unknown PATCH result: read current record and compare; retrying an already committed old version conflicts. DELETE is not a success replay: repeating after successful deletion returns the corresponding not-found code.
6. Admins can deactivate native products/offers, but only superAdmin permanently deletes unreferenced native products or offers. A native product referenced by any saved offer cannot be deleted, even when the offer is disabled. Delete an unneeded unreferenced offer first if permitted, then delete native product if no remaining references. No cascade exists. Historical Leads protect selected offers from deletion with WHOLESALE_REFERENCED; disabling an offer remains allowed.

## Public browse and Lead inquiry workflow

Visitors GET public offers and optionally detail, without signing up. Render offer name, source product/images, composition labels/quantities and piecesPerPouch. Offer variants are preconfigured; the customer chooses how many whole pouches of each selected offer they want, not a new variant mix. Keep offer IDs, their current versions and intended pouch quantities in the frontend form draft. Use [Forms](../forms/FORMS_FRONTEND.md) for the wholesale definition and version, then submit selections only through the documented [Leads contract](../leads/LEADS_FRONTEND.md).

There is no B2B Cart, stock deduction, payment, shipping calculation or immediate order confirmation. No displayed retail or wholesale price should be calculated in the frontend. Source zero-stock products are valid inquiries. A product becoming hidden/inactive removes its offers from public selection; an already-open stale page must recheck current availability before submission. [Leads](../leads/LEADS_FRONTEND.md) validates/snapshots selected current offers and requested quantities in its own contract. B2B-only products remain absent from the B2C storefront.

## Concurrency, references, image lifecycle and failure

Native mutations and offer mutations share one B2B catalog guard. Offer mutations also acquire the existing B2C catalog guard first, in a consistent order. B2C deletion/variant removal checks all B2B offer references through a service collaborator while holding its existing guard. A racing offer creation either saves a protected reference or fails because the source disappeared; it cannot create a dangling source. Saved offer references, including disabled ones, prevent B2C product deletion and removal of composed variants. Changing composition may release an old variant reference if no other offer/Cart/Order still uses it.

All writes, image attachment/retirement, version changes and audit records are transactional. Audit/storage/reference-validation failure rolls the database work back. Bunny PUT happens before attachment, and committed removal saves durable cleanup obligations before bounded post-commit deletion. Failed provider deletion remains retry work; it never reverts a committed record or deletes a still-attached image. New native products have no external upload side effect until Media is called. Hourly/manual catalog cleanup also handles B2B objects. Images cannot be attached across store/product targets.

Public reads are current previews, not snapshots or availability reservations. No record TTL, shared public link token, inventory reservation, quote/checkout engine or order is created here. Leads snapshots original offer/product/composition meanings, revalidates active offers/current versions, enforces requested whole-number pouch quantities (1–10000, up to ten distinct offers), and protects selected offers from deletion. The wholesale form requires a nonempty wholesaleRequests array of {offerId,version,quantity}; other form types reject wholesale selections. Private images, submission secrets, tracking and contact permissions are defined by the Leads handoff.

## Every error and recovery

Error envelope: success:false, code, localized message, errors:[], requestId; no data. Field validation entries include field/location/code/message. Path errors use resourceId in params; query errors use the offending query name; request shape errors use body fields. Composition/business errors use INVALID_WHOLESALE with an empty errors array. Media uses its own full error table, linked above.

| HTTP | Code | Trigger/recovery |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing/malformed/expired/wrong-store token, inactive/unconfirmed account or invalidated session on staff route. Follow B2B Auth recovery; never substitute B2C token. |
| 403 | FORBIDDEN | Moderator/customer tries staff operation, or admin tries DELETE. Refresh cannot grant deletion. |
| 404 | NOT_FOUND | Wrong method/route, B2C Wholesale, standalone public native products or unimplemented submission path. Correct integration. |
| 404 | PRODUCT_NOT_FOUND | Selector detail targets missing/hidden B2C source. Refetch selector. |
| 404 | WHOLESALE_PRODUCT_NOT_FOUND | Missing native product on management/image target. Create/select actual native ID. |
| 404 | WHOLESALE_OFFER_NOT_FOUND | Missing dashboard offer, or public disabled/hidden/unavailable offer. Refresh public list; staff may inspect dashboard state. |
| 409 | WHOLESALE_CONFLICT | Stale update version/conditional update race. GET latest and reconcile. |
| 409 | WHOLESALE_SOURCE_IMMUTABLE | Changing offer sourceStore/productId. Create another offer instead. |
| 409 | WHOLESALE_SOURCE_UNAVAILABLE | Creating/enabling/editing composition against an inactive/hidden/missing source. Select a current visible source; disabling existing offer remains allowed. |
| 409 | WHOLESALE_REFERENCED | Native product has saved offers, or offer is selected in a historical Lead. Deactivate, or resolve references with authorized operations. |
| 409 | PRODUCT_REFERENCED | B2C mutation attempts deletion/removal of a referenced product/variant. Keep/deactivate or resolve all references before deleting. This code is returned by B2C Products. |
| 422 | VALIDATION_ERROR | Invalid path/query, noninteger version, wrong field type/array or explicitly unsupported pricing/inventory fields. Correct errors[] locations. |
| 422 | INVALID_WHOLESALE | Invalid bilingual content, empty usable patch, bad/duplicate/wrong-product variants, invalid piece count/composition, duplicate image IDs or incompatible simple mix. Review body rules above. |
| 409 | MEDIA_CONFLICT | Expired/wrong-store/wrong-target/unavailable image ID. Upload to the actual native product again. |
| 503 | MEDIA_UNAVAILABLE | Bunny public storage missing; configure provider/retry later for image operations. Basic image-free product/offer management is separate. |
| 503 | TRANSACTIONS_REQUIRED | Write transaction unsupported by MongoDB deployment. Backend replica-set configuration required. |
| 500 | INTERNAL_ERROR | Unexpected DB/audit/infrastructure failure. Preserve editor state, keep requestId, read/reconcile before retry. |
| 403 | CORS_DENIED | Origin not configured; browser may report network failure instead of readable body. Fix origin configuration. |
| 400 | INVALID_JSON | Malformed JSON. Serialize only documented inputs. |
| 413 | BODY_TOO_LARGE | JSON exceeds 100 KB or image exceeds 5 MB. Reduce input. |
| 415 | UNSUPPORTED_ENCODING | Unsupported request encoding/charset; image route rejects compressed raw bodies. |

Media additionally returns INVALID_FIELD for unsupported B2B category targets, IMAGE_TYPE_UNSUPPORTED/INVALID_IMAGE for invalid bytes/types and TOO_MANY_REQUESTS when its upload limit is exhausted. See Media for dimensions/animation checks, exact statuses and retries. Invalid internal store context produces 400 INVALID_STORE; no Wholesale B2C HTTP route exists. No proof of SMTP, live Bunny/CDN or browser deployment is implied by local tests.

## Verification evidence

Six focused service/HTTP tests plus the affected B2C Media HTTP test passed. The full regression suite passed 123 tests with one opt-in database skip. The separately authorized real-MongoDB integration passed source isolation/search, zero-stock availability, mixed-variant reference guards, concurrent versions, source hiding, native images/audit rollback/cleanup, and both native and B2C offer-create-versus-product-delete races. Disposable test collections were removed and verified absent. All 14 Wholesale routes were matched to this handoff; the complete examples were compared with actual DTOs. Live Bunny/CDN and browser/TLS behavior remain unverified.

Public offer version is a read-only field used by Leads to reject a pouch composition changed since selection. This is separate from the source Product projection, which excludes retail edit versions. During submission, the internal getForSubmission operation validates up to ten distinct active offers with their versions and whole-number pouch quantities (1–10000), holds the existing catalog guards and returns bilingual snapshots. Leads stores these snapshots and protects referenced offers from deletion; later offer edits do not rewrite submitted inquiries.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.

## Stable offer URL extension (owner-approved; rollout verification pending)

The approved stable-URL contract adds required response fields `slug` and `slugAliases` to public offer list/detail/resolver DTOs and dashboard offer list/detail/create/PATCH DTOs. They are fields on the offer, never on `product`. Existing ID routes remain ID-only. The new public `GET /api/v1/b2b/wholesale/offers/resolve/:offerKey` accepts a canonical slug, former slug alias, or legacy 24-hex offer ID and returns the complete current public DTO with HTTP 200. It performs the same visibility/availability checks and never writes or backfills during GET. Unknown or unavailable offers use the generic public not-found response; a legacy offer without a persisted slug returns `503 NOT_READY` during rollout rather than generating one during GET.

`slug` is a saved lowercase 1–150-character key matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`; 24-hex keys are reserved for ID lookup. `slugAliases` is a required distinct array, initially empty, containing every prior canonical key and never the current value. POST does not accept either field: the server creates the initial slug and rejects supplied `slug`/`slugAliases`. PATCH may receive an optional `slug` with the current offer `version`; ordinary name changes preserve the slug. Alias input is read-only and rejected. Repeating the current slug is accepted, creates no alias, and still increments version once under the existing accepted-write policy; version-only PATCH remains invalid. A slug change reserves the new key, retains the old key as an alias, updates the offer, and writes the existing audit atomically. An explicit conflict returns `409 WHOLESALE_SLUG_EXISTS`; stale versions keep existing `409 WHOLESALE_CONFLICT` behavior. Former keys never expire and cannot be reused, including after deletion through an internal reservation or by the same offer.

Initial generation is based once on initial `name.en` with NFKD normalization, lowercase ASCII words separated by hyphens, and an initial base trimmed to at most 96 characters. Collision allocation uses numeric suffixes while keeping the final key at most 150 characters. Empty bases use `offer`; a 24-hex-looking base gets an `-offer` suffix. Offers share a store-wide key namespace across canonical keys and aliases. This does not add a slug to Leads' persisted offer snapshot: snapshots continue storing offer ID, version, and the existing offer/product/composition fields only. A slug PATCH can make an older pending Lead selection version stale.

The companion [stable URL frontend handoff](../../../../docs/frontend/wholesale-stable-urls.md) describes relative website 308 behavior, static mapping/invalidation, and backfill operation. The CLI supports preview/apply only after the owner confirms no readable links were published/shared; it does not import a previous frontend mapping. Preview records the target database, offer/key registry fingerprint, sorted plan, proposed IDs/slugs/aliases and collision reservations. Apply requires the exact reviewed file and unchanged fingerprint, takes the catalog lock in a transaction, reserves keys, updates missing slug/alias fields only, then verifies readback. It preserves existing offer versions and timestamps. The authorized read-only preview of the configured `narmer` database found zero offers and zero registry keys, so it proposed no work; no apply was performed and the preview made no writes. The one real uniquely named disposable MongoDB check passed in 48.75 seconds, including collision races, audit/backfill rollback, idempotent preview, database identity/fingerprint gates, version preservation, and verified empty cleanup. Twenty-two focused checks passed. The full local suite passed 197 tests with zero failures and six opt-in MongoDB skips; the separate Wholesale MongoDB check above was executed explicitly. Live resolver traffic, website-host 308/static invalidation, deployment, and browser behavior remain unverified.

### Stable URL requests and complete examples

These examples describe the approved API contract with synthetic IDs and names. The resolver returns the same complete current DTO for a canonical slug, alias, or legacy ID; it does not return a redirect response.

Create an offer without either URL field:

```json
{
  "name": { "en": "Logo hoodie", "ar": "هودي بشعار" },
  "description": { "en": "Fixed wholesale pouch.", "ar": "عبوة جملة بتكوين ثابت." },
  "sourceStore": "b2b",
  "productId": "111111111111111111111111",
  "composition": [{ "variantId": null, "quantity": 30 }],
  "isActive": true
}
```

Proposed complete 201 create response, with server-allocated `logo-hoodie`:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "id": "222222222222222222222222",
    "slug": "logo-hoodie",
    "slugAliases": [],
    "name": { "en": "Logo hoodie", "ar": "هودي بشعار" },
    "description": { "en": "Fixed wholesale pouch.", "ar": "عبوة جملة بتكوين ثابت." },
    "sourceStore": "b2b",
    "productId": "111111111111111111111111",
    "composition": [{ "variantId": null, "quantity": 30 }],
    "piecesPerPouch": 30,
    "isActive": true,
    "isAvailable": true,
    "product": {
      "id": "111111111111111111111111",
      "type": "simple",
      "name": { "en": "Logo hoodie", "ar": "هودي بشعار" },
      "description": { "en": "", "ar": "" },
      "images": [],
      "options": [],
      "variants": []
    },
    "version": 0
  },
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

An ordinary display-name edit omits `slug` and preserves `logo-hoodie`:

```json
{ "version": 0, "name": { "en": "Classic Logo Hoodie", "ar": "هودي كلاسيكي بشعار" } }
```

Its proposed complete 200 response still has `slug: "logo-hoodie"`, `slugAliases: []`, the changed bilingual name, and `version: 1`; all other DTO fields and the source Product are as in the create response above. The offer name edit does not rename the source Product or generate a new URL.

Complete proposed response:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "id": "222222222222222222222222",
    "slug": "logo-hoodie",
    "slugAliases": [],
    "name": { "en": "Classic Logo Hoodie", "ar": "هودي كلاسيكي بشعار" },
    "description": { "en": "Fixed wholesale pouch.", "ar": "عبوة جملة بتكوين ثابت." },
    "sourceStore": "b2b",
    "productId": "111111111111111111111111",
    "composition": [{ "variantId": null, "quantity": 30 }],
    "piecesPerPouch": 30,
    "isActive": true,
    "isAvailable": true,
    "product": {
      "id": "111111111111111111111111",
      "type": "simple",
      "name": { "en": "Logo hoodie", "ar": "هودي بشعار" },
      "description": { "en": "", "ar": "" },
      "images": [],
      "options": [],
      "variants": []
    },
    "version": 1
  },
  "requestId": "77777777-7777-4777-8777-777777777777"
}
```

A deliberate URL change uses the latest version:

```json
{ "version": 1, "slug": "classic-logo-hoodie" }
```

Its proposed complete 200 response has `slug: "classic-logo-hoodie"`, `slugAliases: ["logo-hoodie"]`, the same name/description/source/composition/product values as the prior response, and `version: 2`. The previous slug remains reserved permanently. If another URL change is later accepted, aliases contain both former canonical keys in history order.

Complete proposed response:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "id": "222222222222222222222222",
    "slug": "classic-logo-hoodie",
    "slugAliases": ["logo-hoodie"],
    "name": { "en": "Classic Logo Hoodie", "ar": "هودي كلاسيكي بشعار" },
    "description": { "en": "Fixed wholesale pouch.", "ar": "عبوة جملة بتكوين ثابت." },
    "sourceStore": "b2b",
    "productId": "111111111111111111111111",
    "composition": [{ "variantId": null, "quantity": 30 }],
    "piecesPerPouch": 30,
    "isActive": true,
    "isAvailable": true,
    "product": {
      "id": "111111111111111111111111",
      "type": "simple",
      "name": { "en": "Logo hoodie", "ar": "هودي بشعار" },
      "description": { "en": "", "ar": "" },
      "images": [],
      "options": [],
      "variants": []
    },
    "version": 2
  },
  "requestId": "88888888-8888-4888-8888-888888888888"
}
```

The following three public requests all return the same complete 200 DTO below (localized by `X-Language`):

```text
GET /api/v1/b2b/wholesale/offers/resolve/classic-logo-hoodie
GET /api/v1/b2b/wholesale/offers/resolve/logo-hoodie
GET /api/v1/b2b/wholesale/offers/resolve/222222222222222222222222
```

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "id": "222222222222222222222222",
    "slug": "classic-logo-hoodie",
    "slugAliases": ["logo-hoodie"],
    "name": "Classic Logo Hoodie",
    "description": "Fixed wholesale pouch.",
    "sourceStore": "b2b",
    "productId": "111111111111111111111111",
    "composition": [{ "variantId": null, "quantity": 30 }],
    "piecesPerPouch": 30,
    "isActive": true,
    "isAvailable": true,
    "product": {
      "id": "111111111111111111111111",
      "type": "simple",
      "name": "Logo hoodie",
      "description": "",
      "images": [],
      "options": [],
      "variants": []
    },
    "version": 2
  },
  "requestId": "22222222-2222-4222-8222-222222222222"
}
```

The public offer list uses the same complete offer object, including both URL fields. Example one-item 200 list response:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "items": [
      {
        "id": "222222222222222222222222",
        "slug": "classic-logo-hoodie",
        "slugAliases": ["logo-hoodie"],
        "name": "Classic Logo Hoodie",
        "description": "Fixed wholesale pouch.",
        "sourceStore": "b2b",
        "productId": "111111111111111111111111",
        "composition": [{ "variantId": null, "quantity": 30 }],
        "piecesPerPouch": 30,
        "isActive": true,
        "isAvailable": true,
        "product": {
          "id": "111111111111111111111111",
          "type": "simple",
          "name": "Logo hoodie",
          "description": "",
          "images": [],
          "options": [],
          "variants": []
        },
        "version": 2
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
  },
  "requestId": "33333333-3333-4333-8333-333333333333"
}
```

Supplying `slug` or `slugAliases` to create, `slugAliases` to PATCH, or an invalid slug returns `422 VALIDATION_ERROR`. Example invalid create request and response for a supplied server-owned slug:

```json
{
  "name": { "en": "Logo hoodie", "ar": "هودي بشعار" },
  "sourceStore": "b2b",
  "productId": "111111111111111111111111",
  "composition": [{ "variantId": null, "quantity": 30 }],
  "slug": "logo-hoodie"
}
```

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Please check the submitted fields.",
  "errors": [
    { "field": "slug", "location": "body", "code": "INVALID_FIELD", "message": "This field is not accepted on create." }
  ],
  "requestId": "44444444-4444-4444-8444-444444444444"
}
```

Example invalid format error for PATCH:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Please check the submitted fields.",
  "errors": [
    { "field": "slug", "location": "body", "code": "INVALID_FIELD", "message": "Use 1–150 lowercase letters, numbers and single hyphens." }
  ],
  "requestId": "55555555-5555-4555-8555-555555555555"
}
```

An explicit slug already used by a current offer, alias, or retained deletion reservation returns `409 WHOLESALE_SLUG_EXISTS`:

```json
{ "version": 2, "slug": "logo-hoodie" }
```

```json
{
  "success": false,
  "code": "WHOLESALE_SLUG_EXISTS",
  "message": "This offer URL name is already used or reserved.",
  "errors": [],
  "requestId": "66666666-6666-4666-8666-666666666666"
}
```

No example here claims a captured live response. The create/detail/list/resolver success payloads describe the same approved DTO and preserve the existing envelope.
