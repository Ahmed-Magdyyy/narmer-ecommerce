# Sales frontend handoff (B2C)

Source checked: 2026-10-13. Sales is mounted and initialized in the application. Its five dashboard operations manage timed campaigns; Products and Cart apply their prices on current reads. Read [API conventions](../../../../docs/frontend/api-conventions.md), [B2C flow](../../../../docs/frontend/b2c-flow.md), [Products](../products/PRODUCTS_FRONTEND.md), [Categories](../categories/CATEGORIES_FRONTEND.md), and [Cart](../cart/CART_FRONTEND.md).

## Confirmed behavior and boundaries

B2C Sales defines timed percentage/fixed-amount campaigns on selected whole products or one selected category. A product campaign covers the simple product or all its variants. An active campaign replaces the saved discount rather than stacking. Baseline prices/discounts remain saved so expiry or manual disabling restores normal pricing on subsequent reads. No bulk price rewriting/restoration job is needed.

Only superAdmin/admins can manage campaigns; only superAdmin can delete. Moderators, customers, guests, and B2B credentials cannot manage them. Coupon interactions are confirmed separately: only lines without an active sale can receive a coupon. Coupons preview is implemented separately; Orders uses campaign prices during preview and placement; this component does not calculate checkout totals, reserve stock, redeem a coupon, accept money, or create an order.

## Dashboard routes

These routes are mounted in the normal application.

| Method/path | Role | Input | Success |
| --- | --- | --- | --- |
| `GET /api/v1/admin/b2c/sales` | superAdmin/admin | List query below; no body | 200, `{items,pagination}` |
| `GET /api/v1/admin/b2c/sales/:saleId` | superAdmin/admin | Required path ID; no body/query | 200, Sale DTO |
| `POST /api/v1/admin/b2c/sales` | superAdmin/admin | Create JSON below | 201, created Sale DTO |
| `PATCH /api/v1/admin/b2c/sales/:saleId` | superAdmin/admin | ID plus partial JSON | 200, updated Sale DTO |
| `DELETE /api/v1/admin/b2c/sales/:saleId` | superAdmin only | ID; no body/query | 200, `data: null` |

There is no public sale-list/detail endpoint, no B2B Sales endpoint, and no separate enable/disable endpoint. Use `isEnabled` on PATCH to disable a campaign. Every dashboard call needs a B2C staff bearer token. JSON writes need application/json. Locale selects feedback messages; dashboard names are always bilingual. Envelopes, headers, Origin/CORS, request IDs, body-size limits, and general failures follow shared conventions.

## Every path/query field

| Field/location | Type, validation, default | Meaning/source and retention |
| --- | --- | --- |
| Path `saleId` | Required 24-character hexadecimal ObjectId | Returned Sale `id`; keep for detail/edit/delete. Malformed ID is 422; valid missing ID is 404. |
| Query `page` | Optional integer URL string 1–100000; coerced to number; default 1 | Requested page, retained with filters. |
| Query `limit` | Optional integer URL string 1–100; coerced to number; default 20 | Requested page size. |
| Query `isEnabled` | Optional exact URL string `true`/`false`; coerced to boolean | Filters the saved enable flag, not whether the clock makes the campaign active. Omitted selects both. |
| Query `targetType` | Optional `products`/`category` | Filters saved scope kind; omitted selects both. |

Sorting is newest creation first, then descending ID. There is no search, status/date filter, custom sorting, cursor, product filter, or category filter. Unknown query fields do not introduce those capabilities. A GET list can return no items with a nonzero total if the requested page is beyond the result range.

## Every create/PATCH field

Only validated fields below are used. The URL sets store. Caller cannot set `id`, store, actor, currency, status, timestamps, audit data, or product prices. There is no client edit version.

