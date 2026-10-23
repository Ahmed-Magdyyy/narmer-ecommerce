# Homepage frontend contract

Implemented/source-checked 2026-10-22. Homepage owns a fixed set of image overrides per store and two ordered B2C product selections. It is not a page builder: section creation/order, arbitrary copy, links/navigation targets, forms, branding and layout remain frontend implementation responsibilities. Admins cannot create new image areas. B2B remains an inquiry website without retail pricing or checkout.

Read [shared API conventions](../../../../docs/frontend/api-conventions.md), [Auth](../auth/AUTH_FRONTEND.md), [Products](../products/PRODUCTS_FRONTEND.md), [Media](../media/MEDIA_FRONTEND.md), [B2C flow](../../../../docs/frontend/b2c-flow.md), [B2B flow](../../../../docs/frontend/b2b-flow.md) and [security](../../../../docs/security.md). These define shared envelopes, Product nested fields, Image DTOs, authentication, money and throttling. All examples are synthetic.

## Endpoints: all eight operations

| Method | Exact path | Permission | Success data |
| --- | --- | --- | --- |
| GET | `/api/v1/b2c/homepage` | Public, including guests | PublicHomepage, 200 |
| GET | `/api/v1/b2b/homepage` | Public, including guests | PublicHomepage, 200 |
| GET | `/api/v1/admin/b2c/homepage` | B2C superAdmin/admin | AdminHomepage, 200 |
| GET | `/api/v1/admin/b2b/homepage` | B2B superAdmin/admin | AdminHomepage, 200 |
| PATCH | `/api/v1/admin/b2c/homepage` | B2C superAdmin/admin | Complete normalized AdminHomepage, 200 |
| PATCH | `/api/v1/admin/b2b/homepage` | B2B superAdmin/admin | Complete normalized AdminHomepage, 200 |
| POST | `/api/v1/admin/b2c/homepage/media/:slotKey/:device` | B2C superAdmin/admin | Uploaded public Image, 201 |
| POST | `/api/v1/admin/b2b/homepage/media/:slotKey/:device` | B2B superAdmin/admin | Uploaded public Image, 201 |

Store is the literal b2c/b2b segment, not a body parameter. There is one independent configuration per store. Both management reads and mutations reject moderator/user with 403; wrong-store credentials receive 401. Guests have public read access only. No POST-create singleton, DELETE, draft, publish, reset, audit-read, pagination, section-creation or arbitrary asset-library route exists. Upload is separate from PATCH and does not publish the image or increment homepage version.

No query parameter is supported by these operations. Do not send page, limit, product filters or image URLs as queries. GET has no body. Public requests do not require access credentials; admin requests require Bearer access JWT from that store's login/refresh.

## Fixed editable image areas

Derived from the current Figma Website masters: B2C approved-direction CW-01 node191:651 and current B2B BW-01 node191:135. Images are shared between English/Arabic; alternative text is bilingual. Every deployed area supports an optional mobile override. The API returns this manifest in admin.allowedSlots; render the editor from it and retain exact key strings rather than translated labels.

| Store | Exact slotKey/key | English label | Arabic label | Placement |
| --- | --- | --- | --- | --- |
| b2c | hero-left | Hero: left image | الصورة اليسرى للبنر الرئيسي | First hero photo, independent of fixed hero text panel |
| b2c | hero-right | Hero: right image | الصورة اليمنى للبنر الرئيسي | Second hero photo |
| b2c | collection-men | Men collection | مجموعة الرجال | Men collection panel image |
| b2c | collection-women | Women collection | مجموعة النساء | Women collection panel image |
| b2c | sale-feature | Sale feature | صورة قسم التخفيضات | Fixed Sale editorial/banner image; separate from product selection |
| b2c | factory-story | Factory story | صورة قصة المصنع | Manufacturing-story image |
| b2b | hero | Main banner | البنر الرئيسي | Main manufacturing banner |
| b2b | service-spinning | Spinning service | خدمة الغزل | Spinning service card |
| b2b | service-weaving | Weaving service | خدمة النسيج | Weaving service card |
| b2b | service-fabric | Fabric service | خدمة الأقمشة | Fabric service card |
| b2b | service-school-uniforms | School uniforms service | خدمة الزي المدرسي | School uniforms card |
| b2b | service-wholesale | Wholesale service | خدمة الجملة | Wholesale card |
| b2b | wholesale-overview | Wholesale overview | صورة نظرة عامة على الجملة | Separate wholesale overview feature |

Slot order is fixed as listed and returned by the manifest; request order cannot reorder the page. Keys are stable identifiers, not human-facing copy. Use the semantic hero-left/right keys in both language layouts; the frontend controls RTL placement. Logos, icons and catalog product cards are not separate homepage upload areas. Card galleries come from Products/Wholesale. Changing the fixed manifest requires a backend/frontend deployment, not an admin PATCH.

