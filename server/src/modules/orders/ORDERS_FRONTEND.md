# Checkout and Orders: frontend integration contract

Private-storage integration update (2026-10-12): Order proofs and [B2B Lead images](../leads/LEADS_FRONTEND.md) now share the bounded private Bunny transport and existing private-zone configuration. Their constrained object namespaces, authorization and cleanup records remain separate. Proof routes, headers, DTOs, expiry, attachment and cleanup semantics below are unchanged. Lead image IDs are never valid proof IDs; B2B staff access grants no B2C proof permission. Live provider-zone privacy/configuration remains unverified.

Source checked: 2026-10-13. Checkout and Orders are mounted for B2C. The 24-hour checkout lifetime and 90-day guest tracking lifetime described here are current API defaults; use returned timestamps as the authority. This document describes current source behavior; it does not claim browser, database-provider, Bunny-provider, or deployed-environment verification. Read [shared API conventions](../../../../docs/frontend/api-conventions.md), [B2C flow](../../../../docs/frontend/b2c-flow.md), [Cart](../cart/CART_FRONTEND.md), [Coupons](../coupons/COUPONS_FRONTEND.md), and [Shipping](../shipping/SHIPPING_FRONTEND.md) with this contract.

## Route inventory and access

There are exactly 14 method/path combinations: three checkout operations, five customer/tracking operations, and six staff operations. All successes use the shared five-field JSON envelope unless a proof endpoint is returning image bytes. JSON successes use code `OK`. Every Orders/checkout response sets `Cache-Control: no-store`. Do not cache orders, proofs, checkout previews, or receiving-account details in shared/public caches.

| # | Method and exact path | Who can call it | Success |
|---|---|---|---|
| 1 | `POST /api/v1/b2c/cart/checkout` | Guest cookie owner or B2C `user` | 200; creates a 24-hour checkout snapshot, no stock reservation |
| 2 | `POST /api/v1/b2c/cart/checkout/orders` | Same owner as checkout; guest or B2C `user` | 201 when created; 200 on same-request replay |
| 3 | `POST /api/v1/b2c/cart/checkout/:checkoutId/proof` | Same guest/customer Cart owner | 201; raw image upload |
| 4 | `GET /api/v1/b2c/orders/tracking/:orderId` | Guest tracking token in `X-Order-Token` | 200 customer-safe Order DTO |
| 5 | `GET /api/v1/b2c/orders/tracking/:orderId/proof` | Guest tracking token in `X-Order-Token` | 200 raw `image/webp` bytes |
| 6 | `GET /api/v1/b2c/orders` | B2C `user` | 200 customer Order list |
| 7 | `GET /api/v1/b2c/orders/:orderId` | Owning B2C `user` | 200 customer-safe Order DTO |
| 8 | `GET /api/v1/b2c/orders/:orderId/proof` | Owning B2C `user` | 200 raw `image/webp` bytes |
| 9 | `GET /api/v1/admin/b2c/orders/settings` | B2C `superAdmin` or `admin` | 200 settings DTO |
| 10 | `PATCH /api/v1/admin/b2c/orders/settings` | B2C `superAdmin` or `admin` | 200 settings DTO |
| 11 | `GET /api/v1/admin/b2c/orders` | B2C `superAdmin`, `admin`, or `moderator` | 200 staff Order list |
| 12 | `GET /api/v1/admin/b2c/orders/:orderId` | Same staff roles | 200 staff Order DTO |
| 13 | `GET /api/v1/admin/b2c/orders/:orderId/proof` | Same staff roles | 200 raw `image/webp` bytes |
| 14 | `PATCH /api/v1/admin/b2c/orders/:orderId/status` | Same staff roles | 200 updated staff Order DTO |

There is no Order `DELETE`, customer cancellation, payment/refund execution endpoint, tracking-token recovery endpoint, proof replacement endpoint, or guest-to-account attachment operation. Do not invent these calls. The app composes checkout beneath Cart, so the exact prefix includes `/cart/checkout`. Store is fixed to `b2c` by route composition; no body field can select a store.

## Shared request transport and ownership

Send `X-Language: en` or `ar` consistently; `Accept-Language` is the fallback. Localized product, sale, coupon, and shipping names in a preview or Order are a single string in that response language. The stored snapshot retains bilingual source objects where available, allowing a later read in a different language to produce the requested localized label. Customer-supplied name/address text is returned as entered after trimming; it is not translated.

For checkout and proof upload, send `credentials: 'include'` so the browser manages `narmer_cart_b2c`. For a guest, omit `Authorization` completely. The Cart middleware chooses an account only when an Authorization header is present, authenticates it, and requires role `user`; an invalid header does not fall back to the guest cookie. Guest writes, including preview, placement, and proof upload, require the browser Origin to exactly match configured `CORS_ORIGINS`. The browser supplies Origin and Cookie; do not set either manually in browser JavaScript. SSR must forward an allowed Origin explicitly. Cart cookie properties and guest ownership are described in [Cart](../cart/CART_FRONTEND.md).

Authenticated customers use a B2C access JWT from Auth with `Authorization: Bearer <accessToken>`. Staff use their B2C staff JWT. Staff roles are checked on every call. A user can read only their own account Orders; staff may read all B2C Orders. Moderators may view Orders and proofs and change status, but may not read or edit the receiving-account setting. Guest Orders are never attached to a later account at signup or login; their tracking credential remains the access path.

JSON request bodies use `Content-Type: application/json`. Shared JSON bodies are limited to 100 KiB. Proof uploads send raw bytes, not JSON, base64, or multipart form data, with exactly `Content-Type: image/jpeg`, `image/png`, or `image/webp`. File limit is 5 MiB. See upload details below. For proof GET, request an image response and handle bytes/blob; the response is not a JSON envelope.

Checkout routes share Cart IP and authenticated-account allowances of 150 requests per 15 minutes. Proof upload additionally allows 20 requests/hour per IP and authenticated account. The two guest tracking/proof-read routes share 100 requests per 15 minutes per IP. Every API call also uses IP 240/minute; verified customer/staff calls also use store/account 120/minute. Customer/staff Order reads and staff writes have no further Orders-specific limiter. Headers RateLimit, RateLimit-Policy and Retry-After are exposed to allowed browser origins. Counters remain process-local; token/session/IP rotation cannot reset the account budget. Guests use IP budgets rather than stored account identities.

## Customer checkout flow

1. Fetch/update Cart through its documented endpoints, then collect checkout contact, delivery address, payment method, and optional coupon. Customer email and phone are part of checkout input and are snapshotted on the Order; the signed-in account profile is not substituted automatically.
2. Call checkout preview. The server reads the current owner Cart, current product and Sale pricing, checks the current stock availability, calculates coupon allocation, resolves shipping from the governorate code, and snapshots the normalized input and quote. It reserves no stock and does not consume a coupon use.
3. For `instapay`, display `receivingAccount` and upload the payment screenshot to the returned checkout ID. Keep the returned proof `id`; the upload is only a prepared private proof and is not yet attached to an Order.
4. Place the Order with `checkoutId`, and for InstaPay only, `proofId`. COD must omit `proofId`. On success, replace local Cart/checkout state with the returned Order and retain the guest tracking token and expiry when present. The server revalidates Cart selection and current pricing, transactionally attaches proof, deducts stock, consumes coupon use, creates Order, and consumes Cart. A subsequent Cart GET creates a new empty Cart database record without affecting the placed Order or its safe replay.
5. If the placement response is lost or the client times out, reconcile using the retained checkout and the same exact placement body. A confirmed validation/conflict response needs the specific recovery action in the errors table. Do not generate a new checkout just because the response was lost. A same owner and identical `(checkoutId, proofId)` request is idempotent and returns the existing Order; a different proof choice for the same checkout conflicts.