| Field | Create | PATCH | Type/limits/defaults | Meaning, source, and next use |
| --- | --- | --- | --- | --- |
| `name` | Supplies both leaves | Optional supplied leaves | Bilingual container; only ar/en are recognized | Campaign label entered by staff; does not rename a product. |
| `name.ar` | Required | Optional | Trimmed string 1–150 characters, non-null | Arabic label; retain returned translation in editor. |
| `name.en` | Required | Optional | Same constraints | English label; omitted PATCH leaf preserves it. |
| `targetType` | Required | Optional | Literal `products` or `category` | Selects mutually exclusive target configuration. |
| `productIds` | Required nonempty for products scope; absent/empty for category scope | Optional; full replacement when supplied | Array of at most 100 distinct existing B2C product IDs; strings are normalized lowercase; null invalid | Choose IDs from dashboard Products, including inactive products. Keep IDs for editing, not SKU/slug/variant IDs. |
| `categoryId` | Required for category scope; absent/null for products scope | Optional; null only for products scope | Null or existing B2C category ObjectId | Choose from Categories. Includes the selected category and all current descendants, even newly added or moved descendants when the catalog edit is allowed. |
| `discountType` | Required | Optional | `percentage` or `fixed` | Determines unit of discountValue. It can be changed, but the final value must remain valid. |
| `discountValue` | Required | Optional | Actual JSON integer; percentage 1–100; fixed 1–1000000000 | Whole percentage points for percentage, EGP piastres for fixed. 20 means 20% or EGP 0.20 depending on type. Not a final product price. |
| `startsAt` | Required | Optional | Explicit-timezone ISO date-time string | Staff-selected start, inclusive. Retain returned UTC timestamp for editing. |
| `endsAt` | Required | Optional | Same date-time form, strictly after final startsAt | Staff-selected end, exclusive. Retain the returned UTC timestamp for later edits; no unlimited/null end is supported. |
| `isEnabled` | Optional; defaults true | Optional | Actual JSON boolean, non-null | Explicit manual enable flag. False disables regardless of dates; enabling an expired campaign does not extend it. |

Date-time format: `YYYY-MM-DDTHH:mm:ss`, optionally 1–3 fractional digits, followed by `Z` or an offset such as `+02:00`. Example `2026-10-11T14:00:00+02:00` returns `2026-10-11T12:00:00.000Z`. Date-only strings, missing timezone, invalid calendar dates, numeric timestamps, and null are rejected through HTTP validation. The schedule can be historical, current, or future; no automatic adjustment is performed. Frontend local date-time inputs must be converted to the documented explicit timezone form before submission.

PATCH preserves omitted fields and individual translations. A supplied productIds array replaces all selected products. On changing targetType, an omitted old-scope field is cleared automatically: switching products → category requires the new categoryId and clears omitted productIds; switching category → products requires the new productIds and clears omitted categoryId. Explicitly supplying contradictory target fields is invalid. Changing a category ID within category scope replaces its target. Product/Category IDs must currently exist even if the campaign is disabled or expired.

Percentage values are whole integers. A fixed value can exceed an item price; the result clamps to zero. The pricing and rounding contract is detailed below.

Empty PATCH or unknown-only body is 422 INVALID_SALE. Percent 0/101, fractional/string/null values, duplicate IDs, products scope with no products, category scope with product IDs, nonexistent targets, or a final end not after start are rejected. An enabled campaign applies only within its schedule and only to matching publicly available products.

## Overlap and category scope rules

Two enabled campaigns cannot cover the same whole product during intersecting schedules. Intervals are [startsAt, endsAt): one campaign ending exactly when another starts is allowed. Disabled drafts can overlap; enabling them rechecks conflicts. Scheduled and expired enabled campaigns are checked against their stored dates, even when neither is active now. No price stacking or best-price selection exists.

Products scope covers every variant. Category scope follows the current tree, includes descendants regardless of visibility, and applies to future products in that subtree. Two category targets that are the same or ancestor/descendant conflict even if they have no products yet. Product/category overlap is checked using the selected product's category ancestry, including inactive products. Separate branches or disjoint products can run simultaneous campaigns.

