# Coupons frontend integration contract

Source checked: 2026-10-13. Coupons is implemented for B2C only. Read [API conventions](../../../../docs/frontend/api-conventions.md) for every shared envelope/header/error field, [Cart](../cart/CART_FRONTEND.md) for ownership, [Sales](../sales/SALES_FRONTEND.md) for campaign prices, and [B2C flow](../../../../docs/frontend/b2c-flow.md) for request sequencing. B2B forms do not use coupons.

## Responsibility and availability

Staff manages coupon definitions; guests and customers can preview one code against their own current server-side cart. Preview does not save the code to Cart, consume a use, reserve stock, include shipping, or place an order. Normal Cart/Product DTOs are unchanged by preview.

Orders calls internal redemption inside its placement transaction; read [Orders](../orders/ORDERS_FRONTEND.md) for its public payload. There is no public coupon-redemption endpoint. Canceled and returned orders keep their coupon uses counted, following the confirmed policy; no restoration operation is provided.

All six required module layers exist. Controllers handle HTTP; services own business rules. Application composition mounts preview under Cart to reuse its existing ownership cookie, Origin checks, and rate limiter. Every monetary value is an integer number of EGP piastres; 5000 means EGP 50. No tax is calculated.

## Every endpoint and success result

All responses use the shared envelope: success, code, message, data, requestId. Success code is OK; messages are localized. This table describes data.

| Method and full path | Allowed caller | Input | Success |
| --- | --- | --- | --- |
| GET /api/v1/admin/b2c/coupons | B2C superAdmin/admin | List query below; no body | 200, {items,pagination} |
| GET /api/v1/admin/b2c/coupons/:couponId | B2C superAdmin/admin | Path ID; no body | 200, Coupon DTO |
| POST /api/v1/admin/b2c/coupons | B2C superAdmin/admin | Create JSON | 201, Coupon DTO |
| PATCH /api/v1/admin/b2c/coupons/:couponId | B2C superAdmin/admin | Path ID and partial JSON | 200, Coupon DTO |
| DELETE /api/v1/admin/b2c/coupons/:couponId | B2C superAdmin only | Path ID; no body | 200, data null |
| POST /api/v1/b2c/cart/coupon-preview | Guest or authenticated B2C user | JSON code and phone | 200, Preview DTO |

Path couponId is the returned id, a 24-character hexadecimal MongoDB identifier. Keep it for later detail/edit/delete. Invalid syntax is 422 VALIDATION_ERROR; a valid missing ID is 404 COUPON_NOT_FOUND. No code/slug detail route, batch action, search, public coupon list/detail, B2B route, or separate enable/disable route exists. PATCH isEnabled controls the switch. Unexpected queries do not select an owner or add filtering.

Dashboard calls require Authorization: Bearer with B2C login/refresh data.accessToken. B2B tokens, moderators, users, and guests cannot manage definitions. Dashboard names always include both translations. JSON writes require Content-Type: application/json. X-Language: ar or en selects messages and preview name; Accept-Language is the fallback. Use the configured API origin with /api/v1 once. CORS, JSON size, request IDs, envelopes, and common failures follow shared conventions.

For guest preview, omit Authorization, send browser credentials: include, and use an Origin explicitly allowed in backend CORS_ORIGINS. The browser sends/stores HttpOnly narmer_cart_b2c, path /api/v1/b2c/cart, SameSite=Lax, Secure in production, 30-day Max-Age. Browser JavaScript cannot read or assign the cookie. Trusted SSR code must forward the allowed Origin/cookie explicitly. Missing guest POST Origin is 403 FORBIDDEN; a supplied disallowed Origin is 403 CORS_DENIED. Authenticated customer preview uses that customer's B2C bearer identity/account cart. It does not require Origin when absent, but a supplied Origin still passes CORS. Staff preview is forbidden. An invalid/expired bearer never silently becomes guest ownership. Malformed/duplicated guest cookies are rejected as explained in Cart.

Preview shares Cart's 150 requests per IP per 15 minutes across its operations. Use an explicit Apply action or controlled recalculation after relevant changes; avoid requests on every keystroke. Credentials: include does not override browser SameSite restrictions; deployment must use a compatible frontend/API arrangement.

## List query and result

