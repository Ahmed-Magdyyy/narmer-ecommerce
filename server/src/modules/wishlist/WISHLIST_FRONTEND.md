# Wishlist frontend contract (B2C)

Source checked: 2026-10-13. This is the implemented account-only, product-level Wishlist contract. Read [API conventions](../../../../docs/frontend/api-conventions.md), [Auth](../auth/AUTH_FRONTEND.md), [Products](../products/PRODUCTS_FRONTEND.md), [Cart](../cart/CART_FRONTEND.md), and the [B2C flow](../../../../docs/frontend/b2c-flow.md) alongside it.

## Scope and ownership

Only an active, email-confirmed, signed-in B2C account with role `user` can use these endpoints. Guests receive `401`; B2C superAdmin/admin/moderator accounts receive `403`. B2B tokens cannot authorize a B2C request. There are no B2B or dashboard Wishlist routes. A guest wishlist, guest-to-account merge, public sharing, staff wishlist management, and variant-specific saved entries are not implemented.

The owner comes exclusively from the authenticated access token and current server-side account/session. Never send an owner ID, role, store, email, or phone to choose whose list to change. Account/session status is checked on every request and again inside a write transaction. Logout, blocking, deletion, or session invalidation makes the relevant credentials unusable; do not retain another account's list in the frontend cache.

Each account can save up to 100 distinct products. This is a technical request/storage bound, not a quantity limit for buying those products. A simple product and a product with many variants each count as one entry. Wishlist has no quantities, selected variants, shipping, tax, coupon, checkout, payment, stock reservation, or price snapshot. It does not change the Cart automatically.

## All endpoints and inputs

Every successful operation below returns HTTP `200`, code `OK`, and the complete Wishlist DTO described below, including repeated adds/removes/clears. There is no `201` response, resource ID for the list, `Location` header, or `204` empty response.

| Method and exact path | Input | Behavior |
| --- | --- | --- |
| `GET /api/v1/b2c/wishlist` | No path parameters, query fields, or body | Reads the current account's list with current localized public product data. An account with no saved list gets `items: []` and `itemCount: 0`; GET does not create a database Wishlist record. |
| `PUT /api/v1/b2c/wishlist/items/:productId` | Required path `productId` only | Adds that visible B2C product once. Repeating an add preserves one entry. An out-of-stock but visible product may be saved. Returns the entire list. |
| `DELETE /api/v1/b2c/wishlist/items/:productId` | Required path `productId` only | Removes the ID from this account's list. Works even if the product is hidden or missing. A product not already saved is a successful no-op. Returns the remaining list. |
| `DELETE /api/v1/b2c/wishlist` | No path parameters, query fields, or body | Clears this account's list by removing its database record. A missing list is a successful no-op. Returns `items: []` and `itemCount: 0`. |

`productId` must be exactly 24 hexadecimal characters, sourced from a public Products response `id` or an existing Wishlist entry `productId`. Uppercase hexadecimal is accepted and normalized to lowercase. It identifies a product, not a variant, category, media object, SKU, or slug. An invalid ID produces a field validation error. A valid but absent/hidden product produces `404 PRODUCT_NOT_FOUND` on PUT; DELETE does not require catalog existence. Route/body/query fields cannot select another account. No body or query field is consumed by these endpoints, and extra supplied fields are ignored rather than saved. General JSON parsing and body-size rules still apply if a client sends a body.

### Headers, cookies and transport