Product category moves and category reparenting are rejected with 409 SALE_OVERLAP if the proposed catalog would make enabled campaigns overlap. Disable, reschedule, or retarget a campaign first. No deletion cascade or automatic campaign disabling occurs. Sales and catalog writes use the same transactional catalog guard to prevent competing writes bypassing the check. There is no endpoint listing all conflicting campaign IDs; reload the staff list (including pagination) to inspect scopes/dates.

## Every Sale response field

| Field | Type/presence/source | Meaning and retained state |
| --- | --- | --- |
| `id` | Always lowercase ObjectId string | Backend-generated campaign ID; retain for detail/PATCH/DELETE. |
| `name` | Always `{ar,en}` object | Stored campaign label, independent of X-Language. |
| `name.ar`, `name.en` | Always nonempty strings | Stored trimmed labels; retain both for edit. |
| `targetType` | Always products/category string | Stored mutually exclusive scope kind. |
| `productIds` | Always array of strings | Stored selected product IDs; nonempty for products, empty for category. Preserve all desired IDs on replacement. |
| `productIds[]` | Lowercase ObjectId string | One source product ID; not a selected variant ID. Labels/details come from Products, not this DTO. |
| `categoryId` | Always ObjectId string or null | Stored category target or null for products. Category label/tree comes from Categories. |
| `discountType` | Always percentage/fixed string | Stored discount unit. |
| `discountValue` | Always positive integer | Stored whole percentage or piastre amount, depending on type. |
| `startsAt` | Always ISO UTC string ending `.sssZ` | Stored start rendered in UTC. |
| `endsAt` | Always ISO UTC string ending `.sssZ` | Stored exclusive end rendered in UTC. |
| `isEnabled` | Always boolean | Stored manual enable flag; not a clock-derived flag. |
| `status` | Always disabled/scheduled/active/expired string | Derived for this response from enable flag and server time. Read-only; must not be sent as a writable field. |
| `currency` | Always literal EGP string | Backend currency; fixed discounts use its integer minor units. Percentage values remain percentage points. |

Status precedence: disabled if isEnabled false; otherwise scheduled before startsAt; otherwise expired at/after endsAt; otherwise active. At the exact start it is active, at the exact end it is expired. List responses use one captured time for all rows. Status is not persisted and changes without a background job. “Active” means its schedule applies now; public Products/Cart use it for matching visible sellable items.

No `store`, createdAt/updatedAt, edit version, actor, audit, product labels, category label, coupon, image, stock, effective price, or customer ownership field is returned.

List data contains `items` (array of Sale DTOs) and `pagination` (object). Its page/limit are effective requested/default integers, total is matching record count, and pages is ceil(total/limit), zero if total zero. All four keys are required. Empty page data example:

```json
{ "items": [], "pagination": { "page": 1, "limit": 20, "total": 0, "pages": 0 } }
```

## Complete examples

Create a selected-product campaign, request body:

```json
{
  "name": { "ar": "تخفيضات الصيف", "en": "Summer sale" },
  "targetType": "products",
  "productIds": ["66f000000000000000000001"],
  "categoryId": null,
  "discountType": "percentage",
  "discountValue": 20,
  "startsAt": "2026-10-11T12:00:00Z",
  "endsAt": "2026-10-12T12:00:00Z",
  "isEnabled": true
}
```

Complete inner data response while the server time is within that interval:

```json
{
  "id": "66f000000000000000000050",
  "name": { "ar": "تخفيضات الصيف", "en": "Summer sale" },
  "targetType": "products",
  "productIds": ["66f000000000000000000001"],
  "categoryId": null,
  "discountType": "percentage",
  "discountValue": 20,
  "startsAt": "2026-10-11T12:00:00.000Z",
  "endsAt": "2026-10-12T12:00:00.000Z",
  "isEnabled": true,
  "status": "active",
  "currency": "EGP"
}
```

Create a category fixed-amount campaign:

```json
{
  "name": { "ar": "خصم الملابس", "en": "Clothing discount" },
  "targetType": "category",
  "categoryId": "66f000000000000000000010",
  "discountType": "fixed",
  "discountValue": 5000,
  "startsAt": "2026-10-11T12:00:00Z",
  "endsAt": "2026-10-12T12:00:00Z"
}
```