| Query field | Type, bounds, default | Meaning/source |
| --- | --- | --- |
| page | Optional URL integer 1–100000; default 1 | Dashboard page, converted to integer. |
| limit | Optional URL integer 1–100; default 20 | Page size, converted to integer. |
| isEnabled | Optional literal URL true/false; omitted means both | Stored manual flag, converted to boolean. True can include scheduled, expired, or exhausted definitions. |
| targetType | Optional all/products/category; omitted means all | Saved scope type, not current buyer eligibility. |

Results are newest creation first, with descending ID as tie-breaker. There is no name/code search, status/date filter, selectable sorting, or expanded product/category label. Load dashboard catalog APIs for selector labels.

Data has exactly items (array of full Coupon DTOs) and pagination (object). Pagination fields are page (requested/default integer), limit (requested/default integer), total (integer matching count), and pages (ceiling of total/limit). Empty results are items [] and total/pages 0. A page beyond the result set returns empty items with actual totals. Retain UI filters/page; never submit pagination as a mutation field.

## Create and PATCH: every request field

Create requires code, both name translations, targetType, discountType, and discountValue. PATCH needs at least one recognized field. Omitted values preserve saved values except scope switches below. Unknown fields are whitelisted out; never send read-only values. Empty/unknown-only PATCH is 422 INVALID_COUPON.

| Field | Create | PATCH | Validation/default/null behavior | Meaning/source |
| --- | --- | --- | --- | --- |
| code | Required | Optional | String trimmed/uppercased; 3–40 characters; pattern ^[A-Z0-9][A-Z0-9_-]{2,39}$ | Staff-chosen unique B2C buyer code. Editing retains ID and usage history. Null/empty invalid. |
| name | Required bilingual object | Optional partial object | Only ar/en leaves accepted | Staff name, separate from code. PATCH merges supplied leaves. |
| name.ar | Required | Optional | Trimmed string 1–150 characters | Arabic display name. |
| name.en | Required | Optional | Trimmed string 1–150 characters | English display name. |
| targetType | Required | Optional | all/products/category | Scope rule below. |
| productIds | Nonempty for products; otherwise omit/[] | Optional complete replacement | Array max 100 distinct existing B2C product IDs; default [] | Whole-product targets from dashboard Products, including all variants. Entries normalize to lowercase. Variant IDs/SKUs are not product targets. |
| categoryId | Non-null for category; otherwise omit/null | Optional | Existing B2C category ID or null; default null | Dashboard category ID, including all current descendants. |
| discountType | Required | Optional | percentage/fixed | Units selector for discountValue. |
| discountValue | Required | Optional | Actual integer; percentage 1–100; fixed 1–1000000000 | Whole percent points or EGP piastres. 20 means 20% or EGP 0.20 according to type. |
| minimumSpend | Optional | Optional | Actual integer 0–1000000000000000; default 0; null invalid | Required eligible merchandise subtotal BEFORE coupon; excludes sale/out-of-scope lines and shipping. |
| maxUses | Optional | Optional | Null or actual integer 1–1000000000; default null | Global successful order-placement cap; null means unlimited. Preview does not consume it. |
| maxUsesPerPerson | Optional | Optional | Null or actual integer 1–1000000000; default null | Successful placement cap per normalized checkout phone; null means unlimited. |
| startsAt | Optional | Optional | Null or explicit-timezone ISO date/time; default null | Inclusive start; null means no start restriction. |
| endsAt | Optional | Optional | Null or explicit-timezone ISO date/time; default null | Exclusive expiry; null means no expiry restriction. |
| isEnabled | Optional | Optional | Actual boolean; default true; null invalid | Manual switch; false prevents use. |

Quoted numbers/booleans are invalid. minimumSpend may be zero; discountValue and non-null caps must be positive. A fixed amount greater than eligible spend is allowed and capped when calculating. There is no currency/tax/image/free-shipping/max-percentage-amount/per-variant-target field.

Final scope constraints: all requires productIds [] and categoryId null; products requires 1–100 distinct productIds and categoryId null; category requires categoryId non-null and productIds []. On a targetType change, omitted old scope fields clear automatically; supply the new required scope. Without a type change, omission preserves scope. Explicit incompatible fields fail. Inactive records may be saved targets, while cart visibility still controls actual eligibility. New products/descendants and catalog moves change category eligibility dynamically. Coupons do not themselves block moves. Overlapping coupon scopes/schedules are allowed: one code is calculated at a time, with no coupon stacking.