Checkout preview does not lock a price or stock. At placement, the selected `(productId, variantId, quantity)` set must still match the checkout snapshot. A changed selection fails; changed prices, Sale, coupon eligibility, and shipping are recalculated from current server state and become the actual Order values. The staff Order DTO exposes the earlier `quotedPreview` beside the actual current values for this reason. Customer DTO does not expose that internal comparison.

### Browser request sequence

Use the same API origin and allowed frontend Origin for the whole flow. For guest requests, omit `Authorization` and use `credentials: 'include'`; the browser sends/receives the HttpOnly Cart cookie. For account checkout, include the current B2C customer Bearer token and still use `credentials: 'include'` so the browser retains the Cart cookie state, although the account JWT selects the account Cart. Never put the tracking capability in a query string: query values are routinely copied into logs, analytics, and referrers. If a guest tracking link must survive a page load, a URL fragment is not sent in HTTP requests/referrers; read it once, move the token into protected app state, and remove the fragment from browser history before making requests. Always send it through `X-Order-Token`.

```js
const api = 'https://api.example.test';
const headers = { 'Content-Type': 'application/json', 'X-Language': 'en' };
// For a signed-in customer only:
// headers.Authorization = `Bearer ${accessToken}`;
const checkoutResponse = await fetch(`${api}/api/v1/b2c/cart/checkout`, {
  method: 'POST', credentials: 'include', headers,
  body: JSON.stringify(checkoutInput)
});
const checkoutEnvelope = await checkoutResponse.json();
if (!checkoutResponse.ok) throw checkoutEnvelope;
const checkout = checkoutEnvelope.data; // retain checkoutId and expiresAt

const proofResponse = await fetch(`${api}/api/v1/b2c/cart/checkout/${checkout.checkoutId}/proof`, {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': proofFile.type }, body: proofFile // raw File bytes; no FormData
});
const proofEnvelope = await proofResponse.json();
if (!proofResponse.ok) throw proofEnvelope;
const placementResponse = await fetch(`${api}/api/v1/b2c/cart/checkout/orders`, {
  method: 'POST', credentials: 'include', headers,
  body: JSON.stringify({ checkoutId: checkout.checkoutId, proofId: proofEnvelope.data.id })
});
const placementEnvelope = await placementResponse.json();
if (!placementResponse.ok) throw placementEnvelope;
const { order, trackingToken, trackingExpiresAt } = placementEnvelope.data;
// For a guest, securely retain a non-null trackingToken and its expiry.
```

For a COD checkout, skip proof upload and send `{checkoutId}` to placement. For account-owned Orders, use authenticated customer detail/list routes. To load a guest Order use:

```js
const trackingResponse = await fetch(`${api}/api/v1/b2c/orders/tracking/${orderId}`, {
  headers: { 'X-Order-Token': retainedTrackingToken, 'X-Language': 'en' }
});
const trackingEnvelope = await trackingResponse.json();
if (!trackingResponse.ok) throw trackingEnvelope;
const proofRead = await fetch(`${api}/api/v1/b2c/orders/tracking/${orderId}/proof`, {
  headers: { 'X-Order-Token': retainedTrackingToken }
});
if (!proofRead.ok) throw await proofRead.json();
const proofUrl = URL.createObjectURL(await proofRead.blob());
// Set proofUrl as the image source; call URL.revokeObjectURL(proofUrl) when no longer displayed.
```

For signed-in customer proof reads, use `/api/v1/b2c/orders/${orderId}/proof` with `credentials: 'include'` and `Authorization`; for staff, use `/api/v1/admin/b2c/orders/${orderId}/proof` with the staff token. They return image bytes, so only parse JSON when the response is an error. Always revoke blob URLs when the image is removed or the page/component is disposed.

### Preview request: endpoint 1

`POST /api/v1/b2c/cart/checkout` has a required JSON body. Unknown fields are removed by request validation. Every listed text value is trimmed. Email is lowercased; phone has spaces, parentheses, and hyphens removed. Coupon code is uppercased.

| Field | Required/type and validation | Meaning and retained state |
|---|---|---|
| `customer` | Required object | Contact snapshot for delivery/order communication; retain the same values for subsequent checkout operations only through server checkout ID. |
| `customer.name` | Required string, 1–100 trimmed characters | Recipient name. |
| `customer.email` | Required valid email string, at most 254 characters after trim/lowercase | Customer-entered contact email. |
| `customer.phone` | Required string; normalized form must match optional `+` followed by 6–15 digits | Customer-entered contact phone and key used to evaluate per-person coupon limits. |
| `address` | Required object | Delivery-address snapshot. |
| `address.governorate` | Required string, 1–100 trimmed characters | Display label supplied by client; retained as-is. |
| `address.governorateCode` | Required string, 1–100 after trim/lowercase; pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Stable code passed to Shipping resolver. It is syntax-checked, not checked against an authoritative governorate directory. |
| `address.district` | Required string, 1–100 trimmed characters | District/area label; does not affect shipping calculation. |
| `address.building` | Required string, 1–200 trimmed characters | Building/house identifier. |
| `address.street` | Required string, 1–200 trimmed characters | Street address. |
| `address.floor` | Optional string, at most 50 trimmed characters; omitted or empty string becomes `""` in service normalization; explicit null fails HTTP validation | Optional floor text. |
| `address.apartment` | Optional string, at most 50 trimmed characters; omitted or empty string becomes `""`; explicit null fails HTTP validation | Optional apartment/unit text. |
| `address.details` | Optional string, at most 1000 trimmed characters; omitted or empty string becomes `""`; explicit null fails HTTP validation | Optional delivery instructions. |
| `paymentMethod` | Required literal `cod` or `instapay` | Selects cash on delivery or manual InstaPay transfer. No gateway is called. |
| `couponCode` | Optional string, trim/uppercase, pattern `^[A-Z0-9][A-Z0-9_-]{2,39}$` | Coupon to calculate and later redeem atomically. Omission means no coupon; explicit null is invalid. |

Example body:

```json
{
  "customer": { "name": "Mona Saleh", "email": "mona@example.test", "phone": "+201001234567" },
  "address": {
    "governorate": "Cairo", "governorateCode": "cairo", "district": "Nasr City",
    "building": "12", "street": "Example Street", "floor": "3", "apartment": "8", "details": "Call on arrival"
  },
  "paymentMethod": "instapay",
  "couponCode": "WELCOME10"
}
```

The response is `data` with `checkoutId` (lowercase MongoDB ObjectId, retain for proof upload and placement), `expiresAt` (ISO UTC timestamp), `paymentMethod`, `items`, `coupon`, `shipping`, `totals`, `currency`, `quotedAt`, and `receivingAccount`. `expiresAt` is set 24 hours after the server's captured checkout time; treat server value as authoritative. A TTL index eventually removes expired checkouts, while application checks reject them immediately. `receivingAccount` is the configured account string for InstaPay, or null for COD. It is not a payment confirmation.

### Preview and pricing DTO fields

All money values are integer EGP piastres (`5000` = EGP 50). No tax is added. Use null-aware handling so zero prices/fees remain valid.