| Field | Requirement and meaning | Source and retention |
| --- | --- | --- |
| `Authorization` | Required `Bearer <accessToken>` on all four endpoints. A refresh cookie alone is insufficient. | B2C Auth login/refresh `data.accessToken`. Replace after refresh; never use a B2B or staff token. |
| `X-Language` | Optional `en` or `ar`, case-insensitive. Selects localized product/option/choice/campaign names and response messages. | Frontend language setting; keep the Wishlist cache separate by account and locale. |
| `Accept-Language` | Optional fallback when X-Language is absent or unsupported. Negotiates en/ar; otherwise server default, initially en. | Browser or frontend transport setting. |
| `Origin` | Browser-managed. General CORS permits only configured origins; these bearer-only operations do not add the Cart cookie-write Origin requirement. Requests without Origin are permitted by general CORS. | Deployment/frontend origin. Do not manually set it in browser JavaScript. |
| `Content-Type` | No body is required, so no Content-Type is necessary. If sending JSON, use application/json; malformed JSON is rejected before the controller. | HTTP client. Prefer no body for all Wishlist operations. |
| Cookies | No Wishlist cookie is issued or consumed. No guest Cart cookie is needed. | Auth refresh remains a separate credentials-enabled request. |

The response includes X-Request-Id and Content-Language, and varies by X-Language/Accept-Language. Read shared conventions for CORS, Helmet, body limits, errors and Auth recovery. Wishlist has both an IP allowance and a store/account allowance of 150 requests per 15 minutes, in addition to API IP 240/minute and verified-account 120/minute. Account limits span tokens/sessions/IPs; IP identity depends on verified proxy trust. Draft-8 RateLimit/RateLimit-Policy and Retry-After are exposed to allowed origins. Counters are process-local, with shared storage required before scaling out.

## Exact success envelope

| Field | Type, presence and source | Frontend handling |
| --- | --- | --- |
| `success` | Always boolean true | Distinguish success from the error envelope. |
| `code` | Always string `OK` | Stable operation result, not a product status. |
| `message` | Localized shared success string | Optional human-readable feedback; do not parse it as a machine code. |
| `data` | Always Wishlist object, never null | Replace the account/locale's previous list with this complete result. |
| `requestId` | Server-generated UUID string, also sent in X-Request-Id | Keep for support/debugging a particular request; never use for authentication, retry identity or writes. |

### Wishlist data and entry fields

| Field | Exact shape and source | Meaning and retention |
| --- | --- | --- |
| `data.items` | Always array of 0–100 entry objects from saved product IDs | Full list; no pagination, total pages, search or sorting API. Stored entry order is preserved; simultaneous adds follow committed storage order. No order-editing contract exists. |
| `data.itemCount` | Integer 0–100, length of saved IDs | Counts all entries, including unavailable ones. It is not total units or the number in stock. |
| `data.items[].productId` | Always lowercase 24-hex string, from the saved reference | Retain for remove, product detail navigation, and a later Cart request. Present even when product is null. |
| `data.items[].product` | Current complete localized public Product DTO, or null | Use the fields below. Never submit this object back to Wishlist. No hidden names, descriptions, images, prices, category, variant choices or stock are returned when null. |
| `data.items[].status` | Exactly `available` or `unavailable`, derived from public catalog visibility | Available means the product exists, is active and has visible category ancestors. It does not mean it has stock. Unavailable means product is null. |

There are no additional list fields such as owner/user ID, database list ID, version, createdAt, updatedAt, expiresAt, currency, subtotal or canCheckout. There is no TTL. GET does not remove hidden/missing entries; they still count toward the 100-entry bound and remain individually removable. Wishlist retention follows account ownership; deleting an account does not expose its list to another account using the same email.

### Common fields of a non-null product

All these fields are present for both simple and variant products. They are the same public DTO used by Products and the shared batch catalog operation; prices and visibility are re-evaluated on every Wishlist response.