That fixed amount is EGP 50. Its DTO includes productIds:[] and isEnabled:true. PATCH `{ "isEnabled": false }` disables, PATCH `{ "name": { "en": "Updated sale" } }` edits only English, and GET/DELETE require no JSON body. All successes are wrapped in the standard envelope with code OK, translated message and requestId; DELETE has data:null. Production requests also require configured application deployment and valid scoped credentials.


### Every activeSale field

Public simple Products return `activeSale`; public variant Products return it on every `variants[]` sellable item. Cart returns it on every `items[]` line. It is always null or the complete object below. Dashboard Product DTOs omit it and expose saved prices. A variant product has no parent-level activeSale field.

| Field | Type/source | Meaning and retention |
| --- | --- | --- |
| `activeSale` | Null or object, calculated from enabled campaign and server time | Null means no active timed campaign, including unavailable Cart lines. A saved product discount alone does not make it non-null. Retain for rendering/eligibility, never submit as pricing authority. |
| `activeSale.id` | Lowercase 24-hex Sale ID string | Applied campaign reference. Staff can use it for the Sales detail path; shoppers have no public Sales detail route. |
| `activeSale.name` | Localized string from campaign name.ar/name.en | Label in the response language, not a bilingual object and not the product name. Keep with that locale's cache only. |
| `activeSale.discountType` | Literal percentage or fixed | Unit for discountValue. |
| `activeSale.discountValue` | Positive integer | Whole percentage points, or piastres for fixed; not the resulting item price. |
| `activeSale.startsAt` | ISO UTC string ending .sssZ | Applied campaign's inclusive start; server determines activation. |
| `activeSale.endsAt` | ISO UTC string ending .sssZ | Applied campaign's exclusive end. Refetch after this time; a cached response does not update itself. |

During an active campaign, price remains the saved base price; discountedPrice is the campaign result and effectivePrice (Cart unitPrice) equals that result. Percentage result is `price - floor(price * discountValue / 100)`. Fixed result is `max(0, price - discountValue)`. Apply independently to each variant, then recompute priceFrom. The saved discount is replaced even when it was a lower price. Zero remains valid; even a campaign producing no reduction is still an activeSale for coupon eligibility. Campaigns never change stored price/discount or stock. At expiry, manual disable, or deletion, the next read uses the current saved discount/base price, including staff edits made while the campaign was active. One captured server time determines campaign activation for an entire Products batch.

Do not copy public campaign discountedPrice into a dashboard price editor. Refetch Product/Cart data after campaign or catalog edits and before later checkout. Refetching replaces retained display metadata; it never locks a price. [Coupons](../coupons/COUPONS_FRONTEND.md) preview is implemented and excludes these activeSale lines. Orders snapshots current campaign metadata and price at placement.

Complete public simple Product data while the example campaign is active. Dashboard Product data still exposes its saved discountedPrice and omits activeSale:

```json
{
  "id": "66f000000000000000000001",
  "type": "simple",
  "categoryId": "66f000000000000000000010",
  "name": "Shirt",
  "description": "Cotton shirt",
  "slug": "cotton-shirt",
  "isActive": true,
  "images": [
    {
      "id": "66f000000000000000000020",
      "url": "https://cdn.example/narmer/b2c/catalog/product/66f000000000000000000001/66f000000000000000000020.webp",
      "width": 1200,
      "height": 1600
    }
  ],
  "currency": "EGP",
  "sku": "SHIRT-01",
  "price": 25000,
  "discountedPrice": 20000,
  "effectivePrice": 20000,
  "activeSale": {
    "id": "66f000000000000000000050",
    "name": "Summer sale",
    "discountType": "percentage",
    "discountValue": 20,
    "startsAt": "2026-10-11T12:00:00.000Z",
    "endsAt": "2026-10-12T12:00:00.000Z"
  },
  "stock": 12
}
```

## Dashboard flow, side effects and retry behavior