| Field | Type/presence and meaning |
|---|---|
| `items` | Array in Cart order; each item is the current selected item snapshot described below. |
| `items[].productId` | Product ObjectId string. |
| `items[].variantId` | Variant ObjectId string or null. |
| `items[].name` | Localized product name string. |
| `items[].category` | Null for an uncaptured legacy item; otherwise `{id,name}` with the historical direct-category ObjectId string and localized name. Captured by the server at each quote/placement; never sent by the FE. See the reporting follow-up below. |
| `items[].slug` | Current product slug string. |
| `items[].values` | Variant option-key to selected value-key object, or null for simple products. |
| `items[].sku` | SKU string or null. |
| `items[].quantity` | Positive integer selected quantity. |
| `items[].price` | Current regular product/variant price in piastres. |
| `items[].discountedPrice` | Effective current sale/saved discount in piastres or null when no discount applies. |
| `items[].unitPrice` | Effective unit price used in calculation, in piastres. |
| `items[].lineTotal` | `unitPrice * quantity`, in piastres, before coupon. |
| `items[].activeSale` | Null or Sale snapshot with `id`, localized `name`, `discountType`, `discountValue`, `startsAt`, and `endsAt`; use Products contract for exact semantics. |
| `items[].couponDiscount` | Coupon allocation for this line in piastres; zero if no coupon or line is ineligible. |
| `items[].lineTotalAfterDiscount` | Line total less the allocated coupon amount, in piastres. |
| `coupon` | Null or `{id, code, name, discountType, discountValue}`. `name` is localized. `discountType` is `percentage` or `fixed`; percentage is whole percent, fixed amount is piastres. |
| `shipping` | Shipping quote snapshot. Override quote is `{id, governorateCode, name, fee, currency, source}`; default quote uses `id:null`, `name:null`, `source:"default"`. `id` is an ObjectId or null; `governorateCode` is normalized lowercase; `name` is localized or null; `fee` is a nonnegative integer up to 1,000,000,000 piastres; `currency` is literal `EGP`; `source` is `override` or `default`. |
| `totals.subtotal` | Current merchandise subtotal before coupon in piastres. |
| `totals.discountAmount` | Total Coupon discount in piastres, zero without a coupon. |
| `totals.shippingFee` | Resolved shipping fee in piastres. |
| `totals.total` | Subtotal minus discount plus shipping fee, in piastres. |
| `currency` | Literal `EGP`. |
| `quotedAt` | ISO UTC timestamp captured by server for the quote calculation. |
| `receivingAccount` | Configured transfer-account instructions for InstaPay; null for COD. |

Coupon allocation is server-calculated across eligible lines with integer piastres. Items with an active Sale are excluded from coupon eligibility; coupon scope and minimum spend are checked by Coupons. Shipping is not included in coupon minimum spend or discount. At actual placement Coupons rechecks and consumes usage within the same transaction as the Order. A canceled or returned Order does not restore coupon usage; the redemption remains counted. Cart references/prices are never accepted from client preview data.

## Field provenance and request handoff

### Nested field sources and subsequent use

The tables in the pricing section describe both live checkout results and the saved Order item snapshots. Before placement, they come from current Products/Sales/Coupons/Shipping reads at one captured server time. After placement, the Order response uses saved snapshots and does not replace them with today's catalog prices, option keys or fee configuration. A locale change can localize stored bilingual names but does not change money. Never submit returned pricing fields back as checkout authority.

| Nested field | Exact type, presence and source | Meaning and later frontend use |
| --- | --- | --- |
| items[].values.<optionKey> | String value key for each selected variant option; values is null for a simple item. Keys/values come from the selected Product variant. | Display the selected combination using Product option-label data when available. Cart needs productId/variantId, not this object. Historical option keys may differ from the current catalog after edits. |
| items[].activeSale | Always null or object copied from the applied Sale. | Indicates a timed campaign for that line; null can still accompany a saved product discount. It is not editable checkout input. |
| items[].activeSale.id | Required lowercase 24-hex Sale ID when activeSale is non-null. | Optional staff link to GET /api/v1/admin/b2c/sales/:saleId; customers have no public Sale detail API. |
| items[].activeSale.name | Required localized string from the Sale's saved bilingual name. | Display in the same locale as this response; do not treat it as a product name or code. |
| items[].activeSale.discountType | Required percentage or fixed enum. | Explains discountValue units; not a stacking rule. |
| items[].activeSale.discountValue | Required positive integer; percentage 1–100 or fixed 1–1000000000 piastres, from the Sale definition. | Campaign definition amount, not the resulting price or this line's total reduction. |
| items[].activeSale.startsAt / endsAt | Required ISO UTC timestamps of the campaign's inclusive start and exclusive end. | Live checkout prices must be refreshed at relevant boundaries; saved Order snapshots keep the recorded campaign dates after it expires. |
| coupon.id | Required lowercase 24-hex Coupon ID when coupon is non-null. | Staff may inspect GET /api/v1/admin/b2c/coupons/:couponId. Buyers submit couponCode to Checkout or code to preview, not this ID. |
| coupon.code | Required normalized uppercase saved code. | Retain the chosen code for a fresh preview; do not infer that it is still usable from a historical Order. |
| coupon.name | Required localized string from saved Coupon name.ar/name.en. | Display metadata; not an editable code or selection ID. |
| coupon.discountType / discountValue | Required percentage/fixed enum and positive integer definition value. | Whole percentage points or fixed piastres. Actual reduction is totals.discountAmount and per-line couponDiscount, which can be smaller because of eligibility/capping. |
| shipping.id | Always lowercase 24-hex override ID or null when the default applies. | Staff may inspect/edit that override through Shipping; buyers never send a fee ID to Checkout. |
| shipping.governorateCode | Always normalized string from submitted address.governorateCode. | Identifies the selection used to resolve the fee. It remains present even when no override exists. |
| shipping.name | Localized configured override label or null for default fallback. | Display the submitted address.governorate when the fee name is null; fallback does not mean no destination. |
| shipping.fee | Always nonnegative integer piastres, from the current override/default at calculation. | The same charge is totals.shippingFee. It is excluded from coupon minimum spend and merchandise discount. |
| shipping.currency | Always EGP. | Unit for fee, matching top-level currency and totals. |
| shipping.source | Always override or default. | Explains the configuration used. It is not a payment status, delivery service or source product selector. |
| totals | Always object with subtotal, discountAmount, shippingFee and total. All four are nonnegative safe integers in piastres. | Display server totals. total = subtotal - discountAmount + shippingFee. Summing displayed decimal EGP values must not replace these server values. |

All properties of a non-null activeSale/coupon/shipping snapshot described above are returned, not optional. A null parent object has no children to read. Items contain no public image URL or image gallery, and quotedPreview is not a Cart DTO. If a screen needs current Product images, fetch Product data separately using productId and handle unavailable current products without rewriting Order history.

### Retained values mapped to the exact next request

| Value to retain | Where it comes from | Exact next request/use and lifetime |
| --- | --- | --- |
| customer and address input | Typed checkout fields, optionally prefilling Auth/Users plus a selected saved address and governorate selector. | POST /api/v1/b2c/cart/checkout with explicit customer/address, paymentMethod and optional couponCode. No addressId, item list, price or total input is accepted. Keep the form for corrections or a new quote. |
| checkoutId | Preview envelope data.checkoutId. | POST /api/v1/b2c/cart/checkout/:checkoutId/proof and placement body checkoutId. It belongs to the original Cart owner, and its returned expiresAt governs first placement/upload availability. |
| receivingAccount | Preview data.receivingAccount. | Show exactly the account presented for this quote, not a separately cached current setting. Later setting changes do not rewrite this quote or the Order's payment.receivingAccount snapshot. No transfer/verification API is called. |
| proofId | Successful raw proof-upload envelope data.id, not a public Media ID. | InstaPay placement body proofId beside the same checkoutId and owner. Preserve the exact selected proof ID if a placement response is lost; do not substitute a different proof on replay. COD must omit the property entirely. |
| orderId | Placement data.order.id; detail data.id; account/staff list data.items[].id; or an authorized tracking-link ID. | The orderId parameter in customer/staff/tracking detail and proof paths. Placement uses data.order, whereas later detail/tracking responses contain the Order directly inside data. |
| trackingToken | Placement data.trackingToken for a guest; customer-owned receipts return null. | X-Order-Token on guest tracking/detail-proof requests for this orderId. Retain privately until the original trackingExpiresAt; do not substitute a JWT, guest Cart cookie or another Order's token. Detail/list responses do not reissue it. |
| trackingExpiresAt | Placement data.trackingExpiresAt for a guest; null for an account Order. | Original 90-day tracking cutoff. Do not extend it on replay. Preserve the first non-null token if a later successful replay returns null after signing-key rotation. |
| expectedStatus | Latest staff detail/list/status response data.status for this Order. | PATCH /api/v1/admin/b2c/orders/:orderId/status with expectedStatus and the desired allowed target status. Refresh detail on a conflict rather than inventing another status. |
| receivingAccount editor value | GET /api/v1/admin/b2c/orders/settings data.receivingAccount plus an authorized staff edit. | PATCH the same settings endpoint with receivingAccount:string or null. This is separate from the buyer's quote snapshot and cannot be edited by a moderator. |
| Blob URL for proof display | A successful authorized proof GET's image/webp bytes converted with URL.createObjectURL. | Display locally and revoke when no longer needed. It is not a persistent API/provider URL, upload ID or next-request credential. |