| Field under `items[].product` | Type and source | Meaning and later use |
| --- | --- | --- |
| `id` | Lowercase 24-hex string, stored Product ID | Equals entry productId. Send as Cart productId or use Products detail path. |
| `type` | Literal `simple` or `variant`, stored immutable product type | Determines which fields below exist and whether Cart needs variantId. |
| `categoryId` | Lowercase 24-hex string, stored category assignment | Category reference; category labels/tree come from Categories. |
| `name` | Localized nonempty string, stored ar/en name, up to 200 characters | Display returned text; not a bilingual object. |
| `description` | Localized string, up to 10,000 characters; may be empty | Stored description in requested language, falling back to the other language when empty. |
| `slug` | Stored unique lowercase hyphen-separated ASCII slug, up to 150 characters | Frontend product URL hint; API detail/removal use IDs. |
| `isActive` | Always true for a returned public product | Hidden products instead have product:null. Not editable through Wishlist. |
| `images` | Ordered array of 0–10 server-created image objects | First image is the main image. Empty array requires a frontend placeholder. |
| `currency` | Literal `EGP` | Every money field is an integer number of piastres; divide by 100 for EGP display. Zero is valid. No tax is calculated. |

Each image object has exactly `id` (lowercase 24-hex Media ID), `url` (server-owned public Bunny CDN URL), `width` and `height` (positive integer pixel dimensions, each 1–1600). Wishlist cannot upload, attach, reorder, or delete images. Display URLs as returned; no storage keys or credentials are exposed.

### Simple product fields

These fields are present only on a simple product; `options`, `variants` and `priceFrom` are absent.

| Field | Type, source and meaning |
| --- | --- |
| `sku` | Normalized uppercase stored SKU, up to 100 characters, or null when not supplied. Not a Wishlist identifier. |
| `price` | Stored base price, integer 0–1,000,000,000 piastres. |
| `discountedPrice` | Current saved discount or active timed campaign result, integer piastres or null. Null means no discount; zero means free. |
| `effectivePrice` | Current payable unit price, computed as discountedPrice ?? price. Display this price, not a stale saved frontend price. |
| `activeSale` | Null or complete active campaign metadata below. Determines campaign display; coupons are handled only by Cart/Orders. |
| `stock` | Current stored integer quantity, 0–1,000,000,000. Zero does not prevent saving a visible product. |

### Variant product fields and every nested field

A variant product has `options`, `variants`, and `priceFrom`; product-level `sku`, `price`, `discountedPrice`, `effectivePrice`, `activeSale` and `stock` are absent. Do not interpret an absent top-level price as zero.

| Field | Type, bounds and source | Meaning and later use |
| --- | --- | --- |
| `options` | Ordered array of 1–5 stored option definitions | Render selection controls before adding to Cart. |
| `options[].key` | Stable machine string matching `[a-z][a-z0-9_-]{0,39}` | Identifies an option, such as size or color. Server rejects prototype-related unsafe keys. |
| `options[].name` | Localized string up to 200 characters | Display option label; do not use the label as a machine key. |
| `options[].values` | Ordered array of 1–50 choices | Supported values for that option. |
| `options[].values[].key` | Stable machine string matching `[a-z0-9][a-z0-9_-]{0,39}` | Match against variant values. Keys are unique per option; unsafe prototype keys are rejected. |
| `options[].values[].name` | Localized string up to 200 characters | Display choice label. |
| `variants` | Ordered array of 1–100 current sellable variants | Wishlist saves this product once, regardless of variant count. Removed variants disappear on next read. |
| `variants[].id` | Stable lowercase 24-hex variant ID | Retain the selected ID and send it as Cart variantId. Never use it as the Wishlist path productId. |
| `variants[].values` | Object mapping each option key to one configured value key | Match user selections to this exact variant combination. There are no extra option keys. |
| `variants[].sku` | Uppercase SKU up to 100 characters or null | Optional identifier; not used in Wishlist or Cart requests. |
| `variants[].price` | Base price, integer piastres 0–1,000,000,000 | Base price for this variant. |
| `variants[].discountedPrice` | Current saved discount/campaign result, integer piastres or null | Preserve null versus zero. |
| `variants[].effectivePrice` | Derived discountedPrice ?? price | Price of this selected variant; never submit it to Cart. |
| `variants[].activeSale` | Null or metadata object below | Current campaign for this variant. |
| `variants[].stock` | Current integer quantity 0–1,000,000,000 | Stock check is repeated by Cart and Orders; cached stock is not reserved. |
| `variants[].images` | Ordered 0–10 image objects with the exact id/url/width/height fields above | Own variant gallery when configured, otherwise product images as fallback. First is main image. |
| `priceFrom` | Minimum effectivePrice across all current variants, integer piastres | Display “from” price. Includes zero-stock variants; use selected variant's price and stock when adding to Cart. |