### Image fallback and initial state

The API returns only saved overrides: desktopImage/mobileImage are null before attachment or after clearing. It does not invent static fallback URLs or return final frontend assets. On desktop use desktopImage, otherwise an approved bundled frontend fallback. On mobile use mobileImage, otherwise desktopImage, otherwise an approved bundled fallback. A mobile-only override is allowed: it does not automatically become a desktop image. Both Image fields remain truthful/null in the DTO; the frontend performs this device fallback.

Null image overrides do not delete the surrounding section or change layout. No approved bundled asset paths are supplied by this backend. Until the frontend has client-approved fallback assets, show its designed neutral image/placeholder state rather than a broken image or invented company photograph. B2B illustrations are service imagery, not evidence of real facilities or purchasable inventory.

Public alt is requested non-empty language, then the other language, then an empty string. Empty alt is valid; the frontend must choose appropriate accessible image treatment for decorative versus informative placement. There is no automatic alt fallback to the slot label. Admin labels remain bilingual and are editor labels only.

## Transport, headers and limits

| Field/header | Required when / type | Source, meaning and retention |
| --- | --- | --- |
| Authorization | Admin GET/PATCH/upload: `Bearer <accessToken>` | Same-store Auth login/refresh data.accessToken. Replace after refresh. In Apidog choose native Bearer Token with credentials `{{JWT}}`. Public GET needs No Auth. |
| Content-Type | PATCH: application/json | JSON object described below. Never multipart/form-data, file bytes or base64 for PATCH. |
| Content-Type | Upload: image/jpeg, image/png or image/webp | Must match actual selected file. Body is raw binary only. In Apidog use Body > Binary > Upload, not JSON/Text/Form Data. |
| X-Language | Optional en/ar on every route | UI preference. Public alt and Product labels use negotiated language; admin alt/allowedSlots labels remain bilingual. Messages localize independently. |
| Accept-Language | Optional fallback | Shared negotiation applies; unsupported preferences fall back to configured default, initially en. |
| Origin | Browser-managed; configured frontend origin | Shared CORS rules apply. These Bearer-only admin operations have no additional cookie Origin guard. Do not manually set Origin in browser JavaScript. |
| Cache-Control | Module handlers set no-store | Public GET is recalculated; admin responses are private editor state. Earlier parser/CORS errors follow shared behavior. Do not place these routes behind a cache that ignores no-store. |
| X-Request-Id | Response tracing header; requestId in envelope | Keep on errors for support. Not a homepage ID, version or replay credential. |
| Retry-After / RateLimit / RateLimit-Policy | Shared throttling headers | API IP240/minute, authenticated account120/minute. Uploads additionally share Media account60/15minutes with catalog/size-chart uploads; each store's dedicated homepage upload router has IP60/15minutes. Honor Retry-After on 429 and pause repeated uploads/saves. |

Counter storage remains process-local for the confirmed one-process deployment. Store/account quota keys cover sessions/IPs; changing JWT/device/slot does not reset the account upload counter. The two homepage router IP buckets are separate from each other and ordinary catalog/size-chart IP buckets. Authentication/role checks run before raw image parsing. Invalid attempts can consume reached counters. Existing shared JSON100KiB limit applies to PATCH; files have the separate 5MiB limit.

No cookie, refresh-token JSON, guest token, tracking secret, X-Lead-Draft-Token, X-Order-Token or idempotency key is used here. Homepage calls do not create cookies. Auth login/refresh still uses its own documented cookie/credentials rules. Public homepage data is independent of customer account/cart state.

## Admin GET: exact response fields and defaults

GET returns a complete default object when no record exists, without writing a row or creating image assets. First version is 0, updatedAt null, every slot has null images and empty en/ar alt, B2C sections have empty arrays. There is no 404 for untouched configuration.