After successful placement, GET Cart again rather than treating the consumed Cart response as authoritative state. Guest Cart-cookie continuity is required for replay of the original guest checkout; login or successful Cart merge changes ownership context and does not transfer that checkout. Account orders use account authentication, and guest email matching never attaches an Order to an account.

## Proof upload and placement

### Upload: endpoint 3

`POST /api/v1/b2c/cart/checkout/:checkoutId/proof` uses a required 24-hex checkout ObjectId path parameter and a raw JPEG, PNG, or WebP body. Upload is valid only for an unexpired checkout whose payment method is InstaPay and which has not already produced an Order. The server validates that declared MIME matches decoded image format, rejects animated images, limits decoded pixels to 20,000,000, auto-rotates, resizes within 1600×1600 without enlarging, strips metadata by re-encoding to WebP, and stores only private provider objects. Input bytes must be nonempty and at most 5 MiB. The output is private; no public URL is returned.

Success `data` is `{id,width,height,expiresAt}`. `id` is the proof ObjectId to send as `proofId`; width/height are processed pixel dimensions; `expiresAt` matches checkout expiry. The proof stays attached to its checkout owner and is single-use. Uploading the same proof is not an idempotent replacement operation. If the response is lost, do not blindly upload repeatedly; there is no proof-list or proof-recovery endpoint. The cleanup worker removes expired unattached proof objects. An upload timeout can leave an object for that worker to clean because the database records cleanup intent before provider PUT. A supported Content-Type whose bytes decode as a different image format fails with `422 INVALID_IMAGE`; an unsupported Content-Type fails with `415 IMAGE_TYPE_UNSUPPORTED`.

### Placement: endpoint 2

Body fields:

| Field | Required/type | Meaning |
|---|---|---|
| `checkoutId` | Required 24-hex ObjectId string | ID from the preview response. |
| `proofId` | Optional 24-hex ObjectId string | Required for InstaPay and must be omitted for COD. ID from successful proof upload. |

Example: `{ "checkoutId": "66f000000000000000000001", "proofId": "66f000000000000000000002" }`. For COD send only `checkoutId`. The pair `(checkoutId, proofId-or-null)` defines the idempotency digest. Same checkout and same proof replays the original Order response; changed proof choice returns `409 ORDER_REQUEST_CONFLICT`. A checkout has at most one Order. This provides deterministic retry behavior without a client-supplied idempotency header. Preserve checkoutId and proofId exactly while reconciling an uncertain result.

HTTP placement `data` is exactly `{order,trackingToken,trackingExpiresAt}`; the internal `created` flag is removed by the controller. First creation returns HTTP 201; an identical replay returns HTTP 200. `order` is the customer-safe Order DTO. For account-owned Orders both tracking fields are null. For guest Orders, `trackingToken` is an opaque 43-character base64url capability token and `trackingExpiresAt` is an ISO timestamp 90 days after placement. Store the token in an appropriately protected client location; it cannot be reconstructed from orderId and is not returned by later reads. Send it as `X-Order-Token` for guest tracking/proof reads. The server stores only its hash and does not reveal token in Order DTOs. After JWT signing-secret rotation, a replay may return `trackingToken:null` while `trackingExpiresAt` remains non-null because the original capability cannot be re-derived. Never overwrite a previously retained guest token with null on replay; the original token remains valid until its stored expiry. There is no recovery if the client lost the original token.

Placement atomically rechecks current Cart eligibility and selection identity, recalculates current pricing, consumes coupon usage if present, attaches the one proof if applicable, deducts stock, creates the Order, and consumes Cart. Missing `proofId` for InstaPay or supplying any `proofId` for COD fails `422 INVALID_ORDER`. A supplied but mismatched/unavailable proof for an InstaPay checkout fails `409 ORDER_PROOF_CONFLICT`. It does not send a bank transfer, verify proof, collect COD, or issue an actual refund. Transaction support is required. If any transactional step fails, the Order/stock/coupon/cart changes roll back together; provider file upload is outside that transaction and cleanup is durable.

## Order DTOs and snapshots

Customer detail, customer list, guest tracking, and `placement.data.order` use the customer DTO. Staff detail/list/status response use a staff DTO that adds audit and quote fields. Both DTOs localize names for the current response language. The immutable Order snapshot stores customer, address, purchased items and their price/Sale/coupon allocation, shipping, totals, payment instructions, and initial status. Later catalog, coupon, shipping, or settings edits do not rewrite the stored Order. The staff-only `quotedPreview` preserves the earlier checkout quote and allows comparison with actual placement values after current pricing was recalculated.

| Field | Customer DTO | Staff DTO | Type/meaning |
|---|---|---|---|
| `id` | yes | yes | Lowercase Order ObjectId string. |
| `orderNumber` | yes | yes | Required response key, string or null. New Orders have a server-generated 19-character reference such as `NRM-20261030-74M9Y3`; existing unnumbered Orders return null. Display this reference to customers and staff; retain `id` for API requests. |
| `status` | yes | yes | `pending`, `accepted`, `shipped`, `delivered`, `canceled`, or `returned`. |
| `customer` | yes | yes | `{name,email,phone}` snapshot; email lowercased, phone normalized. |
| `address` | yes | yes | `{governorateCode,governorate,district,building,street,floor,apartment,details}` immutable delivery snapshot. Optional text fields are present as empty strings when absent. |
| `items` | yes | yes | Purchased line snapshots as defined below. |
| `coupon` | yes | yes | Null or `{id,code,name,discountType,discountValue}` with localized name. |
| `shipping` | yes | yes | Stored shipping quote object with localized name, fee, source, currency, governorateCode, and override id where applicable. |
| `totals` | yes | yes | `{subtotal,discountAmount,shippingFee,total}` integer piastres. |
| `currency` | yes | yes | Literal `EGP`. |
| `payment` | yes | yes | Common and role-specific payment fields below. |
| `refund` | yes | yes | Null until status becomes canceled/returned; then `{amount,at}` for customer and also `actorId` for staff. Marker only, not proof a bank/cash refund happened. |
| `history` | yes | yes | Ordered array of `{status,at}` for customer; staff entries also include required nullable `actorId` and `actor`. Initial placement has both null. See the staff history contract below. |
| `createdAt`,`updatedAt` | yes | yes | ISO UTC timestamps from database. |
| `userId` | no | yes | Account ObjectId or null for guest Order. |
| `stockRestored` | no | yes | Boolean; true after cancellation/return stock restoration. |
| `quotedPreview` | no | yes | Earlier quote snapshot with exactly `items`, `coupon`, `shipping`, `totals`, `currency`, `quotedAt`, and `receivingAccount`, localized for this response. It does not include `checkoutId`, `expiresAt`, or `paymentMethod`. |