Dates require YYYY-MM-DDTHH:mm:ss, optional 1–3 fractional digits, and Z or ±HH:mm. Examples: 2026-11-01T00:00:00Z and 2026-11-01T02:00:00+02:00. Date-only, timezone-free, and invalid calendar dates fail. Boundaries are optional independently; when both final values exist, endsAt must be strictly later. PATCH null clears a boundary; omission preserves it. Responses use ISO UTC milliseconds and Z. Convert scheduling UI values explicitly; do not submit ambiguous local text.

Lowering a cap below recorded use blocks further uses rather than erasing history. Raising/removing a cap can allow new uses if schedule/manual state permit. Editing the code, disabling, or re-enabling never resets counters/per-phone history. There is no reset endpoint.

Create example (synthetic):

```json
{
  "code": " welcome20 ",
  "name": { "ar": "خصم ترحيبي", "en": "Welcome discount" },
  "targetType": "all",
  "productIds": [],
  "categoryId": null,
  "discountType": "percentage",
  "discountValue": 20,
  "minimumSpend": 20000,
  "maxUses": 100,
  "maxUsesPerPerson": 1,
  "startsAt": null,
  "endsAt": null,
  "isEnabled": true
}
```

PATCH example switching to a category, editing one translation, setting expiry; omitted productIds clears, other omitted fields preserve:

```json
{
  "targetType": "category",
  "categoryId": "66f000000000000000000010",
  "name": { "en": "Clothing discount" },
  "endsAt": "2026-12-01T00:00:00Z"
}
```

PATCH example switching to selected products, fixed EGP 50, and clearing caps/dates:

```json
{
  "targetType": "products",
  "productIds": ["66f000000000000000000001"],
  "discountType": "fixed",
  "discountValue": 5000,
  "maxUses": null,
  "maxUsesPerPerson": null,
  "startsAt": null,
  "endsAt": null
}
```

## Dashboard Coupon DTO: every response field

The same DTO appears in create/detail/PATCH data and each list item. Every listed field is always present, including nulls/empty arrays.

| Field | Type | Meaning/source and frontend use |
| --- | --- | --- |
| id | 24-hex string | Server record ID; retain for detail/edit/delete. |
| code | String | Normalized saved buyer code; display/share/edit. |
| name | Object | Saved bilingual names; retain both in editor. |
| name.ar, name.en | Strings | Arabic/English saved name leaves; editable individually. |
| targetType | all/products/category | Saved scope selector. |
| productIds | Array of ID strings | Direct product targets; empty otherwise. Load dashboard Products for labels and preserve complete selection when replacing. |
| categoryId | ID string or null | Direct category target; load dashboard tree for label. |
| discountType | percentage/fixed | Saved units selector. |
| discountValue | Positive integer | Saved percentage points/piastres; display fixed value divided by 100. |
| minimumSpend | Nonnegative integer piastres | Saved eligible threshold, not current buyer spend. |
| maxUses | Positive integer or null | Global cap; null means unlimited. |
| maxUsesPerPerson | Positive integer or null | Per-checkout-phone cap; null means unlimited. |
| usedCount | Nonnegative integer | Read-only recorded global redemption count. |
| startsAt | UTC ISO string or null | Inclusive boundary; null means unbounded start. |
| endsAt | UTC ISO string or null | Exclusive boundary; null means unbounded end. |
| isEnabled | Boolean | Saved manual switch; editable. |
| status | disabled/scheduled/expired/exhausted/active | Computed global state, not a per-phone eligibility guarantee. |
| currency | EGP | Server constant; not editable. |

Status precedence: disabled if manually off; otherwise scheduled before a non-null start; otherwise expired at/after a non-null end; otherwise exhausted if usedCount reaches non-null maxUses; otherwise active. Exact start is eligible, exact end is not. Per-phone exhaustion does not change global status. Status is recalculated on response; cached data does not update itself as time passes.

No store, timestamps, edit version, actor/audit fields, raw phones/hashes, per-phone counts, order IDs, catalog labels, or calculated customer totals are returned. Coupon PATCH has no optimistic edit version. Serialize editor updates, refetch after changes, and do not assume stale staff forms cannot overwrite other edits.