| data field | Type / presence | Meaning, source, frontend use |
| --- | --- | --- |
| store | Always b2c or b2b string | Comes from route/document key; partition editor/public caches. Never PATCH it. |
| version | Always nonnegative safe integer | Server concurrency version. Retain latest admin GET/PATCH value and send in next PATCH; initially 0. Public GET omits it. |
| allowedSlots | Always ordered array of SlotDefinition | Fixed deployed manifest, not user-created entries or saved overrides. Render supported editor areas; never PATCH it. Six B2C/seven B2B. |
| allowedSlots[].key | Always string | Stable area identifier from table. Reuse in upload path and slots[].key. |
| allowedSlots[].label | Always object with en/ar strings | Bilingual editor label. Choose language for display; never send as key or editable content. |
| allowedSlots[].label.en / .ar | Always non-empty strings | English/Arabic labels in table. |
| allowedSlots[].supportsMobileImage | Always Boolean true in current manifest | Show mobile override picker. This is read-only capability, not an upload option field. |
| slots | Always ordered array of AdminSlot | All deployed areas, even untouched; fixed manifest order. This output is not a replacement PATCH array. |
| slots[].key | Always string | Same manifest key; use it to join display/preview and PATCH entry. |
| slots[].desktopImage | Always Image object or null | Saved desktop override; no fallback applied in this field. |
| slots[].mobileImage | Always Image object or null | Saved mobile override; null means use desktop override/bundled fallback in frontend. |
| slots[].alt | Always object {en:string,ar:string} | Saved bilingual plain alternative text; prefill both language inputs. |
| slots[].alt.en / .ar | Always string, 0–500 after trim | Stored alternative text, initially empty. Public language fallback differs from editor data. |
| newArrivals | B2C only, always object | B2C curated selection. Absent entirely from B2B, not null/empty placeholder. |
| newArrivals.productIds | Always array of 0–20 unique lowercase ID strings | Saved staff order. Includes valid hidden/non-discounted records if selected. Copy as full array to replace selection in PATCH. |
| newArrivals.visibleProductIds | Always array of ID strings | Current public eligible selection in saved order. Compare productIds minus this list to show editor warnings for hidden/missing products. Derived read-only; never PATCH. |
| sale | B2C only, always object | Separate curated selection; does not create/extend campaigns. |
| sale.productIds | Always array of 0–20 unique lowercase ID strings | Saved staff order, including currently undiscounted selections. Use full array for PATCH replacement. |
| sale.visibleProductIds | Always array of ID strings | Selected public products currently having at least one discounted sellable item. Missing/hidden/undiscounted selections are absent. Compare with productIds for warning; reason details require Products/Sales reads. |
| updatedAt | UTC ISO-8601 timestamp string or null | Server saved time; null only for untouched GET defaults. Read-only, not a version. PATCH success always returns a timestamp. |

Every Image is exactly `{id,url,width,height}`:

| Image field | Type | Source and next use |
| --- | --- | --- |
| id | 24-hex string | Media upload identity, public metadata; retain upload data.id as PATCH desktopImageId/mobileImageId for the same store/key/device. Existing resolved Image.id can be reattached to its existing position. |
| url | HTTPS string in configured public CDN | Public processed WebP URL, not the original local file or an upload credential. Use for img/src only; do not submit the URL as an ID. |
| width | Positive integer | Processed pixel width after Sharp; use for aspect ratio/layout. |
| height | Positive integer | Processed pixel height; not original byte size. |

No backend storage keys/zones, actor IDs, database singleton ID, audit fields or createdAt are exposed. Admin GET never returns retail Product bodies: it returns selection IDs and visibility IDs. Use the existing B2C staff Products list/detail to obtain editor names, images, stock and both translations. B2B has no access to B2C homepage editing or selected retail sections.

## PATCH: every input field

Required JSON object: latest numeric version plus at least one recognized editable property. Root/nested unknown keys are rejected. Null or array objects are invalid. Omission preserves. A same-value recognized save is valid and still increments version.

| Body field | Required/type | Bounds, normalization, meaning and source |
| --- | --- | --- |
| version | Required actual JSON integer | 0–9007199254740991, no strings/fractions/negative/null/unsafe values. From latest admin data.version; stale/maximum non-incrementable value gives409 HOMEPAGE_CONFLICT. |
| slots | Optional non-empty array | At most six entries for B2C/seven B2B. Contains partial updates, **not replacement**: unmentioned slots/properties remain. Empty array/null invalid; omit when unchanged. Duplicate keys invalid. |
| slots[].key | Required exact string | One key from this store's allowedSlots manifest. Wrong-store/unknown keys invalid; no new area creation. At least one editable property beyond key is required. |
| slots[].desktopImageId | Optional 24-hex string or null | From this exact store/key/desktop upload data.id; uppercase hex normalizes lowercase. Null clears desktop override only. Omission preserves. Cannot accept URL, other-device, other-slot or other-store asset. |
| slots[].mobileImageId | Optional 24-hex string or null | From same store/key/mobile upload. Null clears mobile only. Omission preserves. Mobile remains optional and desktop fallback is a frontend display rule. |
| slots[].alt | Optional non-empty object | Only en/ar. Partial translation merge; omitted language preserved. Null/arrays/{}/unknown languages invalid. |
| slots[].alt.en / .ar | Optional string in supplied alt | Trimmed 0–500 characters. Empty clears that language, null invalid. Plain text only; public may then fall back to the other language. |
| newArrivals | Optional B2C-only non-empty object | Must contain exactly productIds; null/array/{} and visibleProductIds invalid. B2B rejects this property, even with an empty array. |
| newArrivals.productIds | Required when newArrivals supplied, array | Full ordered replacement, 0–20 unique 24-hex B2C Product IDs; no null/variant IDs. Uppercase hex normalizes lowercase before duplicate detection. [] clears selection. All IDs must still exist; otherwise409 HOMEPAGE_PRODUCT_UNAVAILABLE. Existing inactive/hidden Products are allowed but omitted publicly. |
| sale | Optional B2C-only non-empty object | Exactly productIds, same strict object rules. Selection changes no pricing; current discounts determine public inclusion. |
| sale.productIds | Required when sale supplied, array | Full ordered replacement, 0–20 unique existing B2C Product IDs. Same validation/normalization as New Arrivals. [] clears. A non-discounted Product may stay selected and will become visible if later discounted; admin.visibleProductIds reveals current inclusion. |