Each Order item contains `productId`, nullable `variantId`, localized `name`, `slug`, nullable `category` (historical id/name), `values` (map/object or null), `sku` (string or null), `quantity`, `price`, `discountedPrice` (null or integer), `unitPrice`, `lineTotal`, `couponDiscount`, `lineTotalAfterDiscount`, and `activeSale` (null or localized Sale object). `price`, `discountedPrice`, and `unitPrice` are per-unit piastres; line totals and discount are total piastres for that line. IDs are strings in DTOs. Values are the option-key/value-key map snapshot, not translated labels. These fields remain present even if the product is later hidden or changed. Order items do not include current stock, product images, or translated option labels; the frontend must not expect Cart/Product decoration in this historical snapshot.

The model bounds each item quantity to an integer from 1 through 10,000. Monetary snapshot values are nonnegative safe integers no greater than 1,000,001,000,000,000 piastres. Current Cart also limits a cart to 100 distinct selections, each quantity no greater than 10,000. The Order API does not accept monetary values or quantities from the frontend; these limits describe server-created snapshots. Coupon `discountValue` is a whole percentage from 1 through 100, or a fixed piastre amount from 1 through 1,000,000,000. Shipping fee values are nonnegative integer piastres, bounded by the Shipping module. Zero is valid for supported monetary fields.

`activeSale` is null or `{id,name,discountType,discountValue,startsAt,endsAt}`. `id` is a Sale ObjectId string; `name` is localized; `discountType` is `percentage` or `fixed`; percentage `discountValue` is an integer from 1 through 1,000,000,000 under the current validator; fixed `discountValue` is 1–1,000,000,000 piastres; start/end are ISO UTC timestamps. These are the Sale details attached to the purchased item, not a signal that the Order will reprice later. `coupon` is null or `{id,code,name,discountType,discountValue}`; `id` is an ObjectId string, `code` is uppercase, `name` is localized, and `discountType` is `percentage` or `fixed`. Percentage value is 1–100 whole percentage points; fixed value is 1–1,000,000,000 piastres. `shipping` is an override `{id,governorateCode,name,fee,currency,source}` or default `{id:null,governorateCode,name:null,fee,currency,source:"default"}`. For an override, source is `override`; currency is `EGP`; `name` is localized. For default shipping, `id` and `name` are null. `totals` values are nonnegative safe integer piastres, and their arithmetic is `subtotal - discountAmount + shippingFee = total`.

`payment` common fields are `method` (`cod` or `instapay`), `receivingAccount` (string or null; snapshot from checkout), `hasProof` (boolean), `verifiedAt` (ISO timestamp or null), and `cashCollectedAt` (ISO timestamp or null). Staff DTO additionally returns `proofId`, `verifiedBy`, and `cashCollectedBy`, each ObjectId or null. Customers can see whether proof exists and the verification/collection timestamps but not internal proof IDs or staff actor IDs. `hasProof` does not indicate that payment was accepted or verified.

### Lists and filters: endpoints 6 and 11

`GET /api/v1/b2c/orders` requires a B2C user and returns only that user’s orders. `GET /api/v1/admin/b2c/orders` requires staff and returns all B2C orders. Both accept optional `page` (integer 1–100000, default 1), `limit` (integer 1–100, default 20), and `status` (one of the six statuses). Unknown query keys do not add filters. Results sort newest first by `createdAt`, then descending ID. Data is `{items:[...],pagination:{page,limit,total,pages}}`. Out-of-range page returns an empty array and normal pagination metadata. Customer items use customer DTO, staff items staff DTO. There is no search, date range, sort, customer email, or pagination cursor.

## Complete synthetic response examples

All IDs and contact details below are synthetic. Money values are piastres. The preview shows one Sale-priced item, one coupon-eligible regular item, a 10% coupon allocation, and an override shipping quote. Actual values depend on live catalog and settings at the server-captured time.

### Checkout preview success (endpoint 1)

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "checkoutId": "66f000000000000000000001",
    "expiresAt": "2026-10-12T12:00:00.000Z",
    "paymentMethod": "instapay",
    "items": [
      {
        "productId": "66f000000000000000000010",
        "variantId": null,
        "name": "Canvas bag",
        "slug": "canvas-bag",
        "values": null,
        "sku": "BAG-001",
        "quantity": 2,
        "price": 25000,
        "discountedPrice": 20000,
        "unitPrice": 20000,
        "lineTotal": 40000,
        "activeSale": {
          "id": "66f000000000000000000020",
          "name": "October sale",
          "discountType": "percentage",
          "discountValue": 20,
          "startsAt": "2026-10-01T00:00:00.000Z",
          "endsAt": "2026-10-31T23:59:59.999Z"
        },
        "couponDiscount": 0,
        "lineTotalAfterDiscount": 40000
      },
      {
        "productId": "66f000000000000000000011",
        "variantId": "66f000000000000000000012",
        "name": "Cotton towel",
        "slug": "cotton-towel",
        "values": { "color": "blue" },
        "sku": null,
        "quantity": 1,
        "price": 10000,
        "discountedPrice": null,
        "unitPrice": 10000,
        "lineTotal": 10000,
        "activeSale": null,
        "couponDiscount": 1000,
        "lineTotalAfterDiscount": 9000
      }
    ],
    "coupon": {
      "id": "66f000000000000000000030",
      "code": "WELCOME10",
      "name": "Welcome offer",
      "discountType": "percentage",
      "discountValue": 10
    },
    "shipping": {
      "id": "66f000000000000000000040",
      "governorateCode": "cairo",
      "name": "Cairo",
      "fee": 6000,
      "currency": "EGP",
      "source": "override"
    },
    "totals": { "subtotal": 50000, "discountAmount": 1000, "shippingFee": 6000, "total": 55000 },
    "currency": "EGP",
    "quotedAt": "2026-10-11T12:00:00.000Z",
    "receivingAccount": "Example InstaPay account: @narmer.demo"
  },
  "requestId": "66f000000000000000000099"
}
```

`expiresAt` is exactly 24 hours after this sample's `quotedAt`. `receivingAccount` is returned at the top level of preview `data`; the stored `quotedPreview` keeps this value but omits `checkoutId`, `expiresAt`, and `paymentMethod`.

### Placement and customer Order success (endpoint 2)

The first placement returns HTTP 201 and this exact `data` shape; the shared envelope fields remain present. The guest token below is synthetic. A replay returns HTTP 200, the same Order, `created` is not included, and `trackingToken` may be null after signing-secret rotation as described above.

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "order": {
      "id": "66f000000000000000000050",
      "orderNumber": "NRM-20261011-74M9Y3",
      "status": "pending",
      "customer": { "name": "Mona Saleh", "email": "mona@example.test", "phone": "+201001234567" },
      "address": {
        "governorateCode": "cairo", "governorate": "Cairo", "district": "Nasr City",
        "building": "12", "street": "Example Street", "floor": "3", "apartment": "8", "details": "Call on arrival"
      },
      "items": [
        {
          "productId": "66f000000000000000000010", "variantId": null,
          "name": "Canvas bag", "slug": "canvas-bag", "values": null, "sku": "BAG-001", "quantity": 2,
          "price": 25000, "discountedPrice": 20000, "unitPrice": 20000, "lineTotal": 40000,
          "couponDiscount": 0, "lineTotalAfterDiscount": 40000,
          "activeSale": {
            "id": "66f000000000000000000020", "name": "October sale", "discountType": "percentage", "discountValue": 20,
            "startsAt": "2026-10-01T00:00:00.000Z", "endsAt": "2026-10-31T23:59:59.999Z"
          }
        },
        {
          "productId": "66f000000000000000000011", "variantId": "66f000000000000000000012",
          "name": "Cotton towel", "slug": "cotton-towel", "values": { "color": "blue" }, "sku": null, "quantity": 1,
          "price": 10000, "discountedPrice": null, "unitPrice": 10000, "lineTotal": 10000,
          "couponDiscount": 1000, "lineTotalAfterDiscount": 9000, "activeSale": null
        }
      ],
      "coupon": {
        "id": "66f000000000000000000030", "code": "WELCOME10", "name": "Welcome offer",
        "discountType": "percentage", "discountValue": 10
      },
      "shipping": {
        "id": "66f000000000000000000040", "governorateCode": "cairo", "name": "Cairo",
        "fee": 6000, "currency": "EGP", "source": "override"
      },
      "totals": { "subtotal": 50000, "discountAmount": 1000, "shippingFee": 6000, "total": 55000 },
      "currency": "EGP",
      "payment": {
        "method": "instapay", "receivingAccount": "Example InstaPay account: @narmer.demo", "hasProof": true,
        "verifiedAt": null, "cashCollectedAt": null
      },
      "refund": null,
      "history": [{ "status": "pending", "at": "2026-10-11T12:01:00.000Z" }],
      "createdAt": "2026-10-11T12:01:00.000Z",
      "updatedAt": "2026-10-11T12:01:00.000Z"
    },
    "trackingToken": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "trackingExpiresAt": "2027-01-09T12:01:00.000Z"
  },
  "requestId": "66f000000000000000000098"
}
```