Sign in as B2C admin/superAdmin, choose existing Products/Categories targets, enter the bilingual label/discount/schedule, create, retain returned id, and replace form state with the canonical DTO after each edit. Refetch public products/cart after campaign changes; their current prices and activeSale metadata are calculated on each read.

Mutations authorize current staff inside a MongoDB transaction, acquire the existing catalog guard, validate target existence, write the campaign and actor/action/field-name audit in that same transaction. An audit/write failure rolls back both. No provider request or timer is part of this component. No new dependencies are installed.

There is no optimistic client version or HTTP idempotency key. The catalog guard serializes writes; successful edits use the latest transaction-visible campaign with the supplied partial changes. Another staff member can intentionally replace the same field. After a lost create response, reconcile through the staff list before creating again, since replay is not idempotent: an enabled same-scope/time replay conflicts, while a disabled replay can create a second definition. Reload a missing/conflicting target before retrying. Safe state reconciliation is required; a network failure alone cannot establish whether a write committed.

All saved campaigns, including disabled/expired ones, block permanent deletion of explicitly selected products or their directly targeted category. Product campaigns target whole products, so they do not independently prevent removal of a variant; live Cart and historical Order references still do. Category deletion also requires no children/products. Retarget or delete the referencing campaign first. Removing a Sale itself is allowed for superAdmin and ends its public pricing on the next read. Historical Orders retain the purchased campaign name/price metadata after definition edits/deletion; later order totals do not change.

## Every module error and action

| HTTP/code | Trigger | Frontend action |
| --- | --- | --- |
| 401 UNAUTHORIZED | Missing/stale/wrong-store bearer credentials | Follow B2C Auth refresh/login recovery. |
| 403 FORBIDDEN | Moderator/customer role or admin DELETE | Hide forbidden actions; refresh does not grant permission. |
| 404 SALE_NOT_FOUND | Scoped well-formed target campaign missing | Reload the list and remove stale selection. |
| 409 SALE_TARGET_NOT_FOUND | Selected Products/Category no longer exists | Reload target selector, correct scope and retry. |
| 409 SALE_OVERLAP | Enabled scopes share products/category ancestry during intersecting time intervals, including attempted enable/catalog move | Change dates or targets, or disable the conflicting campaign. Reload Sales and catalog selectors; failed writes preserve all previous state. |
| 409 SALE_CONFLICT | Campaign update could not commit its expected target | Reload before retrying. |
| 422 VALIDATION_ERROR | Field/path/query format failure | Map errors[] to inputs; individual fields carry INVALID_FIELD. |
| 422 INVALID_SALE | Final business configuration invalid or empty PATCH | Fix scope/value/date order; errors[] can be empty. |
| 503 NOT_READY | Catalog guard absent | Operator/setup issue. |
| 503 TRANSACTIONS_REQUIRED | Database lacks transaction support | Operator must configure the replica set. |

Shared CORS/JSON/body/encoding/500 errors also apply. Public/B2B Sales paths return 404 NOT_FOUND. Products deletion can fail PRODUCT_REFERENCED and category deletion CATEGORY_HAS_SALES because of saved campaign definitions; these failures belong to those modules.

## Verification and boundaries

Focused service and mounted HTTP tests cover validation, exact schedule boundaries, partial edits, role/store isolation, audit rollback, descendants, replacement pricing and restoration, rounding/clamping, all variants, empty-category overlap, adjacent windows, disabled drafts, failed enable, catalog moves, target deletion guards, competing campaigns, public Products and guest Cart. The Sales-slice regression suite passed 84 tests with the opt-in database test skipped. The separate authorized real-MongoDB integration test passed, proving competing campaigns serialize with one winner, transactional audit rollback, Product/Cart prices, catalog move rejection and target reference guards. Its disposable collections were cleaned and verified empty. Independent source review found no actionable issues. Live providers and deployed browser behavior are not covered. Coupons has its separate implemented preview contract and Orders integrates these prices. B2B Wholesale is an implemented inquiry flow without displayed prices or checkout; B2C Sales do not add wholesale pricing.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.