Selections in two sections may overlap; uniqueness is within each list. Images and arrays may be edited in one atomic PATCH. Never send store, allowedSlots, updatedAt, resolved desktopImage/mobileImage objects, visibleProductIds, public items, product price/stock/name, response envelopes or arbitrary labels/links. Null IDs remove overrides; they do not remove fixed sections. To clear alt for both languages, explicitly clear both; clearing only Arabic may expose English fallback publicly.

Saved homepage selections are Product references: permanent Product deletion returns409 PRODUCT_REFERENCED until the ID is removed from **both** homepage lists, as well as any other existing module references. Disabling Products/categories remains allowed and hides them from homepage reads. Deleting a variant is not blocked solely by product-level homepage selection; current Product projection recalculates the remaining variants. Selection and Product deletion share the catalog transaction guard, so concurrent edits cannot leave a newly selected missing product.

## Upload: full request/response and image lifecycle

1. GET admin homepage to discover allowedSlots/key and retain editor version. A row need not exist yet; uploading does not create it.
2. Choose desktop/mobile for one area. POST the raw file to that store's `/homepage/media/<key>/<device>` with staff JWT and actual image Content-Type. There are no JSON fields, multipart fields, kind, targetId, version or alt in this request.
3. Retain the 201 response's Image.id (and Image.url/dimensions for preview). Put the ID in the corresponding slots entry's desktopImageId or mobileImageId in PATCH, using current homepage version.
4. A successful PATCH attaches/publishes it. Upload alone creates a ready public asset with a 24-hour unattached lifetime and does not change the old homepage image. Save within that lifetime or upload again. The old live image is not retired unless attachment and settings/audit commit together.

| Path parameter | Required / allowed values | Source |
| --- | --- | --- |
| slotKey | Required exact fixed key, case-sensitive | This store's admin allowedSlots[].key; use URL segment exactly. Unknown key gives422. |
| device | Required literal desktop or mobile, case-sensitive | Frontend image-picker choice. Unknown/tablet/language values give422. |

JPEG, PNG and WebP only; maximum5MiB raw file, maximum20 million decoded pixels. Actual format is checked against MIME; corrupt/spoofed files are rejected. Sharp applies orientation, bounds the processed dimensions to1600px, outputs WebP and strips metadata. There is no arbitrary URL import, animated media feature, SVG/GIF, per-language upload or Bunny credential in frontend input. Returned URL is public; never use this endpoint for private proofs/Lead images.

Internal homepage-desktop/mobile media kinds bind a deterministic store/area target. These internal identifiers are deliberately not frontend request fields and are not accepted by ordinary `/admin/{store}/media/:kind/:targetId`. Existing product/category/size-chart images cannot be attached to homepage areas, and homepage images cannot be shared between areas/devices/stores. The two hero images may depict related content, but each area/device requires its own upload record. Product galleries are untouched.

An upload timeout does not prove failure: its stored cleanup obligation survives uncertain provider writes. Retry creates a new asset, not a replay of the first one; use only the ID actually received. Failed/abandoned assets are removed by existing cleanup. Attached assets do not expire at24h. Replaced/cleared assets are retired transactionally, then physically deleted after commit; failed removal stays pending for durable cleanup retry. CDN caching can outlive deletion; clearing an override does not guarantee immediate global purge. Never manually delete an asset still referenced by a homepage.

## Public GET: exact DTO and Product inclusion

Public data is exactly `{store,slots,updatedAt}` for B2B. B2C additionally always has `{newArrivals:{items:[]},sale:{items:[]}}`. It contains no version/allowedSlots/productIds/visibleProductIds. Store/timestamp and image fields have the meanings above. Public slots are the same fixed ordered areas with `{key,desktopImage:Image|null,mobileImage:Image|null,alt:string}`. Alternative text is localized; image overrides are shared for both languages. All documented keys remain present, even null/empty.