For an account-owned Order, the same `data` has `trackingToken:null` and `trackingExpiresAt:null`; `order` has the same customer fields. The `userId`, `stockRestored`, `quotedPreview`, proof ID, and staff actor IDs are not customer fields.

### Staff-only additions

Staff detail/list/status use the common customer Order fields above and add these exact keys. `quotedPreview` contains only the checkout quote fields; its structure deliberately has no checkout metadata:

```json
{
  "userId": null,
  "stockRestored": false,
  "payment": {
    "method": "instapay",
    "receivingAccount": "Example InstaPay account: @narmer.demo",
    "hasProof": true,
    "verifiedAt": null,
    "cashCollectedAt": null,
    "proofId": "66f000000000000000000060",
    "verifiedBy": null,
    "cashCollectedBy": null
  },
  "history": [
    {
      "status": "pending",
      "at": "2026-10-11T12:01:00.000Z",
      "actorId": null,
      "actor": null
    }
  ],
  "refund": null,
  "quotedPreview": {
    "items": [
      {
        "productId": "66f000000000000000000010",
        "variantId": null,
        "name": "Canvas bag",
        "slug": "canvas-bag",
        "values": null,
        "sku": "BAG-001",
        "quantity": 2,
        "price": 25000,
        "discountedPrice": 20000,
        "unitPrice": 20000,
        "lineTotal": 40000,
        "activeSale": {
          "id": "66f000000000000000000020",
          "name": "October sale",
          "discountType": "percentage",
          "discountValue": 20,
          "startsAt": "2026-10-01T00:00:00.000Z",
          "endsAt": "2026-10-31T23:59:59.999Z"
        },
        "couponDiscount": 0,
        "lineTotalAfterDiscount": 40000
      },
      {
        "productId": "66f000000000000000000011",
        "variantId": "66f000000000000000000012",
        "name": "Cotton towel",
        "slug": "cotton-towel",
        "values": {
          "color": "blue"
        },
        "sku": null,
        "quantity": 1,
        "price": 10000,
        "discountedPrice": null,
        "unitPrice": 10000,
        "lineTotal": 10000,
        "activeSale": null,
        "couponDiscount": 1000,
        "lineTotalAfterDiscount": 9000
      }
    ],
    "coupon": {
      "id": "66f000000000000000000030",
      "code": "WELCOME10",
      "name": "Welcome offer",
      "discountType": "percentage",
      "discountValue": 10
    },
    "shipping": {
      "id": "66f000000000000000000040",
      "governorateCode": "cairo",
      "name": "Cairo",
      "fee": 6000,
      "currency": "EGP",
      "source": "override"
    },
    "totals": {
      "subtotal": 50000,
      "discountAmount": 1000,
      "shippingFee": 6000,
      "total": 55000
    },
    "currency": "EGP",
    "quotedAt": "2026-10-11T12:00:00.000Z",
    "receivingAccount": "Example InstaPay account: @narmer.demo"
  }
}
```

This is a fragment showing additions and role-specific replacements, not a standalone Order response. Actual `quotedPreview.items` and coupon match the checkout preview snapshot. Customer response history omits both `actorId` and `actor`; staff response history includes both, with null for the initial customer-created pending event. Staff `refund` adds `actorId` when present; the history snapshot does not add fields to refund/payment markers.

### COD, status, and settings request/response examples

COD placement contains no proof field:

```json
{ "checkoutId": "66f000000000000000000001" }
```

Staff status change request from pending to accepted is:

```json
{ "status": "accepted", "expectedStatus": "pending" }
```

The response `data` is the complete updated staff Order DTO, including staff-only `userId`, `stockRestored`, `quotedPreview`, payment staff IDs/timestamps, and history `actorId` and `actor`. A same-current-status request returns HTTP 200 with the same DTO and does not append history or replace a saved actor snapshot.

Get settings returns `data: { "receivingAccount": null }` when unset. To set it:

```json
{ "receivingAccount": "Example InstaPay account: @narmer.demo" }
```

The successful PATCH returns `data: { "receivingAccount": "Example InstaPay account: @narmer.demo" }`. To clear it, send explicit JSON null: `{ "receivingAccount": null }`. Settings mutation by a moderator returns 403. These examples omit envelope keys only where the response text explicitly says `data`.

### Detail and tracking: endpoints 4, 7, and 12

`GET /api/v1/b2c/orders/:orderId` requires the owning account. A valid but non-owned ID returns `404 ORDER_NOT_FOUND` to avoid disclosing existence. `GET /api/v1/admin/b2c/orders/:orderId` requires staff. Guest tracking uses public `GET /api/v1/b2c/orders/tracking/:orderId` and requires the `X-Order-Token` request header, exactly the retained token from placement. Invalid, expired, malformed, account-owned, or unknown tracking credentials all return `404 ORDER_NOT_FOUND`. Guest tracking expires 90 days after creation. There is no renew or recovery flow.

All these JSON endpoints have no request body or query fields beyond the path ID. Path `orderId` must be a 24-hex ObjectId. Do not use checkoutId or proofId in its place.

## Proof reads: endpoints 5, 8, and 13

Customer proof GET requires the owning account; staff proof GET requires one of the three staff roles; tracking proof GET requires the guest tracking token. They return the original uploaded image after normalization as raw `image/webp` bytes, with `X-Content-Type-Options: nosniff`; they do not return an envelope or public URL. If the Order has no attached proof or the proof is unavailable, the response is `404 ORDER_PROOF_NOT_FOUND`. The upload is re-encoded to a bounded WebP and stored in private Bunny storage. There is no browser-public Bunny URL and no public catalog Media route for these proofs. Treat proof content as sensitive payment data and avoid analytics/logging/caching.

Tracking endpoints both require `X-Order-Token`; account-owned Orders do not have guest tracking tokens. Proof reads are not upload retries. The server validates proof belongs to the exact Order before reading the private object.

## Staff order status and side effects: endpoint 14

`PATCH /api/v1/admin/b2c/orders/:orderId/status` requires JSON body `{ "status": ..., "expectedStatus": ... }`. Both are required members of the six-status enum. `expectedStatus` is a compare-and-set guard: send the status from the latest staff DTO. If another action changed the Order first, refresh it and decide again; do not retry with stale expectedStatus.

Allowed graph:

```text
pending -> accepted -> shipped -> delivered -> returned
    |          |
    + canceled + canceled
```

Canceled and returned are terminal. Repeating the already-current target status returns the current Order successfully, even if expectedStatus is stale; this makes a repeated same-target UI action safe. Any other stale current state returns `409 ORDER_STATUS_CONFLICT`; a forbidden transition returns `409 ORDER_STATUS_INVALID`.

