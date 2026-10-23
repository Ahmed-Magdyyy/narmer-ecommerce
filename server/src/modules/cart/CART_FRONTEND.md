# Cart: complete frontend handoff

Source checked: 2026-10-13. Implemented for B2C customers and guests only. Read [shared API conventions](../../../../docs/frontend/api-conventions.md), [B2C flow](../../../../docs/frontend/b2c-flow.md), [Auth](../auth/AUTH_FRONTEND.md), [Products](../products/PRODUCTS_FRONTEND.md), and [Shipping](../shipping/SHIPPING_FRONTEND.md).

## What a cart does

Cart stores product/variant selections and quantities. Every response resolves the current public catalog, prices, images, and stock through Products. It does not store prices or deduct/reserve stock. Stock is deducted by successful [Orders placement](../orders/ORDERS_FRONTEND.md), not by Cart reads/writes or checkout previews. canCheckout reflects current Cart eligibility and does not reserve stock or guarantee a later placement.

Confirmed guest behavior: keep cart items for 30 days and merge into the account cart after sign-in. The frontend explicitly calls the merge endpoint after login; Auth does not automatically merge. Ordinary customer accounts (`role: user`) have an account cart. Staff accounts cannot use Cart, even though they can manage catalog data. There are no B2B/dashboard Cart routes and no guest account is created.

Cart ownership is entirely server-derived. The request cannot select a user/cart ID. Never ask the user to supply the stored owner key or try to infer another cart from a product/user ID.

## Checkout integration

Three Orders-owned POST operations are mounted below /api/v1/b2c/cart/checkout and reuse this router’s customer/guest ownership, cookie path, Origin checks and shared limiter. Their response DTOs differ from Cart; read [Orders](../orders/ORDERS_FRONTEND.md) for all fields. Successful placement removes the Cart database record inside the order transaction. It leaves the guest cookie in place for safe replay and future shopping. The next GET creates a new empty Cart record for the same current owner and returns the complete summary. Placement replay remains tied to the checkout/order and does not repeat stock or coupon effects.

## Find or create on GET

GET always finds or creates the caller’s database Cart record. A newly created cart returns items: [], itemCount: 0, subtotal: 0, currency: EGP and canCheckout: false inside the normal success envelope; data is never null. IDs and internal owner keys are still omitted from the existing response shape. Existing live cart selections remain unchanged, and expired guest selections are cleared rather than revived. Clearing or successful order placement removes the record; the next GET creates another empty one.

GET now uses the existing MongoDB transaction/catalog guard, so simultaneous initial reads cannot create two carts for the same owner, and creation cannot overwrite a competing item write. The unique store/owner index remains enforced. MongoDB transaction support is required for GET too; database/transaction or cart conflict failures use the existing error envelope. Internal getForCoupon remains a read-only lookup and does not create a cart during coupon or checkout validation.

## Every endpoint and request

The four Cart-owned endpoints below return HTTP 200, success code OK, and the same complete Cart `data` DTO described below. Successful DELETE returns an empty Cart DTO, not data:null.

| Method/exact path | Authentication | Body/path/query fields | Effects |
| --- | --- | --- | --- |
| `GET /api/v1/b2c/cart` | Guest cookie or B2C customer Bearer token | No body/path/query fields | Returns the selected cart with live pricing/availability. Creates a Cart record when missing for either a guest or customer, then returns the complete current Cart DTO. A guest also receives an ownership cookie. |
| `PUT /api/v1/b2c/cart/items` | Guest cookie with allowed Origin, or B2C customer Bearer token | Required JSON productId and quantity; optional variantId | Sets one absolute quantity, adds/replaces a selection, or removes it when quantity is zero. |
| `DELETE /api/v1/b2c/cart` | Guest cookie with allowed Origin, or B2C customer Bearer token | No body/path/query fields | Removes the selected cart record and returns empty summary. Guest ownership cookie remains/renews; clearing items is not logout. |
| `POST /api/v1/b2c/cart/merge` | B2C customer Bearer token, allowed Origin, and guest cookie if present | No body/path/query fields | Atomically merges guest selections into account cart and clears guest cookie on success. Without guest cookie returns account cart and still clears that cookie path. |

The additional POST /api/v1/b2c/cart/coupon-preview is owned by [Coupons](../coupons/COUPONS_FRONTEND.md) and mounted beneath this router. Required code and checkout phone use the same guest/customer ownership and shared limiter; guest POST requires trusted Origin. The response is a separate Coupon preview DTO, not Cart. It does not save a code or consume a use. Read that contract for every request/response field, eligibility rule and error.