Each B2C items array preserves the saved product order after filtering. A missing/inactive Product or a Product in an inactive/hidden ancestor category is omitted. Zero-stock Products remain eligible; this read does not reserve stock. Sale additionally requires at least one real simple item/variant with effectivePrice lower than its own base price. Saved discountedPrice and current active campaigns both qualify. A cheap undiscounted variant is not by itself a discount. Ending/disabling a campaign can remove a product from Sale without editing the homepage; a saved base discount can keep it eligible. The normal Sales calculator owns replacement-discount semantics; coupons still exclude active campaigns under the existing coupon rules.

`newArrivals.items[]` and `sale.items[]` are the existing localized public Product-detail projection. The [Products contract](../products/PRODUCTS_FRONTEND.md) defines every nested field and complete examples. Field map for integration:

| Product field | Presence/type | Meaning and reuse |
| --- | --- | --- |
| id | Always 24-hex string | Product identity; open public Product detail with it, save Wishlist product ID, or use Cart productId. Never use a slug as an API ID. |
| type | Always simple/variant | Simple adds directly using productId; variant requires a real chosen variant.id from detail/options. |
| categoryId | Always ID string | Assigned category, from catalog; category links/filtering use Categories. |
| name / description | Always localized strings | Display text, not editor translation objects or identifiers. |
| slug | Always string | Presentation-friendly URL text; backend lookup remains ID-based. |
| isActive | Always Boolean true for returned public products | Public visibility filter already applied; category visibility also checked. |
| images | Always Image[] | Parent gallery, possibly empty. Use image fallback UI, never invent an asset. |
| currency | Always EGP | Money fields are integer piastres; divide by100 only for display. |
| sku | Simple only, string/null | Optional product SKU, not identity. Variant SKUs live on variants[].sku. |
| price / discountedPrice / effectivePrice / stock | Simple only: integers; discountedPrice nullable | Base price, saved discount, current effective price, available units. Campaign application can replace effectivePrice; no homepage price override. Stock is informational until Cart/Checkout checks again. |
| activeSale | Simple only when pricing projection adds it: object/null | Existing campaign DTO `{id,name,discountType,discountValue,startsAt,endsAt}`. Name is localized, type percentage/fixed, value percentage/integer piastres accordingly, dates UTC strings; not a coupon or guaranteed future price. |
| options | Variant only, array | Real option definitions: `key`, localized `name`, `values[]` with stable `key` and localized `name`. Use definitions to build choices; no invented combinations. |
| variants | Variant only, array | Each real variant has `id,values,sku,price,discountedPrice,effectivePrice,stock,images`, and `activeSale` when pricing projection adds it. values is a definition-driven option-key/value-key map; parent gallery fallback applies when variant gallery is empty. Choose actual variant ID for Cart. |
| priceFrom | Variant only, integer | Lowest current effective variant price. Not necessarily the price of a discounted variant; do not invent a crossed-out base price by combining unrelated variants. |
| sizeChart | Always localized PublicSizeChart object or null | `{id,name,image,alt,measurements}` from an assigned active guide. `image` is Image or null; `measurements` is a table or null. Numeric-only guides therefore have a null image, image-only legacy guides have null measurements, and mixed guides return both. Render numeric data first and use the image as fallback otherwise. Guide ID is not a variant or image-attachment credential. See Size Charts/Products. |

`sizeChart.id` is the chart ID; `name` and `alt` are localized strings, with alt fallback to the other language and then name. `image` is null or `{id,url,width,height}`: the ID is a public media ID, URL is the processed public WebP, and dimensions are processed integer pixels (1–1600). `measurements` is null or `{unit:"cm",rows:[{size,chest,length,sleeve}]}`. `unit` is shared across the table; `rows` are ordered and shared across English and Arabic. Each row's `size` is its display label, and chest/length/sleeve are numeric centimetre values. The frontend localizes measurement labels. Values have no server-defined flat-width or circumference meaning. Homepage uses the same localized public projection as Product detail; it does not return chart version, assigned-product count, or Product `sizeChartId`.

Homepage Product items deliberately omit list-only matchingPrice/matchingVariantId, admin version and sizeChartId. They have no homepage rank property; array order is rank. No Product is duplicated in storage or repriced by homepage. A visitor must still open Product detail and select size/color before adding a variant product; no automatic quick-add or stock reservation is introduced.

## Concrete requests and complete examples

### Untouched B2C public response

GET /api/v1/b2c/homepage with X-Language: en, no token/body:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "store": "b2c",
    "slots": [
      { "key": "hero-left", "desktopImage": null, "mobileImage": null, "alt": "" },
      { "key": "hero-right", "desktopImage": null, "mobileImage": null, "alt": "" },
      { "key": "collection-men", "desktopImage": null, "mobileImage": null, "alt": "" },
      { "key": "collection-women", "desktopImage": null, "mobileImage": null, "alt": "" },
      { "key": "sale-feature", "desktopImage": null, "mobileImage": null, "alt": "" },
      { "key": "factory-story", "desktopImage": null, "mobileImage": null, "alt": "" }
    ],
    "updatedAt": null,
    "newArrivals": { "items": [] },
    "sale": { "items": [] }
  },
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