Complete create/detail response for the all-scope example before redemption:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "id": "66f000000000000000000030",
    "code": "WELCOME20",
    "name": { "ar": "خصم ترحيبي", "en": "Welcome discount" },
    "targetType": "all",
    "productIds": [],
    "categoryId": null,
    "discountType": "percentage",
    "discountValue": 20,
    "minimumSpend": 20000,
    "maxUses": 100,
    "maxUsesPerPerson": 1,
    "usedCount": 0,
    "startsAt": null,
    "endsAt": null,
    "isEnabled": true,
    "status": "active",
    "currency": "EGP"
  },
  "requestId": "f138736c-2bce-4b41-b229-7b044998ceef"
}
```

Empty list data (outer envelope still applies):

```json
{
  "items": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "pages": 0 }
}
```

DELETE full response:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": null,
  "requestId": "f138736c-2bce-4b41-b229-7b044998ceef"
}
```

## Preview input, phone identity, and ownership

| Body field | Type/validation | Meaning/source and retention |
| --- | --- | --- |
| code | Required string; staff code normalization/pattern | Buyer-entered code. Retain normalized response code on success; preserve entered value on failure. |
| phone | Required string, trimmed; spaces/parentheses/hyphens removed; 6–15 digits with optional leading + | Intended checkout contact phone for guest or customer. No automatic fallback to account/profile/address phone. Keep the checkout input; recalculate when it changes. |

No customerId, cartId, ownerId, items, quantities, totals, shipping, address, eligibility, or discount input exists. Cookie/customer JWT selects the owner; saved cart selections and current server prices decide calculation. Forged prices are ignored.

Per-person identity uses checkout phone for everyone, independently of account/email. Egyptian 01001234567, +201001234567, 00201001234567, and 201001234567 share a key. A leading + or international 00 is normalized; Egyptian local 01 followed by nine digits gets country code 20. Other countries should use country code consistently; no global local-number inference exists. New redemptions record a keyed HMAC-SHA-256 fingerprint using the separate COUPON_IDENTITY_SECRET, not the original number. Limit checks also count older SHA-256 fingerprints; existing history is preserved. Neither phone/key nor individual usage history is returned. The secret must stay stable: changing it needs an explicit migration to retain previous HMAC usage. Legacy hashes remain enumerable to a reader of those records; declared phone ownership remains unverified. See the security report for the precise privacy limit.

Phone ownership is unverified: another declared phone can bypass a per-number cap. This is the agreed policy. Changing a profile phone does not alter usage for an unchanged checkout phone. Preview requires phone even when the chosen coupon has no person cap so later placement can use the same contact input.

```json
{ "code": "welcome20", "phone": "+201001234567" }
```

## Eligibility and exact calculations

Cart must be nonempty and canCheckout true. Any missing/hidden/unpriceable/insufficient-stock line blocks the complete preview; adjust/remove it through Cart first. Failure does not change Cart. Coupon must exist, be enabled, be within its optional schedule, and have global/per-phone capacity when configured.

Eligible lines match scope AND have activeSale null. Selected products cover every current variant. Category scope follows current category/descendant assignment. Active-sale lines remain excluded even at zero price or when campaign rounding gives no reduction. A saved discountedPrice with no active Sale remains eligible: coupon discounts that current effective price.

No eligible lines means 409 COUPON_NO_ELIGIBLE_ITEMS, including all-sale carts or scopes with no matching non-sale lines. In a mixed cart, discount only eligible lines. Compare minimumSpend to their current line totals BEFORE coupon. Sale/out-of-scope lines and shipping do not count. Quantity is already included in lineTotal.

Percentage discountAmount is floor(eligibleSubtotal × discountValue / 100); fixed is min(discountValue, eligibleSubtotal). Exact integer intermediate arithmetic prevents lost piastres at large cart totals. Allocation is proportional to eligible line value: floor each share, then distribute leftover piastres to largest fractional remainders, ties by Cart order. Shares sum exactly to discountAmount and no line is negative. Eligible zero-price lines can succeed with zero discount; a later successful redemption still counts as a use.

Preview reads current Cart, Product/Sale prices, definition, category scope, and usage in a database transaction. One captured server time governs Cart expiry, Sales activation, and coupon dates. This is a consistent read, not a reservation: another use, time boundary, stock/price change, or staff edit can invalidate the next calculation.

## Preview DTO: every response field