On InstaPay `accepted`, the server records `payment.verifiedAt` and `verifiedBy`. This is a staff verification marker; the frontend/staff must verify the transfer outside the API before changing status. A transfer mismatch has no dedicated status, amount-adjustment, or proof-replacement operation. Keep the Order pending while the discrepancy is resolved outside this API, or cancel it if the staff decision is to stop fulfillment. On COD `delivered`, the server records `cashCollectedAt` and `cashCollectedBy`. On `canceled` or `returned`, the server restores the exact purchased stock once, marks `stockRestored:true`, and records a refund marker for the full `totals.total` with timestamp and staff actor. It does not execute or confirm an actual refund. The marker is recorded even when no transfer was received or a transferred amount differed; staff must reconcile any offline money separately. There is no stock restoration at `accepted`, `shipped`, or `delivered`. All status, history, stock, and marker writes occur in one required database transaction.

Example request from pending to accepted: `{ "status": "accepted", "expectedStatus": "pending" }`. A successful response is the updated staff Order DTO. Same-status requests do not add duplicate history events. Each successful actual transition appends one history event with actor ID and time.

## Receiving-account setting: endpoints 9 and 10

`GET /api/v1/admin/b2c/orders/settings` is available to `superAdmin` and `admin`; moderator is forbidden. It has no body/query and returns `{ "receivingAccount": string | null }`. `PATCH` requires JSON `{ "receivingAccount": string | null }`. String values are trimmed and must contain 1–200 characters. Null clears the setting; omission or any other type is invalid. Unknown fields are whitelisted away. A successful update is transactionally audited and returns the same DTO. Settings apply to new previews; existing checkout and Order payment account snapshots are not rewritten. No client version is exposed. Fetch current setting before making a deliberate edit; no external transfer-account verification is performed by this API.

## Errors and recovery

Shared response envelope, request ID, localized message, field errors, and common HTTP errors are in [API conventions](../../../../docs/frontend/api-conventions.md). Module-specific outcomes:

| HTTP/code | Meaning | Frontend action |
|---|---|---|
| 400 `INVALID_STORE` | A non-B2C store reached service | Treat as configuration fault; routes here are B2C only. |
| 401 `UNAUTHORIZED` | Required customer/staff auth invalid, or Cart cookie malformed | Refresh once where appropriate, then sign in; for a malformed guest cookie use cookie recovery, not a fake token. |
| 403 `FORBIDDEN` | Wrong role or required allowed Origin missing | Correct account/role or deployment Origin configuration. Refresh does not grant permissions. |
| 404 `ORDER_NOT_FOUND` | Unknown ID, non-owned account Order, or invalid/expired guest tracking capability | Show unavailable state; do not expose cross-account existence. |
| 404 `ORDER_PROOF_NOT_FOUND` | No attached proof or proof unavailable | Show proof unavailable; do not retry upload using this read route. |
| 409 `ORDER_CART_UNAVAILABLE` | Cart is empty or current selections are not checkoutable | Reload Cart, resolve unavailable/stock lines, create a new preview. |
| 409 `CHECKOUT_UNAVAILABLE` | Checkout expired, missing, or not owned by this Cart owner | Start a new checkout preview. |
| 409 `CHECKOUT_CART_CHANGED` | Product/variant/quantity selections differ from preview | Reload Cart and create a new preview. |
| 409 `ORDER_REQUEST_CONFLICT` | Existing checkout has different proof choice, or duplicate race | Reconcile the existing checkout/Order; preserve exact request body. |
| 409 `ORDER_PROOF_CONFLICT` | Proof is absent, expired, already attached, wrong owner/checkout, COD, or checkout already has Order | Upload once to the current InstaPay checkout if still valid; otherwise start new preview. |
| 409 `ORDER_STATUS_CONFLICT` | Status changed concurrently or stock restoration guard failed | Reload staff Order; review current status before deciding. |
| 409 `ORDER_STATUS_INVALID` | Requested transition is outside the graph | Reload and offer only permitted next actions. |
| 409 Coupon codes | Coupon unavailable/expired/limits, minimum spend, no eligible lines, or existing redemption | Show coupon-specific feedback, refresh Cart/preview, and ask user to review code; see Coupons contract. |
| 409 `ORDER_STOCK_UNAVAILABLE` | Current stock cannot fulfill placement | Reload Cart and ask the user to adjust quantity. |
| 409 `ORDER_STOCK_RESTORE_FAILED` | Exact stock cannot be restored within supported catalog limits | Escalate as staff/operations issue; do not repeat cancellation blindly. |
| 413 `BODY_TOO_LARGE` | Proof bytes exceed request limit | Reduce/resize image before upload. |
| 415 `IMAGE_TYPE_UNSUPPORTED` | Unsupported Content-Type or decoded image format mismatch | Send raw JPEG/PNG/WebP with matching media type. |
| 422 `INVALID_ORDER` | Service-level checkout or placement values invalid, including missing InstaPay proof or a supplied COD proof | Correct form/body; response may have no field-specific errors. |
| 422 `INVALID_IMAGE` | Empty/oversized/corrupt/animated/too-large-dimension image | Select a valid still image within constraints. |
| 422 `VALIDATION_ERROR` | Path, query, or structural validator failure | Map `errors[]` to request inputs. |
| 429 `TOO_MANY_REQUESTS` | General IP/account, Cart IP/account, or endpoint IP/account limit | Respect Retry-After, preserve checkout/proof IDs and exact placement input, and stop automatic loops. |
| 502 `PROOF_STORAGE_FAILED` | Private Bunny upload/read/delete provider failure | Preserve checkout and avoid blind upload replay; show temporary unavailability. A failed read may be retried later. |
| 503 `PROOF_STORAGE_UNAVAILABLE` | Private storage is not configured or saved storage scope changed | Operations issue; do not offer another payment method as if Order was placed. |
| 503 `INSTAPAY_NOT_CONFIGURED` | No receiving account configured for preview | Show InstaPay unavailable; user may choose COD if business policy/UI permits. |
| 503 `SHIPPING_NOT_CONFIGURED` | No override or default Shipping fee exists | Show temporary checkout unavailable; never assume zero shipping. |
| 503 `TRANSACTIONS_REQUIRED` / `NOT_READY` | Database transaction support/database readiness unavailable | Preserve input and show service unavailable; client retry cannot fix configuration. |

If a fetch rejects, times out, or returns an unreadable 500 after placement, the commit outcome may be uncertain. Keep the same checkoutId and proofId and repeat the exact placement request to use the deterministic idempotency behavior. Do not create another checkout until that reconciliation is resolved. Preview calls themselves create new checkout records, so avoid repeated automatic preview retries. Proof upload is not idempotent. A status patch to the already-current target is safe, but fetch latest state before choosing a different transition.

## Cleanup and operational boundaries

Checkouts expire 24 hours after creation and are removed by MongoDB TTL cleanup; no stock was held. Unattached proof rows/objects expire with their checkout and are removed by `cleanupProofs`, which claims cleanup work durably before deleting from storage. Attached proofs are excluded from expiry cleanup and remain available for the Order lifetime. When `bunnyProof` is configured, server lifecycle invokes proof cleanup hourly using the existing catalog-media cleanup timer; a shared in-process guard prevents overlapping cleanup runs. Each invocation handles at most 25 batches of up to 50 records and stops early on a short batch, failure, or no progress. Operators can also run `npm --prefix server run orders:cleanup-proofs` manually. This documents source wiring only; it does not establish that a particular deployment has Bunny configured or that its timer/CLI has run. If Bunny deletion fails, the durable `deletePending` state remains eligible for a later retry. No frontend cleanup call exists.