B2B untouched public response has exactly the same envelope and store/updatedAt/slots shape, with seven B2B keys from the manifest and no newArrivals/sale keys. All seven image fields are null and alt strings empty. Both untouched admin reads return their complete manifest, version0, bilingual empty slot.alt and, on B2C only, `{productIds:[],visibleProductIds:[]}` for both sections.

### Raw upload response

POST /api/v1/admin/b2c/homepage/media/hero-left/desktop with Authorization and Content-Type: image/png sends actual file bytes. Complete201 response example:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "id": "66f000000000000000000020",
    "url": "https://assets.example.test/narmer/b2c/catalog/homepage-desktop/66f000000000000000000030/66f000000000000000000020.webp",
    "width": 1200,
    "height": 800
  },
  "requestId": "22222222-2222-4222-8222-222222222222"
}
```

Retain data.id as desktopImageId for hero-left; URL/target-like path components do not grant attachment elsewhere. Real server-generated internal target paths differ from the synthetic example and must never be constructed by frontend code.

### B2C save body

GET admin first; assume current version0, one ready desktop upload and real Product IDs from admin Products. PATCH /api/v1/admin/b2c/homepage:

```json
{
  "version": 0,
  "slots": [
    { "key": "hero-left", "desktopImageId": "66f000000000000000000020", "mobileImageId": null,
      "alt": { "en": "Cotton clothing", "ar": "ملابس قطنية" } }
  ],
  "newArrivals": { "productIds": ["66f000000000000000000001", "66f000000000000000000002"] },
  "sale": { "productIds": ["66f000000000000000000002"] }
}
```

Success is200, complete admin data version1, server updatedAt and all six slots/manifest. Other five slots keep default images/text. The selected IDs remain ordered in productIds. visibleProductIds currently filters visibility/discounts and can differ. Frontend must use the returned complete normalized data/version, not merge an assumed local increment.

### B2B partial save: complete admin response

For untouched B2B, PATCH /api/v1/admin/b2b/homepage with `{ "version": 0, "slots": [{ "key": "hero", "alt": { "en": "Manufacturing services" } }] }` returns:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "store": "b2b",
    "version": 1,
    "allowedSlots": [
      { "key": "hero", "label": { "en": "Main banner", "ar": "البنر الرئيسي" }, "supportsMobileImage": true },
      { "key": "service-spinning", "label": { "en": "Spinning service", "ar": "خدمة الغزل" }, "supportsMobileImage": true },
      { "key": "service-weaving", "label": { "en": "Weaving service", "ar": "خدمة النسيج" }, "supportsMobileImage": true },
      { "key": "service-fabric", "label": { "en": "Fabric service", "ar": "خدمة الأقمشة" }, "supportsMobileImage": true },
      { "key": "service-school-uniforms", "label": { "en": "School uniforms service", "ar": "خدمة الزي المدرسي" }, "supportsMobileImage": true },
      { "key": "service-wholesale", "label": { "en": "Wholesale service", "ar": "خدمة الجملة" }, "supportsMobileImage": true },
      { "key": "wholesale-overview", "label": { "en": "Wholesale overview", "ar": "صورة نظرة عامة على الجملة" }, "supportsMobileImage": true }
    ],
    "slots": [
      { "key": "hero", "desktopImage": null, "mobileImage": null, "alt": { "en": "Manufacturing services", "ar": "" } },
      { "key": "service-spinning", "desktopImage": null, "mobileImage": null, "alt": { "en": "", "ar": "" } },
      { "key": "service-weaving", "desktopImage": null, "mobileImage": null, "alt": { "en": "", "ar": "" } },
      { "key": "service-fabric", "desktopImage": null, "mobileImage": null, "alt": { "en": "", "ar": "" } },
      { "key": "service-school-uniforms", "desktopImage": null, "mobileImage": null, "alt": { "en": "", "ar": "" } },
      { "key": "service-wholesale", "desktopImage": null, "mobileImage": null, "alt": { "en": "", "ar": "" } },
      { "key": "wholesale-overview", "desktopImage": null, "mobileImage": null, "alt": { "en": "", "ar": "" } }
    ],
    "updatedAt": "2026-10-22T12:00:00.000Z"
  },
  "requestId": "33333333-3333-4333-8333-333333333333"
}
```

Arabic public GET now returns hero.alt `"Manufacturing services"` through fallback. It does not return the bilingual object or editor manifest/version.

### Clear/reorder body

After version1, B2C can clear only hero-left images/text and replace both product lists. This is not a full slot replacement or reset endpoint:

```json
{
  "version": 1,
  "slots": [{ "key": "hero-left", "desktopImageId": null, "mobileImageId": null, "alt": { "en": "", "ar": "" } }],
  "newArrivals": { "productIds": ["66f000000000000000000002", "66f000000000000000000001"] },
  "sale": { "productIds": [] }
}
```

Complete response version2 preserves all unmentioned slots. Public newArrivals follows the new order after filtering; public sale.items becomes empty and its heading/grid should hide. The fixed Sale editorial image/copy area is separately controlled by the approved frontend layout; clearing a product list does not mutate its image override or imply removal of that fixed area.

## Full frontend flow and state retention

1. On website entry fetch the correct public homepage with UI language. This can run alongside public Site Settings and Categories; none creates a login/cart. Keep homepage state partitioned by store/language. Render fixed slots with the device fallback rule, and B2C product cards from returned items in order. Hide an empty section's product heading/grid; do not fabricate newest/discounted products to fill it.
2. Loading/error differs from an empty200. Retain the last valid view during refresh if appropriate, and show approved image placeholders/static content when unavailable. Do not replace a failed request with fake merchandise/prices. Product detail/Cart/Checkout and B2B Forms/Leads remain separate flows and can function without homepage customization.
3. Dashboard: GET admin, prefill manifest/alt/overrides and B2C selected lists. Retain version and unsaved local edits. Use B2C admin Products to populate an existing product picker; exact product IDs, not variant IDs. Mark productIds omitted from visibleProductIds with a warning. Their status/pricing may change without a homepage version increment.
4. For each image, upload raw bytes to its exact store/key/device, retain returned Image.id and show preview. Upload replacement does not publish until PATCH. Do not switch the old live image in canonical state or discard unsaved input merely because upload finished.
5. Save latest version plus edited fields. Disable duplicate submit while pending. Replace editor baseline/version with the entire success data. Invalidate/refetch this store's public language caches; no draft/second publish operation exists. Other store and product galleries are unaffected.
6. On version conflict keep unsaved input, GET current admin state, compare/reapply only intended differences and ask staff to save against the new version. Do not silently overwrite a competing editor's work. Ready uploaded IDs can be reused only within their original scope and24h lifetime.
7. On Product deletion conflict remove the product from both homepage selection lists with current homepage version first, then retry deletion through Products using its existing role/reference rules. Other module references may still block it. Disabling a product/category hides it immediately on fresh public reads without destroying saved selection IDs.
8. Refresh public homepage at relevant Sale start/end boundaries or when returning to the page; the API does not push updates. Its timestamps/version are configuration metadata, not a guarantee that product stock/visibility/pricing stayed unchanged. Products, Cart and Checkout independently revalidate.

| Retained state | Source | Exact subsequent use |
| --- | --- | --- |
| store/UI language/device | Frontend routing/preferences/viewport | Choose API prefix, X-Language, fixed placement and mobile/desktop display. Device is an upload path value only when selecting an override. |
| accessToken | Same-store Auth login/refresh | Authorization for admin GET/PATCH/upload. Replace on refresh, clear private state on logout/account/store changes. |
| version | Latest admin data.version | Required unchanged numeric value in next PATCH. Not public updatedAt or a Product.version. |
| allowedSlots[].key | Admin deployed manifest | Upload slotKey and slots[].key. Never send allowedSlots back. |
| Image.id | Upload data.id | PATCH same slot/device desktopImageId/mobileImageId. URL/dimensions for preview only. Keep after a failed/conflicting save while still ready/unexpired. |
| selection productIds | Admin selection or B2C admin Products data.id | Full ordered newArrivals/sale productIds replacement. Not options/variant IDs or a campaign definition. |
| visibleProductIds | Admin GET/PATCH | Read-only warning state; refresh when catalog/pricing changes. Never submit it. |
| public items[].id/variants/options | Public Products in homepage/detail | Navigate/detail/select real variant, then use Cart/Wishlist contracts. Homepage does not start checkout. |
| requestId | Shared response | Support diagnostics only, not a replay or concurrency key. |

## Atomicity, uncertain outcomes and expiry

Settings, media attachment/retirement and audit commit together in the existing MongoDB transaction. First customization creates version1; untouched reads/uploads do not create settings. Safe compare/increment and store singleton uniqueness prevent lost edits and duplicate first-save rows. B2C edits/selection validation and Product deletion share the existing catalog transaction guard. No stock is reserved/deducted, no Order/Lead created, no email/feed event enqueued.

There is no idempotency key or saved replay response. A timed-out PATCH may have committed, including a post-commit view failure: GET current admin before retrying. If exact old version retries after a committed save it conflicts; do not automatically replace it with the latest version. Compare saved fields to unsaved intent and competing changes. Reads are safely retryable. Upload retries create new IDs; orphaned uncertain uploads use the cleanup obligation. Provider deletion failure after commit does not undo settings and is retried by cleanup.