| Field | Type/presence | Meaning/source and frontend action |
| --- | --- | --- |
| coupon | Always object | Metadata for applied code, not staff DTO. |
| coupon.id | ID string | Coupon identity; preview request uses code, not this ID. |
| coupon.code | String | Normalized saved code; retain selected code. |
| coupon.name | Localized string | Request-selected translation; refetch on language change. |
| coupon.discountType | percentage/fixed | Saved units selector. |
| coupon.discountValue | Positive integer | Saved percentage points/piastres. |
| currency | EGP | Server constant; divide monetary integers by 100 for display. |
| subtotal | Nonnegative integer piastres | Entire current Cart merchandise before coupon, including Sale/out-of-scope lines; no shipping. |
| eligibleSubtotal | Nonnegative integer piastres | Matching non-sale line totals; eligible spend before coupon. |
| discountAmount | Nonnegative integer piastres | Actual coupon reduction, possibly zero. |
| subtotalAfterDiscount | Nonnegative integer piastres | subtotal minus discountAmount; net merchandise, not checkout grand total. |
| allocations | Array in current Cart order | One entry per Cart line; match by productId AND variantId. |
| allocations[].productId | ID string | Source line product identity. |
| allocations[].variantId | ID string or null | Source selected variant, null for simple product. |
| allocations[].eligible | Boolean | Matches scope with no active Sale; false has no separate reason enum. |
| allocations[].discountAmount | Nonnegative integer piastres | Whole line's proportional share; zero for excluded lines. Do not multiply by quantity again. |
| allocations[].lineTotalAfterDiscount | Nonnegative integer piastres | Whole current line total minus its share, not a unit price. |

No updated Cart, quantity, expiry, phone, address, shipping fee, tax, grand total, order, proof, remaining capacity, saved-code field, or token appears. Fetch Cart for its own fields. Do not write allocations into Product prices or assume line discounts divide evenly into per-unit amounts.