There is no GET-by-cartId, POST-add-quantity, PATCH-item, DELETE-by-itemId, coupon field, or shipping/address/payment input. Extra queries do not select an owner, language (use headers), product, or alternate cart. Do not send ignored body data to GET/DELETE/merge.

### Every PUT body field

| Field | Type, required/default, validation | Meaning/source | Retain for next request |
| --- | --- | --- | --- |
| `productId` | Required string; valid 24-character hexadecimal ObjectId, normalized lowercase | `id` returned by Products. Identifies the parent product even for a variant. | Keep for every later quantity/removal call. |
| `variantId` | Optional/null for simple product; required meaningful ID for a variant product; ObjectId string normalized lowercase | Selected Products `variants[].id`, not an option value, SKU, or image ID. | Keep alongside productId to identify this exact sellable selection. |
| `quantity` | Required actual JSON safe integer from 0 to 10000 | Desired final units for this selection. Zero removes it. Not a delta and not a pouch quantity. | Replace local state with the server response; do not increment again when retrying. |

Simple product: `{ "productId": "507f1f77bcf86cd799439041", "quantity": 2 }`. It also accepts variantId:null. A non-null variantId on a simple product fails 422. Variant product:

```json
{
  "productId": "507f1f77bcf86cd799439042",
  "variantId": "507f1f77bcf86cd799439043",
  "quantity": 2
}
```

A variant must belong to that product and still exist. Missing/nonmatching variant selection fails 409 CART_VARIANT_NOT_FOUND. JSON numeric strings, fractions, negatives, null quantity, and quantity above 10000 fail 422. Request fields are whitelisted; ownerKey, userId, cartId, store, activeSale, price, discountedPrice, unitPrice, lineTotal, subtotal, status, stock, SKU, values, and images do not determine stored selections or trusted prices.

Quantity zero removes the matching `(productId, variantId)` selection even if its catalog item is currently unavailable. Retain its variantId when removing a variant: omitting variantId targets the null-variant selection and does not mean remove every variant of the parent. Removing an already absent selection is a successful no-op on items. At most 100 distinct selections and 10000 units per selection are permitted. Different variants of one product count as different selections.

## Headers, cookies, and ownership precedence

Send application/json for PUT, X-Language en/ar for localized names/messages, and `credentials: 'include'` on browser calls involving cookies. Browser transport automatically manages Origin/Cookie. Account requests send `Authorization: Bearer <B2C customer accessToken>` obtained from Auth.

| State/header | Source and exact behavior | Frontend rule |
| --- | --- | --- |
| Authorization header present | Always authenticates against the current B2C account/session, then requires user role | Valid token selects account cart even if a guest cookie also exists. A blank/malformed/expired/wrong-store token is rejected; it never falls back to guest. |
| No Authorization header | Uses guest cookie or creates a random guest token | For deliberate guest requests, omit the header completely; do not send `Bearer undefined` or an empty string. |
| `narmer_cart_b2c` cookie | Browser-held 43-character random base64url token; database stores SHA-256 digest only | JavaScript must not read/save/create the token. Use credentials include. |
| Cookie options | HttpOnly; SameSite=Lax; Secure in production; Path=/api/v1/b2c/cart; Max-Age=2592000 seconds | Match deployment/cookie requirements in shared conventions. The cart cookie is not an Auth refresh cookie. |
| Guest GET/PUT/DELETE | Issues/renews ownership cookie; malformed nonempty or duplicate cookie is rejected | An error response may already contain a renewed guest cookie because middleware runs before body validation; it does not prove items changed. |
| Origin on guest writes | Required exactly in configured CORS_ORIGINS, including new guest and same-origin calls | Missing Origin fails 403 FORBIDDEN; unallowed Origin may be rejected first by CORS. |
| Origin on every merge | Required even with account Bearer token | Frontend should call directly from its allowed browser origin or pass that Origin correctly from trusted SSR. |

Duplicate cookies with this name or a malformed nonempty token return 401 UNAUTHORIZED. Since it is HttpOnly, JavaScript cannot repair it by writing a token; clearing affected browser site cookies can recover during troubleshooting. No guest-cookie-reset API exists. A visitor calling merge without authenticated user credentials receives a forbidden result rather than a login session; merge does not authenticate the user.