No dashboard `version`, bilingual objects, internal SKU keys, database timestamps or product store are exposed in these public product objects.

### Active Sale metadata

For a simple product use product.activeSale; for a variant use product.variants[].activeSale. When non-null the object has exactly these fields:

| Field | Type and source | Meaning |
| --- | --- | --- |
| `id` | Lowercase 24-hex campaign ID | Read-only applied sale identity. |
| `name` | Current localized stored campaign name string | Display campaign label in the same locale as the product. |
| `discountType` | `percentage` or `fixed` | Selects discountValue units. |
| `discountValue` | Positive integer: 1–100 percentage points or 1–1,000,000,000 piastres | Campaign rule, not the calculated product price. |
| `startsAt` | ISO UTC datetime string with milliseconds | Inclusive start of the active campaign. |
| `endsAt` | ISO UTC datetime string with milliseconds | Exclusive end; refetch to refresh pricing at/after this instant. |

Campaign pricing replaces the product's saved discount without modifying saved values. Percentage price is price - floor(price * discountValue / 100); fixed price is max(0, price - discountValue). No campaign stacking is allowed. After expiry/disable the next read returns current saved prices. No coupon discount is applied by Wishlist. All prices in a single catalog batch use one server time; a later response may differ.

## Complete request/response examples

Read an account's list:

```http
GET /api/v1/b2c/wishlist
Authorization: Bearer <b2c-customer-access-token>
X-Language: en
```

The same complete empty response is returned after clearing or reading a never-used list:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": { "items": [], "itemCount": 0 },
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

Add a product, with no request body:

```http
PUT /api/v1/b2c/wishlist/items/111111111111111111111111
Authorization: Bearer <b2c-customer-access-token>
X-Language: en
```

Example successful simple-product response; identifiers and catalog content are synthetic:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "items": [{
      "productId": "111111111111111111111111",
      "status": "available",
      "product": {
        "id": "111111111111111111111111",
        "type": "simple",
        "categoryId": "222222222222222222222222",
        "name": "Shirt",
        "description": "",
        "slug": "shirt",
        "isActive": true,
        "images": [],
        "currency": "EGP",
        "sku": null,
        "price": 25000,
        "discountedPrice": 20000,
        "effectivePrice": 20000,
        "stock": 10,
        "activeSale": null
      }
    }],
    "itemCount": 1
  },
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

A complete variant Product object at items[].product could instead be:

```json
{
  "id": "333333333333333333333333",
  "type": "variant",
  "categoryId": "222222222222222222222222",
  "name": "Shirt",
  "description": "",
  "slug": "shirt-sizes",
  "isActive": true,
  "images": [{ "id": "444444444444444444444444", "url": "https://catalog.example/shirt.webp", "width": 800, "height": 800 }],
  "currency": "EGP",
  "options": [{ "key": "size", "name": "Size", "values": [{ "key": "small", "name": "Small" }] }],
  "variants": [{
    "id": "555555555555555555555555",
    "sku": null,
    "price": 25000,
    "discountedPrice": 20000,
    "effectivePrice": 20000,
    "stock": 5,
    "values": { "size": "small" },
    "images": [{ "id": "444444444444444444444444", "url": "https://catalog.example/shirt.webp", "width": 800, "height": 800 }],
    "activeSale": {
      "id": "666666666666666666666666",
      "name": "Autumn sale",
      "discountType": "percentage",
      "discountValue": 20,
      "startsAt": "2026-10-01T00:00:00.000Z",
      "endsAt": "2026-11-01T00:00:00.000Z"
    }
  }],
  "priceFrom": 20000
}
```