Order status, stock restoration, and settings mutation require MongoDB transactions. The frontend should present empty order lists as a normal empty state, detail 404 as unavailable, and loading/error states without discarding a pending checkout/proof identifier. Staff should show the six statuses, render only graph-allowed actions, and request a fresh Order before changing status. No API response confirms external bank settlement, physical return receipt, or actual refund payment.

Source traced: `orders.routes.js`, `orders.controller.js`, `orders.validator.js`, `orders.service.js`, `orders.repository.js`, `orders.model.js`, `cart.routes.js`, Coupons service, Shipping service, Products stock service, image processing and private Bunny storage, `app/modules.js`, shared API conventions. The complete preview/customer-placement examples and staff additions were checked against actual service DTO keys/types and monetary calculations. The final local suite passed 106 tests plus one intentionally skipped opt-in database test; the separate authorized MongoDB integration run passed and verified disposable collection cleanup. Live Bunny privacy/storage operation, SMTP delivery and deployed browser/TLS behavior remain unverified. No dependency, actual .env value or deployment changed in this slice.

## Customer email side effects — 2026-10-12

Read the [complete email delivery contract](../../shared/infrastructure/email/EMAIL_DELIVERY_FRONTEND.md). No endpoint, request field or returned Order/Checkout field was added. When SMTP and B2C_TRACKING_URL_TEMPLATE are configured, first successful placement queues order.placed/pending, and every actual accepted/shipped/delivered/canceled/returned transition queues order.status. Matching placement/status retries do not create another job. Pending is the placement state; no transition returns an order to pending.

Recipient is the immutable checkout customer.email. The language of first successful placement is stored internally and used for later emails, independently of staff X-Language; pre-existing records without that field use English. Queue insertion shares the order/stock/cart/coupon/status transaction; insertion failure returns the normal transaction error without a committed order/change. SMTP sends later, so SMTP failure never cancels an already committed order or repeats stock/coupon effects. Success does not mean an email has reached the inbox.

The guest link contains the same private credential in a URL fragment. The frontend reads the fragment and calls existing tracking/proof endpoints with X-Order-Token. For account orders the template token placeholder is empty; that frontend route must use customer authentication and the existing account detail endpoint. If a guest token is expired or cannot be reconstructed after signing-key rotation, the email still sends its event/reference/total but omits the link and tells the customer to use a saved unexpired link or contact staff. No link renews the original 90-day expiry.

Refund messages say staff handles refunds offline; they do not claim a bank transfer occurred. Private proof bytes, staff IDs, audit details and SMTP secrets are not included. Emails state the recorded event/status and timestamp; retries may arrive late or out of order, so the tracking page is authoritative for the current state. Customer email delivery is disabled per side while its template is blank, with no backfill of events that occurred while disabled. Staff dashboard notifications are implemented independently. Lost-link recovery, resend endpoints and web push remain separate work.

## Staff arrival feed integration (2026-10-13)

Every first successful Order placement also inserts one B2C order.placed staff event through [Notifications](../notifications/NOTIFICATIONS_FRONTEND.md). It shares the transaction with Order creation, stock deduction, coupon redemption, proof attachment, Cart clearing and any enabled customer email job. A staff-event or enabled email-job insertion failure rolls back those effects. Later SMTP failure does not. Arrival creation is independent of SMTP and tracking-link configuration.

No Checkout/Order request or response field changed. Guest and account placement both produce the event, without exposing customer/payment/proof data in the feed. Replaying placement returns the original Order and creates no new event. Acceptance, shipment, delivery, cancellation and return may create configured customer email jobs but no additional staff arrival.

B2C superAdmin/admin/moderator reads GET /api/v1/admin/b2c/notifications or /notifications/unread-count and acknowledges PATCH /notifications/:notificationId/read. The feed's notification.id is for acknowledgment; resource.id is for GET /api/v1/admin/b2c/orders/:orderId. Personal acknowledgment does not verify InstaPay or change Order status, stock, coupon counts or another staff member's read state. Staff fulfillment still uses the existing status endpoint and expectedStatus. Counts, polling, concurrency, errors and exact notification fields are fully specified in the linked handoff.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.


## Reporting and historical category follow-up — 2026-10-22

Every item in a newly calculated checkout preview, final Order, quotedPreview and recent staff Orders in [Reports](../reports/REPORTS_FRONTEND.md) includes category:null|{id,name}. id is the assigned direct-category ObjectId string and name is localized from a bilingual snapshot. The server captures it under the catalog transaction lock; the FE does not submit it. Quote and placement take independent snapshots, so a category changed between them can differ just as final prices can differ from an earlier quote. Older absent/null category fields are normalized to null in DTOs and grouped as “Unknown category” in reports. No migration or current-category reconstruction is performed. Render an appropriate localized unknown label and do not infer parent-category totals.

Product/category names and group attribution remain historical; later renaming/reparenting/deletion does not rewrite snapshots. The Reports module reuses the existing staff Order DTO for recentOrders rather than defining another response. Its aggregates distinguish all-status placed-order totals, currently delivered product sales by creation date, collection event markers and refund event markers. Only B2C superAdmin/admin may read reports; moderator Order-detail/status permissions remain unchanged. No checkout request, stock restoration, coupon use, payment verification, refund handling or cancellation transition changes.

## Order numbers for new Orders

`orderNumber` is immutable server output: `NRM-YYYYMMDD-XXXXXX`, exactly 19 characters. Date uses the captured placement time in Africa/Cairo, including daylight-saving rules. Six cryptographic base-36 characters use 0–9/A–Z with leading zeroes. It is not sequential. A unique partial string index enforces uniqueness; a number collision retries the entire transaction, at most five attempts. Exhaustion is HTTP 409 ORDER_REQUEST_CONFLICT; retain checkout/proof state and bound any exact replay. Failed transactions consume no stock, coupon, proof, Cart or notification writes.

All Order DTOs, including Reports recentOrders, return the required key: string for new Orders, null for existing unnumbered Orders. No backfill occurs on reads, replay or status changes. Exact replay retains the saved number across dates. Display the number or fallback id; API paths, tracking URLs and relationships keep id. The reference grants no authorization and has no lookup endpoint.

See the [combined FE response](../../../../docs/frontend/order-number-and-history-frontend-response.md) for examples, lifecycle, endpoint locations, recovery and rollout/rollback limits.

## Staff status-history actors

Staff history adds required nullable actor alongside actorId. A non-null actor is {name,role}: name is a required nonempty string up to 100 characters; role is required superAdmin/admin/moderator. Source is the account returned by authorization inside the status transaction; request fields cannot choose it. Later account changes/deletion do not replace the snapshot. Successful transitions append it atomically; failure appends nothing and same-status replay preserves history. New actions on older Orders capture actors; initial placement and existing uncaptured events return null without backfill.

Staff list/detail/status and Reports recentOrders expose both fields. Customer placement/replay/list/detail and guest tracking omit both. Refund/payment markers are unchanged. Rename **Staff reference** to **By**: initial pending with null actorId shows **Order placed**; saved actors show **Moderator: {{actor.name}}**, **Admin: {{actor.name}}** or **Super admin: {{actor.name}}**; uncaptured events show **Staff member unavailable**. Do not display IDs, guess actors, query current profiles per row or label other null snapshots as placement.

Existing {status,expectedStatus} requests, roles, errors, rate limits and no-store rules remain. Reload on 409 ORDER_STATUS_CONFLICT. See the [combined FE response](../../../../docs/frontend/order-number-and-history-frontend-response.md) for full field tables, synthetic actor examples, privacy, frontend display logic and acceptance checks.

## Branded order emails (2026-10-31)

Placement and each existing status email now use localized Narmer HTML/text templates with the logo and event-specific wording. Order references, private links, offline-refund qualifications and delivery retry semantics remain as documented. No frontend/API field or action changes. See [email delivery](../../shared/infrastructure/email/EMAIL_DELIVERY_FRONTEND.md).