All Cart routes share an IP/process limit of 150 requests per 15 minutes. Authenticated customers also share a 150-request Cart account allowance per 15 minutes across tokens, sessions and IPs. Both are additional to API IP 240/minute and verified-account 120/minute controls. Proof upload has its additional 20/hour IP and authenticated-account limits. On 429 respect exposed Retry-After, preserve Cart/checkout/proof state, and avoid polling or endless retries. Guests use IP limits and cookie ownership, without an account quota.

## Expiry and lifecycle

Guest retention starts at cart creation or reset, and each successful item write sets expiresAt to 30 days after that write. GET of an existing unexpired cart preserves its expiry and version. An expired guest cart is reset to empty with a fresh 30-day expiry, without restoring its old selections. Account carts have no expiry. Zero-quantity removal writes also renew guest retention. GET renews the browser cookie’s Max-Age, but only creation/reset or an item write changes database expiry. Logical expiry takes effect before MongoDB TTL physical deletion.

DELETE clears items/record but does not revoke the guest token. A later guest PUT can create a new cart under that cookie. Successful merge deletes the source guest record and expires the guest cookie; later browsing without an account token creates a new guest identity. Logout only handles Auth; it does not convert/delete the saved account cart. The frontend must drop the logged-out account's cached cart and re-fetch as a guest without its Authorization header.

No cart expires automatically because a payment is pending, and Cart itself has no payment state, reminder, abandon-cart notification, or history endpoint. Expired guest references no longer block product deletion. Non-expiring account and unexpired guest references block deleting a selected product or removing its selected variant; catalog deactivation remains possible.

## Every Cart response field

| Field | Type/presence | Meaning/source | What to retain |
| --- | --- | --- | --- |
| `items` | Always array | Server's current selections decorated with current Products data | Replace local items after mutations; do not treat response as a request body. |
| `itemCount` | Always nonnegative integer | Sum of stored quantities, including temporarily unavailable selections | Basket badge total units, not distinct-line count. |
| `subtotal` | Integer piastres or null | Sum of priced line totals; null if any selected item cannot be priced | Display as estimate only; active Sales are included; shipping/Coupons/checkout total are not included. Empty cart subtotal is zero. |
| `currency` | Always EGP string | Fixed backend currency | Divide piastres by 100 for display. |
| `canCheckout` | Always boolean | True only for a nonempty cart whose every line is currently available with enough stock | UI preview gate; does not reserve stock or guarantee that a later Checkout/Order request will succeed. |

Every item has the following exact keys. There is no per-line id; `(productId, variantId)` is its identity. There is no returned cart id, owner key, expiry, version, coupon, shipping, or grand total.

| Item field | Type/presence | Meaning/source | Frontend handling/retention |
| --- | --- | --- | --- |
| `productId` | Always ObjectId string | Stored parent-product selection | Retain for PUT/removal/navigation through Products detail. |
| `variantId` | Always ObjectId string or null | Stored selected variant; null for simple product | Retain for variant quantity/removal. |
| `quantity` | Always positive integer 1–10000 | Stored selected units; zero is an input action, never a stored line | Initialize quantity controls. |
| `name` | Localized string or null | Current visible parent product name; null if product/variant cannot be resolved | Display unavailable placeholder for null, not a stale hidden-product name. |
| `slug` | String or null | Current visible product slug | Optional frontend route metadata; backend detail uses productId. |
| `images` | Always array of image DTOs; possibly empty | Current selected variant gallery with public product fallback, or simple product gallery; empty for unavailable line | First is main image; use placeholder for empty. |
| `images[].id` | ObjectId string | Current attached Media image ID | Display context; Cart mutations do not accept images. |
| `images[].url` | Absolute public CDN URL string | Server-created processed WebP URL | Image rendering only. |
| `images[].width`, `images[].height` | Integer 1–1600 each | Output image pixel dimensions | Layout/aspect ratio. |
| `values` | Object mapping option key to selected value key, or null | Current variant selection, e.g. `{size:"small"}`; null for simple/unavailable | Keys are identifiers, not translated labels. Resolve labels through Products options if needed. Do not send values to Cart. |
| `values.<optionKey>` | String for each selected variant option | Matching value key in Products options[].values | Selected option label can be obtained from Products; not an arbitrary extra key. |
| `sku` | String or null | Current optional selected SKU; null can mean no SKU or unavailable | Display only; do not use as selection ID. |
| `price` | Integer piastres or null | Current regular price of selected simple/variant item | Display price basis; null for unavailable. |
| `discountedPrice` | Integer piastres or null | Current timed-sale result when active, otherwise saved product discount; null means none, zero can be valid | Use null-aware checks, not `discountedPrice || price`. |
| `unitPrice` | Integer piastres or null | Products current effectivePrice (`discountedPrice ?? price`, including active campaign result) | Actual current unit price used for lineTotal; later integrations may change pricing centrally. |
| `stock` | Nonnegative integer or null | Current stock of selected simple/variant; null for unavailable | Availability guidance, not a reservation. |
| `lineTotal` | Integer piastres or null | unitPrice times quantity, even if quantity now exceeds stock | Show estimate; null when unresolved. |
| `status` | String enum available / insufficient_stock / unavailable | Derived from public visibility, current variant existence, and quantity versus stock | Render actionable availability warning. Never send it as authority. |