Full mixed-cart response: two sale pieces at EGP 200 give EGP 400; one non-sale variant at EGP 250 gets 20% (EGP 50) off. The coupon's EGP 200 minimum eligible spend is met by EGP 250 alone:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "coupon": {
      "id": "66f000000000000000000030",
      "code": "WELCOME20",
      "name": "Welcome discount",
      "discountType": "percentage",
      "discountValue": 20
    },
    "currency": "EGP",
    "subtotal": 65000,
    "eligibleSubtotal": 25000,
    "discountAmount": 5000,
    "subtotalAfterDiscount": 60000,
    "allocations": [
      {
        "productId": "66f000000000000000000001",
        "variantId": null,
        "eligible": false,
        "discountAmount": 0,
        "lineTotalAfterDiscount": 40000
      },
      {
        "productId": "66f000000000000000000002",
        "variantId": "66f000000000000000000003",
        "eligible": true,
        "discountAmount": 5000,
        "lineTotalAfterDiscount": 20000
      }
    ]
  },
  "requestId": "f138736c-2bce-4b41-b229-7b044998ceef"
}
```

## Customer and staff request sequences

### Field sources and exact next-call mappings

| Input/output | Where it comes from | Later request or use |
| --- | --- | --- |
| Dashboard definition editable fields | Staff editor input, initialized from an existing dashboard Coupon DTO when editing. Required/default/null rules are in the create/PATCH field table. | POST /api/v1/admin/b2c/coupons or PATCH /:couponId with only supported fields. Saved name stays bilingual; a public preview's localized coupon.name is not a complete dashboard name object. |
| couponId | Dashboard create/detail data.id or list data.items[].id. | Detail/PATCH/DELETE /api/v1/admin/b2c/coupons/:couponId. A shopper cannot apply a coupon by passing this ID. |
| productIds[] | Selected dashboard Product data.id or list data.items[].id. | Definition body productIds for targetType=products; each ID is a whole product, including all its current variants, not a variant ID or SKU. |
| categoryId | Selected dashboard Category data.id or list data.items[].id. | Definition body categoryId for targetType=category; eligibility includes current descendants. A category slug is not accepted in this field. |
| code | Shopper's entered code, or the saved normalized dashboard/preview code. | Preview body code, followed by Checkout body couponCode. Normalize with the response on success. A Coupon definition id/name cannot substitute for code. |
| phone | Current confirmed Checkout customer.phone, optionally prefilling editable profile/address contact. | Preview body phone and Checkout body customer.phone must represent the same intended buyer number for consistent per-person checks. Neither API silently falls back to the account's main phone. |
| startsAt / endsAt | Staff schedule UI converted to explicit timezone ISO strings; returned timestamps are normalized UTC. | Definition create/PATCH fields with inclusive/exclusive semantics. Preserve omitted boundaries on PATCH; send null to clear. No scheduled activation request is needed. |
| maxUses / maxUsesPerPerson | Staff cap choices; null means unlimited. | Definition create/PATCH fields, not preview inputs. The server enforces placement counts; frontend calculations cannot reserve remaining capacity. |
| Preview coupon and monetary totals | Preview envelope data, calculated from the current owned Cart and definition/usage. | Render merchandise discount only. Retain code and checkout input, not a trusted discountAmount to submit to Orders. Checkout calculates shipping/grand total and rechecks eligibility; current Cart data itself remains unchanged. |
| allocations[].productId / variantId | Preview rows referencing the current Cart selections. | Match discount display by the exact product/variant pair, not array index alone. Every Cart line is represented, including ineligible lines with zero discount. These allocation objects are never editable request bodies. |
| usedCount / status | Dashboard response counter and computed state at response time. | Display/refetch; neither belongs in a mutation request. Disabling/editing does not reset uses, and canceled/returned orders keep them counted. |

Coupon preview has no expiry field or identifier for a reserved quotation. Recalculate after Cart/phone changes and before checkout. A successful preview can later fail because another buyer used the remaining capacity or a schedule/price/scope changed. Zero discountAmount is a valid calculation for eligible zero-priced merchandise; test for missing data/errors rather than truthiness.

Create is not generally idempotent; its unique normalized code prevents duplicate definitions, so after an uncertain POST inspect the staff list for that code. Definition PATCH has no caller-supplied version: reread/reconcile concurrent staff edits rather than inventing an expectedVersion field. Repeating DELETE after successful deletion returns COUPON_NOT_FOUND. Preview is a read calculation and consumes no usage. Removing an applied code is frontend state: there is no remove-coupon endpoint on Cart.

1. Browse/select through Products, write selections through Cart, and retain canonical Cart data.
2. Collect checkout phone and code; signup is optional. Preview with the same ownership context as Cart.
3. Keep entered phone, normalized code, returned metadata/totals/allocations for display only. Clear stale discount after a failed recalculation.
4. Recalculate after quantity/variant/cart/phone changes, successful merge, language change, and relevant catalog/Sale/coupon changes. Normal Cart subtotal remains before coupon and never confirms the code is saved.
5. Removing a code is frontend state only: no remove-coupon API is needed. Return to current Cart totals. Repeated preview consumes nothing.
6. Shipping stays a separate quote. Adding that current fee to subtotalAfterDiscount is only a display estimate; Orders revalidates it at placement.

Guest preview renews the browser cookie after ownership middleware, including when later validation/business checks fail. It does not renew saved guest-cart expiry; only successful item writes do. Empty new guest preview creates no stored Cart. Expired guest selections behave as empty; account cart lifecycle is unchanged. No operation here reserves/deducts stock.

Staff loads dashboard catalog selectors, creates definition, retains ID, lists/inspects, PATCHes documented fields, and replaces form state with returned DTO. Disable to stop future use while retaining history. Definition changes and audit records commit together; failed checks/audits preserve old state. Create is not generically idempotent: after timeout, reconcile the code in the paginated list before retry. Duplicate code yields conflict, not a second definition. No endpoint exposes all buyers' redemptions.

## Transactional usage, deletion, and references

Internal redeem requires the Orders transaction session, new orderId, owner, code, phone, and locale. It revalidates current eligibility, increments usedCount, and records one order-linked use with private phone key/discount. Orders must create the order and deduct stock in that same transaction. Any later order failure rolls back coupon use. Global/per-phone races serialize: one remaining use cannot be consumed twice. Orders HTTP/service and isolated MongoDB tests additionally verify this integration with actual order snapshots.

Only one coupon redemption is allowed per order. Repeating a recorded order ID rejects without another increment. Orders resolves an existing checkoutId/proofId replay before calling redemption again. requestId is not an idempotency key. Shopper preview has no orderId and cannot trigger redemption. Entering a code, abandoned carts, and repeated preview do not count. Cancellation/return intentionally do not restore uses; the recorded order-linked use and counter remain unchanged.

Only superAdmin deletes. Any existing redemption blocks deletion with 409 COUPON_REFERENCED; disable instead. Deleting an unused definition frees its code for a separate fresh definition. No deleted-coupon restore exists.

Every saved direct product/category target blocks its permanent deletion, even disabled/expired/exhausted coupons. Products returns PRODUCT_REFERENCED; Categories returns CATEGORY_HAS_COUPONS. Retarget or remove unused definitions first, or deactivate catalog records. Coupons target whole products, so removing an unreferenced variant is allowed; live Cart can still block variant removal. Existing child/product/Sale category guards remain. No cascade or silent coupon deletion occurs.

## Errors and recovery

Shared error envelope is success false, code, message, errors, requestId, with no data. Field validators use 422 VALIDATION_ERROR and paths such as code, phone, name.ar, productIds[0], startsAt, couponId. Final business-shape errors use INVALID_COUPON without per-field detail. Branch on stable codes/status, not translated messages. All messages support ar/en.

| HTTP/code | Meaning | Recovery |
| --- | --- | --- |
| 401 UNAUTHORIZED | Invalid/expired/wrong-store bearer or guest credential | Follow Auth/Cart recovery; do not silently change owner. |
| 403 FORBIDDEN | Role denied or guest trusted Origin missing | Correct role/transport; refresh cannot grant permission. |
| 404 COUPON_NOT_FOUND | Staff ID missing | Reload list; close stale editor. |
| 409 COUPON_CODE_EXISTS | Normalized code already stored | Choose another/open existing; reconcile timeout before replay. |
| 409 COUPON_TARGET_NOT_FOUND | Missing scoped catalog target | Reload selectors and correct IDs. |
| 409 COUPON_CONFLICT | Conditional mutation/redemption conflict | Refetch/recalculate; old preview is not authority. |
| 409 COUPON_REFERENCED | Deletion has recorded uses | Disable rather than delete. |
| 409 COUPON_UNAVAILABLE | Missing/disabled/scheduled/expired/globally exhausted buyer code | Remove stale discount, preserve input, display unavailable. Exact cause is deliberately not returned. |
| 409 COUPON_PERSON_LIMIT_REACHED | Checkout phone reached cap | Explain per-number limit; another account with same number does not reset it. |
| 409 COUPON_NO_ELIGIBLE_ITEMS | No matching non-sale lines | Keep Cart; explain current code has no eligible items. |
| 409 COUPON_MINIMUM_SPEND | Eligible spend below minimum | Exclude sale/out-of-scope items and shipping when explaining spend. Error does not return a staff definition. |
| 409 CART_COUPON_UNAVAILABLE | Empty or currently uncheckoutable Cart | Fetch/adjust Cart, then recalculate. |
| 422 INVALID_COUPON | Invalid final scope/value/dates, duplicate target, or empty recognized PATCH | Correct inputs; unchanged retry will fail. |
| 422 VALIDATION_ERROR | HTTP field type/format/ID/query violation | Map shared field errors to inputs. |
| 429 TOO_MANY_REQUESTS | Shared Cart IP limit | Wait; stop automatic retry/preview loops. |
| 503 TRANSACTIONS_REQUIRED | DB lacks transaction support | Operator configures replica set; preserve input. |

CORS, JSON/body/encoding and INTERNAL_ERROR failures follow shared conventions. NOT_READY belongs to the health readiness endpoint; these Coupon routes do not emit it as a dedicated readiness gate. Catalog deletion failures above belong to their modules. Internal duplicate-order redemption produces 409 COUPON_ALREADY_REDEEMED; no current HTTP route invokes it. Unsupported public/B2B coupon paths return 404 NOT_FOUND. Store is fixed by route/composition, never request body.

## Verification and outstanding boundaries

The complete local suite passed 92 tests with the separate opt-in DB test skipped. Coupon service/HTTP tests cover all routes, roles/store ownership, whitelisting, schedules/caps, scopes/variants/descendants, phone normalization, minimum eligible spend, Sales exclusion, exact maximum-cart arithmetic, same-time price boundaries, variant removal, audits, and transactional usage limits/rollback. The separately authorized real-MongoDB test passed including simultaneous global/per-phone use, duplicate order/code protection, external-order rollback, Sale/Cart calculation, audit rollback, and reference guards. It used a disposable test database and verified cleanup. Independent source review found no actionable issues.

Orders HTTP integration is implemented and canceled/returned uses remain counted. Live providers and deployed browser/TLS/cookie interoperability remain unverified. Sources: six coupons files, app/modules.js, Cart/Sales/Products/Categories services, Cart routes, shared middleware, coupons-service.test.js, coupons-http.test.js, identity-mongo.test.js.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.