A hidden/missing saved product is represented exactly as this entry inside items; no catalog data accompanies it:

```json
{ "productId": "111111111111111111111111", "product": null, "status": "unavailable" }
```

Remove the entry with DELETE /api/v1/b2c/wishlist/items/111111111111111111111111 and the same Authorization header. Clear all entries with DELETE /api/v1/b2c/wishlist. Neither request needs a body. Both return the complete success envelope, with the current remaining list or the empty DTO.

## Customer frontend flow and retained state

1. Browse public Products as a guest or customer. Saving a product requires sign-in with a confirmed B2C customer account. Keep the desired product ID in local UI intent while authenticating if useful; no server guest Wishlist is created or merged.
2. After login, GET Wishlist to initialize saved-product hearts and the list count. Keep entry productIds to determine whether a product is saved. Cache only within this account and locale; clear on logout/account switching. An empty success is different from loading or a failed request.
3. Use PUT to save and DELETE on the item path to remove. Replace the list/count from the successful full response. Serialize this account's Wishlist changes in the frontend, or refetch after parallel mutations, so a slower earlier response does not overwrite a newer list. On a network timeout, repeat the same PUT/DELETE and reconcile its response.
4. Show current product information for available entries. For unavailable entries show a neutral unavailable placeholder with a remove action, using productId. Do not use earlier cached hidden catalog data as the latest server result. Stock-zero entries remain visible but need an out-of-stock state. Refetch on revisiting the screen, after language changes, and after an active sale ends.
5. To buy a simple product, choose a quantity and PUT the Cart item body `{productId, quantity}`. For a variant product, choose option values, find the matching variants[].values combination, retain its variants[].id, then PUT `{productId, variantId, quantity}`. Read the [Cart contract](../cart/CART_FRONTEND.md) for exact quantity bounds, response fields and stock errors. Wishlist does not provide quantity or automatically select a variant.
6. Adding a Wishlist product to Cart leaves it saved. If the UI wants removal too, issue the separate Wishlist DELETE only after Cart succeeds and reconcile both responses. No atomic move-to-cart endpoint is implemented. If Cart rejects changed availability/stock, refetch Wishlist/Products and preserve the customer's intent for correction.
7. Orders, coupon eligibility, shipping and payment follow Cart/Checkout. A Wishlist price is current display information; it is never a locked checkout price. Never send product prices, names, images, status or stock as purchase authority.

## Catalog references, concurrency and failure behavior

The first successful add creates one `(store,userId)` list record; a unique index prevents duplicate lists. `$addToSet` prevents duplicate product IDs. Mutations use the existing MongoDB transaction and shared catalog guard, also used by Products mutations. Simultaneous adds cannot exceed the 100-entry bound or lose another selection. An add racing product deletion either commits a saved reference and blocks deletion, or encounters a missing product after deletion; it cannot leave a new dangling reference. Transaction/presentation failure rolls back the write. Replica-set transaction support is required for writes; GET is a normal read and does not require a write transaction.

Any saved product reference blocks permanent product deletion, even if hidden or saved by an account that is later blocked/soft-deleted. No staff endpoint edits another person's list. Deactivation remains the staff option for hiding referenced products. Clearing/removing the customer's last reference permits deletion only when all other Cart/Order/Sale/Coupon references also allow it. Saving a variant product references the product, so Wishlist alone does not block removing individual variants. Actual Cart/Order variant references still apply. No automatic deletion or cleanup of customer selections is performed.

GET and mutation responses compute current public data; they are not long-term price or stock guarantees. With parallel changes, response arrival order does not promise newest state. There is no client version/ETag/If-Match or separate idempotency key. PUT and DELETE are safe to repeat for the same intended selection; a later hidden product can cause a repeated PUT to return 404 while its already-saved reference remains unchanged.