Timed Sales are applied through Products on every current Cart read. Coupons previews and Orders coupon redemption are implemented separately; ordinary Cart totals remain before coupon. The existing saved discountedPrice is supported and can be zero. An insufficient_stock line still has its current name/prices/stock and calculated lineTotal, but canCheckout is false. An unavailable line has null name/slug/values/SKU/prices/stock/lineTotal and images:[]; IDs/quantity remain so it can be removed. Any unpriceable line makes subtotal null, rather than silently totaling only the remaining lines. itemCount still includes all quantities.

PUT validates stock/visibility for the selected new/changed line. Other stored lines are not silently removed or clamped if they changed meanwhile; the returned summary reports their current status. A stock failure on the selected line preserves the previous cart. Returned ordering follows stored selections; updating a line removes it and appends the updated selection, so it can move to the end. Do not use array index as stable identity.


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

Do not copy public campaign discountedPrice into a dashboard price editor. Refetch Product/Cart data after campaign or catalog edits and before later checkout. Refetching replaces retained display metadata; it never locks a price. [Coupons](../coupons/COUPONS_FRONTEND.md) preview is implemented separately and excludes activeSale lines. Orders now snapshots current prices at placement; read its separate contract.

## Complete response examples

Empty GET/DELETE success:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": { "items": [], "itemCount": 0, "subtotal": 0, "currency": "EGP", "canCheckout": false },
  "requestId": "f138736c-2bce-4b41-b229-7b044998ceef"
}
```

Complete `data` example after setting two units of a simple product with no images/SKU/discount:

```json
{
  "items": [
    {
      "productId": "507f1f77bcf86cd799439041",
      "variantId": null,
      "quantity": 2,
      "name": "Shirt",
      "slug": "shirt",
      "images": [],
      "values": null,
      "sku": null,
      "price": 25000,
      "discountedPrice": null,
      "activeSale": null,
      "unitPrice": 25000,
      "stock": 10,
      "lineTotal": 50000,
      "status": "available"
    }
  ],
  "itemCount": 2,
  "subtotal": 50000,
  "currency": "EGP",
  "canCheckout": true
}
```

A variant item uses the same keys, with non-null variantId and values such as `{ "size": "small" }`, prices/stock/SKU from that variant, and the variant/product gallery rules. To remove it, send the same productId and variantId with quantity zero. In a simple line that later becomes unavailable, the full item becomes:

```json
{
  "productId": "507f1f77bcf86cd799439041",
  "variantId": null,
  "quantity": 2,
  "name": null,
  "slug": null,
  "images": [],
  "values": null,
  "sku": null,
  "price": null,
  "discountedPrice": null,
  "activeSale": null,
  "unitPrice": null,
  "stock": null,
  "lineTotal": null,
  "status": "unavailable"
}
```

Complete Cart data during a 20% active campaign, with two units of the selected simple product:

```json
{
  "items": [
    {
      "productId": "507f1f77bcf86cd799439041",
      "variantId": null,
      "quantity": 2,
      "name": "Shirt",
      "slug": "shirt",
      "images": [],
      "values": null,
      "sku": null,
      "price": 25000,
      "discountedPrice": 20000,
      "activeSale": {
        "id": "66f000000000000000000050",
        "name": "Summer sale",
        "discountType": "percentage",
        "discountValue": 20,
        "startsAt": "2026-10-11T12:00:00.000Z",
        "endsAt": "2026-10-12T12:00:00.000Z"
      },
      "unitPrice": 20000,
      "stock": 10,
      "lineTotal": 40000,
      "status": "available"
    }
  ],
  "itemCount": 2,
  "subtotal": 40000,
  "currency": "EGP",
  "canCheckout": true
}
```

## End-to-end guest, customer, and merge sequences

### Guest shopping

1. Browse Products/Categories without authentication. Retain product id and selected variant id; choose by option/value keys through Products.
2. GET Cart with credentials include and no Authorization header. Browser stores the ownership cookie; JavaScript only needs returned items.
3. PUT desired final quantity. Validate basic input locally but accept server stock/visibility as authoritative.
4. Replace the local summary from the returned data, using IDs as keys. GET again when returning to cart or after a known catalog change; do not calculate a permanent cached price.
5. Use quantity zero to remove one selection or DELETE to clear all. Preserve the guest cookie for future shopping; never store it as an access token.

### Customer shopping and sign-in merge

1. Before sign-in the guest cookie belongs to the guest cart. Login uses Auth path and does not receive/send a Cart identifier in its JSON body.
2. On login success retain the B2C access token and keep cookie credentials enabled. Do not discard guest state before the merge succeeds.
3. POST `/api/v1/b2c/cart/merge` with the account Bearer token, credentials include, allowed Origin, and no JSON fields.
4. Successful merge combines matching quantities and adds other guest selections, commits account cart plus source deletion together, then clears the guest cookie. Replace displayed summary with returned account data.
5. If merge fails due to stock/visibility/limit, both carts are unchanged and the guest cookie remains. GET account cart with Authorization; GET guest cart without Authorization. Let the customer adjust either appropriately, then retry merge. Do not omit the bearer header on a request intended to edit the account cart.
6. Subsequent normal Cart calls use the account JWT. Another customer's login does not grant the previous account's cart; invalidate user-specific cache when account identity changes.

For the same selection, account quantity 2 plus guest quantity 3 becomes 5, not 3. If stock is 4, the merge fails; the system does not automatically clamp or discard the extra unit. No-guest/empty/expired-guest merge returns the account cart without duplicating quantities, and clears the cookie on success. Repeating a successful merge with the old cookie cannot add the guest quantities again. Existing invalid account lines are revalidated along with guest lines when a nonempty source is merged.

Parallel PUTs retain both independent selections through transactional catalog coordination and conditional cart writes. An absolute PUT of quantity 2 is safe to repeat; a merge consumes the source only once. No public version is returned or required. Server CART_CONFLICT means re-fetch both intended state and current availability before deciding to repeat.

## Every known error and recovery

| HTTP/code | Trigger | Frontend action |
| --- | --- | --- |
| 401 UNAUTHORIZED | Bad bearer credentials, wrong store, revoked account/session, malformed/duplicate guest cookie | Follow store Auth recovery for bearer requests; guest cookie troubleshooting differs. Never downgrade a failed authenticated edit into guest silently. |
| 403 FORBIDDEN | Staff role, missing allowed Origin for guest write/merge, unauthenticated merge role check | Correct role/Origin or sign in as customer. |
| 403 CORS_DENIED | Browser Origin not allowed | Operator/frontend origin configuration; fetch may reject without readable body. |
| 404 PRODUCT_NOT_FOUND | Positive-quantity target missing/inactive/hidden by category | Reload catalog or remove stale item; no mutation occurred. |
| 409 CART_VARIANT_NOT_FOUND | Variant product has missing/foreign/removed variant selection | Reload Product options/variants and choose an available variant. |
| 409 CART_INSUFFICIENT_STOCK | Positive requested quantity exceeds selected item's current stock | Keep prior cart; show current availability and let customer reduce quantity. |
| 409 CART_LIMIT_EXCEEDED | Cart would exceed 100 selections or merged quantity 10000 | Ask customer to reduce/remove selections; no partial update. |
| 409 CART_MERGE_UNAVAILABLE | Nonempty merge result includes unavailable or insufficient-stock lines | Preserve both views/cookie and guide review/adjustment, then retry. |
| 409 CART_CONFLICT | Conditional write/unique owner conflict | GET current cart and reconcile. Do not invent a client version field. |
| 422 VALIDATION_ERROR | Bad field/ID/quantity or variant ID supplied for simple product | Correct input. Service errors may have an empty errors array. |
| 429 TOO_MANY_REQUESTS | General IP/account or Cart IP/account limiter; proof uploads have additional limits | Respect Retry-After, preserve state, and stop retry/render loops. |
| 503 TRANSACTIONS_REQUIRED | Database does not support the required transaction | Operator must configure a replica set; preserve local input. |

Shared body/encoding errors and unexpected 500s apply. NOT_READY is the shared health readiness code, not a dedicated Cart error emitted by these routes. Failed cart transactions preserve selections and product references. If the network response is lost, use GET before replaying user intent. A merge might have committed and cleared its source even if the client lost the response; repeated source merge is safe, and account GET is the reconciliation path.

## Future boundary, retained state, and source

Keep only access state managed by Auth, browser cookies, product/variant IDs, requested quantities, locale, and latest returned summary. Do not persist a trusted shipping amount, coupon discount, payment proof, or checkout total here. Orders recalculates everything and deducts stock atomically at order placement. Stock may change between a Cart success and order placement.

Source: Cart routes/controller/validator/service/repository/model; Products view/batch lookup/catalog guard/reference collaborator; Auth middleware; app composition; shared envelopes/context. Tests: cart-service, cart-http, Products HTTP, and the isolated real MongoDB test for concurrent item writes, merge replay/rollback, expiry, and cart-versus-product/variant mutation races. Deployed browser/provider delivery was not newly checked for this document.

## Exact Cart handoff to other modules

Cart responses are the whole Cart object in envelope data, never data.cart, and contain no cartId or itemId. Retain the stable pair productId/variantId for each selection; array position can change after a quantity write and is not identity.

| Frontend input/state | Source | Next request or display use |
| --- | --- | --- |
| productId | Public Product detail data.id, Product list data.items[].id, or Wishlist data.items[].productId. | PUT /api/v1/b2c/cart/items body productId. For a variant, this still identifies the parent product. |
| variantId | Chosen returned Product variants[].id; or an existing Cart data.items[].variantId when changing/removing that line. | The same PUT body variantId. Do not send option keys, SKU, Media ID, or another product's variant ID. Omit/null for simple products. |
| quantity | Buyer's desired final unit count, initialized from an existing Cart data.items[].quantity. | PUT body quantity as an actual JSON integer. Zero removes that exact pair; a replay must send the same absolute count, not add the count again. |
| Account access token | Auth login/refresh data.accessToken for a B2C user account. | Bearer authorization selects the account Cart. After login explicitly POST /api/v1/b2c/cart/merge with credentials included and an allowed Origin; Auth does not invoke it. |
| Guest ownership | Browser-owned narmer_cart_b2c cookie, set by Cart. | credentials: include on guest Cart/coupon/checkout calls. JavaScript cannot read/construct it. Do not replace it with a returned product/customer ID or a guest Order tracking token. |
| Selected coupon code / checkout phone | Buyer's current code and confirmed contact phone. | POST /api/v1/b2c/cart/coupon-preview body code/phone. Preserve them in the checkout form and later send couponCode/customer.phone to Checkout. Cart stores neither input. |
| Cart data.items, itemCount and subtotal | Current decorated selections and current price/availability calculation. | Render current selections/badge/merchandise estimate, then let Checkout calculate its own totals. Do not POST Cart items or its computed prices/subtotal into Checkout. |
| canCheckout and line status | Latest Cart data.canCheckout and items[].status. | Gate the checkout UI and offer removal/quantity changes. They do not reserve stock; Checkout can still reject changed availability. |
| Cart option values and galleries | Current selected variant/product projections. | Display only; use Product options for translated labels and keep IDs for mutations. Unavailable lines return null metadata/empty images but keep selection IDs for removal. |

Serialize rapid writes for the same line or reconcile the latest server result so an older response does not overwrite a newer UI choice. There is no exposed expectedVersion or Cart idempotency key. PUT's absolute-quantity semantics make repeating the same intent safe, but other tabs may still change that intent between calls. Merge combines both sources atomically; a failed merge preserves them, so do not clear guest UI selections before success.

## Adding from Wishlist

[Wishlist](../wishlist/WISHLIST_FRONTEND.md) stores product IDs for signed-in B2C customers. It does not select variants, reserve stock, or change Cart automatically. Use its productId plus a chosen quantity for a simple item; choose and include a current variantId for variant items. Send only the existing Cart body fields, and use the returned Cart pricing/stock result. Wishlist remains saved unless the frontend separately removes its entry after Cart succeeds; those requests are not one atomic operation.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.


### Size guide boundary — 2026-10-22

Optional reusable guides are shown through B2C Product list/detail; Cart does not add sizeChart or sizeChartId. Guide content never changes a Cart variant identity or validates a selected size. Continue selecting real Product variants, then use normal Cart/Checkout stock and price checks. See [Size Charts](../sizecharts/SIZECHARTS_FRONTEND.md).