## Errors and recovery

Error bodies contain `success:false`, stable code, localized message, errors array and requestId; success contains `success:true`, code OK, message, data and requestId. Validate using codes/fields, never parse translated message text. Validator errors have field/location/code/message; root/service failures may use errors:[]. No success data appears on an error.

| HTTP / code | Trigger | Frontend recovery |
| --- | --- | --- |
| 401 UNAUTHORIZED | Missing/expired/revoked/malformed/wrong-store JWT | Auth refresh/relogin as appropriate; retain unsaved editor state safely. |
| 403 FORBIDDEN | Current account not same-store superAdmin/admin | Disable editing/upload and reconcile role; moderators cannot edit content. |
| 403 CORS_DENIED | Unconfigured browser Origin | Correct deployment/API origin; browser may expose only a fetch failure. |
| 422 VALIDATION_ERROR | Invalid version/type/object/selection bounds, unknown fields/slot/device/language, duplicates or missing editable fields | Correct input using this contract; preserve edits and ready upload IDs. |
| 409 HOMEPAGE_CONFLICT | Stale/overflow version, concurrent first-save singleton collision or compare/update loss | Reload/reconcile. At maximum version involve backend maintenance rather than repeated saves. |
| 409 HOMEPAGE_PRODUCT_UNAVAILABLE | A selected ID no longer exists or isn't a B2C Product | Reload product picker/remove missing ID. Variant IDs cannot replace Product IDs. Hidden-but-existing products are allowed and filtered publicly. |
| 409 MEDIA_CONFLICT | Wrong area/device/store/namespace, non-ready/expired upload or invalid previous attachment | Keep old live image; reupload to correct position or refresh version/state. No partial attachment. |
| 422 INVALID_IMAGE | Corrupt image, MIME mismatch, invalid decoded format/dimensions or pixel limit | Choose a valid bounded JPEG/PNG/WebP with matching MIME. |
| 415 IMAGE_TYPE_UNSUPPORTED | Upload MIME is not supported | Send raw supported file with exact MIME; no multipart/JSON/SVG. |
| 413 BODY_TOO_LARGE | Raw upload exceeds5MiB or JSON exceeds100KiB | Reduce input/file size; no silent truncation. |
| 415 UNSUPPORTED_ENCODING | Unsupported compression/character encoding | Send normal uncompressed supported file or UTF-8 JSON. |
| 400 INVALID_JSON | Malformed PATCH serialization | Fix JSON, keep local edits. |
| 503 MEDIA_UNAVAILABLE | Public Bunny config absent/invalid | Configure backend storage; do not change frontend to direct credentialed Bunny upload. Public reads/text/selection editing still work without new file uploads. |
| 502 MEDIA_STORAGE_FAILED | Bunny upload request/status/timeout failure | Keep existing homepage state; retry deliberately and retain only a received Image ID. Cleanup handles uncertain writes. |
| 429 TOO_MANY_REQUESTS | Shared IP/account/upload quotas | Honor Retry-After; stop polling/repeated upload/save. Do not refresh credentials to bypass limits or discard state. |
| 404 NOT_FOUND | Unsupported route/method | Correct API path; untouched homepage itself returns200 defaults. |
| 500 INTERNAL_ERROR | Unexpected database/audit/transaction/view error | Preserve input/requestId; GET before retry if save outcome uncertain. |

Image/storage failure codes above are actual shared image-pipeline codes. When a Product is still selected, its separate DELETE returns409 PRODUCT_REFERENCED; clear lists first as described. Null public images/empty product arrays are successful states, not errors.

Example stale update:

```json
{
  "success": false,
  "code": "HOMEPAGE_CONFLICT",
  "message": "The homepage changed. Reload it before saving.",
  "errors": [],
  "requestId": "44444444-4444-4444-8444-444444444444"
}
```

## Verification limits

Focused unit/actual Express HTTP tests cover all eight routes, both stores/roles, fixed definitions, default/no-write reads, public/admin field differences, strict nested input/bounds, raw file MIME/size/decoding, wrong slot/device/store asset rejection, bilingual alt merging/fallback, ready expiry, atomic audit/media rollback, post-commit cleanup retry, safe version conflicts/overflow, curation order/visibility/Sale expiry and assignment-versus-Product-delete serialization. The account-limiter HTTP test also checks homepage/catalog/size-chart shared upload quota. Fixtures use in-memory repositories and mocked storage; live database transaction contention, CDN invalidation, real browser image/layout behavior and deployment acceptance remain separate. Final regression, Apidog and package evidence is in [readiness](../../../../docs/frontend/integration-readiness.md).