## Every error and frontend recovery

An error has `success:false`, stable `code`, localized `message`, `errors:[]`, and server requestId. It has no data field. A validation error's errors[] entries contain `field`, `location`, `code`, and localized `message`; all are strings here. Wishlist's path-ID error uses field productId, location params and code INVALID_FIELD. Non-field errors normally have an empty errors array. Keep machine codes separate from localized text.

| HTTP | Code | Trigger and action |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | Missing/malformed/wrong-store/expired token, inactive/unconfirmed account, or invalidated session. Use the Auth refresh flow once when appropriate; otherwise sign in. Do not treat it as an empty list. |
| 403 | `FORBIDDEN` | A signed-in B2C role is not user. Staff cannot use this customer API. Refresh cannot change permissions. |
| 404 | `NOT_FOUND` | Wrong method/path or non-existent B2B/dashboard route. Correct the route; do not invent a staff or guest fallback. |
| 404 | `PRODUCT_NOT_FOUND` | PUT targets an absent or publicly hidden product. Refetch; do not retry blindly. Existing entries can still be removed. |
| 409 | `WISHLIST_LIMIT_EXCEEDED` | Saving a new distinct entry would exceed 100. Remove an entry first. Re-adding an existing visible entry at the cap is allowed. |
| 422 | `VALIDATION_ERROR` | productId is not a 24-hex ID. Use errors[] to correct the path identifier. |
| 429 | `TOO_MANY_REQUESTS` | General IP/account or Wishlist IP/account allowance exhausted. Respect exposed Retry-After, pause requests and preserve the current list; do not refresh tokens to evade the limit. |
| 503 | `TRANSACTIONS_REQUIRED` | Database does not support the write transaction. Backend deployment/configuration needs correction. Do not report a successful save. |
| 500 | `INTERNAL_ERROR` | Unexpected database/infrastructure/presentation failure. Preserve the UI, show a retryable error and retain requestId for support. Transaction failures do not partially save the change. |
| 403 | `CORS_DENIED` | Origin is not configured. Fix deployment origin; browser may expose only a fetch/network failure. |
| 400 | `INVALID_JSON` | A supplied JSON body is malformed. These endpoints need no body; omit it. |
| 413 | `BODY_TOO_LARGE` | Body exceeds the shared 100 KB JSON limit. Omit the body. |
| 415 | `UNSUPPORTED_ENCODING` | Shared parser rejects supplied encoding/charset. Use ordinary requests without a body. |

Wrong internal store context produces 400 INVALID_STORE, but no B2B Wishlist URL is mounted. Frontends must use /api/v1/b2c/wishlist, not pass a store selector. Shared request errors are defined in [API conventions](../../../../docs/frontend/api-conventions.md).

Example path validation response:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Please check the submitted fields.",
  "errors": [{ "field": "productId", "location": "params", "code": "INVALID_FIELD", "message": "This field is invalid." }],
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

## Verification boundaries

Focused service/HTTP tests passed for ownership and role/store isolation, path validation and ignored spoofing fields, duplicate/concurrent adds, both product types, current discounts/stock, localization, hidden-data protection, removal/clear replay, the 100-entry bound, reference guards, variant removal, and rollback after storage/presentation failures. The complete local suite passed 112 tests with the opt-in database test skipped. The separately authorized real-MongoDB integration test passed, including concurrent additions, unique ownership, reference contention, hidden data and rollback; disposable test collections were removed and verified absent. Live Bunny delivery and deployed browser/TLS behavior are not established by these tests. No new dependency was added.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.


### Size guide boundary — 2026-10-22

The Wishlist product projection does not add sizeChart or sizeChartId. Load the current B2C Product detail for its optional guide through the [Size Charts integration](../sizecharts/SIZECHARTS_FRONTEND.md). The Wishlist selection/variant/price fields and product-only identity remain unchanged.
