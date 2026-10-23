# B2C Reports frontend contract

Implemented read-only reporting for the B2C dashboard. Read this together with [Orders](../orders/ORDERS_FRONTEND.md), [shared API conventions](../../../../docs/frontend/api-conventions.md) and the [backend response to the FE handoff](../../../../docs/frontend/backend-response.md). Reports use existing Order snapshots; they do not create a payment ledger or calculate profit. All prices and amounts are integer EGP piastres. Divide by 100 only for display.

## Endpoints, access and transport

| Method and path | Purpose | Success |
| --- | --- | --- |
| `GET /api/v1/admin/b2c/reports/overview` | Placed-order metrics, trend, up to five delivered-product rankings and five recent orders. | 200 |
| `GET /api/v1/admin/b2c/reports/finance` | Order snapshot amounts, payment/refund markers and their trends. | 200 |
| `GET /api/v1/admin/b2c/reports/sales-performance` | Paginated delivered-product rankings and direct-category totals. | 200 |

Only current B2C `superAdmin` and `admin` accounts can call these routes. Moderators and customers receive 403. Missing/expired/malformed Bearer tokens or a B2B token receive 401. There is no public or B2B Reports route, and no create/update/delete/report-export operation.

Send `Authorization: Bearer <accessToken>` using the token obtained through B2C Auth; Apidog uses `{{JWT}}`. `X-Language: en|ar` selects localized names and messages; the shared default is English. Send no request body, file, guest tracking token, pagination cookie or refresh token. Refresh cookies are handled only through the existing Auth refresh flow. Responses, including route authentication/validation failures, send `Cache-Control: no-store`.

The success envelope is `{success:true,code:"OK",message:string,data:object,requestId:string}`. `message` is localized server feedback; `requestId` identifies the request for support and is not a report ID or a token. All report data keys below are present. Empty arrays are `[]`, missing catalog decoration is null, and absent numeric totals are zero. Error envelopes and validation `errors` use the shared conventions.

## Query parameters on all three routes

| Parameter | Required, type, bounds and default | Source and use |
| --- | --- | --- |
| `from` | Required scalar ISO-8601 timestamp string with seconds and explicit `Z` or `+/-HH:MM` offset; optional 1–3 millisecond digits. Inclusive. | FE date-range selection converted to an instant. Date-only strings and timestamps without an offset are rejected. |
| `to` | Required timestamp of the same form. Exclusive; must be greater than `from`. | For an inclusive calendar date picker, send the beginning of the following Cairo date, not 23:59:59.999. URL-encode positive offsets with URLSearchParams. |
| `timezone` | Optional literal `Africa/Cairo`; omission selects it. | The only supported calendar for bucket boundaries. UTC and arbitrary zones are rejected. It does not reinterpret `from`/`to` as local times. |
| `interval` | Optional `day`, `week` or `month`; default `day`. | Chart granularity. Weeks start on Monday. Accepted on performance as common report metadata even though performance returns rankings, not a trend. |

Maximum range is 366 elapsed 24-hour days, not 366 inclusive calendar dates. UTC years must be at least 2000 for `from` and at most 2100 for `to`; the positive range condition enforces the other ends. Invalid calendar dates, arrays/repeated query parameters and unsupported query keys return 422. No trimming or silent date default applies. The backend normalizes accepted instants to UTC ISO strings in metadata. Future ranges within the bounds are allowed and normally empty.

Performance alone also accepts:

| Parameter | Required/type/default | Meaning |
| --- | --- | --- |
| `page` | Optional integer 1–100000; default 1. | Page of aggregated products. Reset to 1 when range, rank or page size changes. |
| `limit` | Optional integer 1–100; default 20. | Product rows per page. Categories are not paginated or limited by this value. |
| `rankBy` | Optional `units` or `merchandiseAmount`; default `units`. | Descending quantity or historical merchandise amount. Ties use ascending product ID. Categories follow the same selected metric, with category ID as tie-breaker. |

Sending these three keys to overview/finance returns 422. There is no status filter, product search, category filter, comparison period, CSV, profit, arbitrary timezone or user-configured metric.

Example: `GET /api/v1/admin/b2c/reports/overview?from=2026-01-01T00%3A00%3A00Z&to=2026-02-01T00%3A00%3A00Z&interval=day`. These sample boundaries are UTC instants; a January Cairo calendar selection instead starts at `2025-12-31T22:00:00Z` and ends at `2026-01-31T22:00:00Z`. Cairo has daylight saving: never hard-code UTC+02:00 or add 24 hours to find the next local date. Use the frontend's timezone-capable calendar handling.

## Shared response metadata and chart buckets

Every `data.meta` contains:

| Field | Type | Meaning and frontend use |
| --- | --- | --- |
| `from`, `to` | UTC ISO timestamp strings | Effective half-open selection `[from,to)`. Retain with the result to identify which screen selection it belongs to. |
| `timezone` | `Africa/Cairo` | Local calendar used for all buckets. |
| `interval` | `day`, `week` or `month` | Effective granularity. |
| `currency` | `EGP` | Applies to every monetary field. |
| `generatedAt` | UTC ISO timestamp | Server request-generation time before aggregation. Display as “generated at,” not a permanent database snapshot identifier. |
| `definitionsVersion` | `v1` | Identifies these metric definitions. It is not an optimistic write version or request input. |
| `limitations` | Array of stable strings | Exactly the four constraints described below. Translate into suitable explanation/help text; do not treat them as errors. |

`offline-payment-refund-markers-only` means payment/refund figures reflect staff actions, not bank settlement. `current-order-status` means status-dependent results can change when the same historical period is refreshed. `legacy-category-unknown` means old items have no captured category. `direct-category-snapshots-only` means category rankings count only the category assigned at purchase, with no ancestor rollup.

Overview and finance `trend` return one entry per intersecting calendar bucket, including zero-filled entries. Each entry has `bucketStart` and `bucketEnd`, UTC ISO timestamps delimiting the full natural Cairo bucket. The first/last bucket can extend outside the query range, but its amounts/counts include only events within `[from,to)`. Adjacent boundaries match. Daily buckets can last 23 or 25 hours around daylight saving. A spring date whose midnight is skipped starts at the first valid local instant, 01:00. Use the returned boundaries and format them in Cairo; do not regenerate buckets by adding fixed milliseconds.

One endpoint uses one Order aggregation for its related figures; the three endpoints are separate reads. Catalog slug/image decoration is fetched afterward. There is no cross-request frozen snapshot or durable saved report. Discard a stale response if the user changed the selected range while it was in flight.

## Overview response

`data` contains exactly `meta`, `metrics`, `trend`, `topProducts`, `recentOrders`.

The placement cohort means orders whose immutable `createdAt` lies in `[from,to)`. Each Order is counted once; replaying a successful checkout does not create another Order. All six current statuses participate in placement metrics, including canceled and returned orders.

| `metrics` field | Type | Exact definition |
| --- | --- | --- |
| `ordersPlaced` | Integer >=0 | Count of orders in the placement cohort. |
| `unitsPlaced` | Integer >=0 | Sum of every snapshot item quantity in that cohort; includes subsequently canceled/returned orders. This is demand placed, not fulfilled units. |
| `placedOrderAmount` | Integer >=0 piastres | Sum of stored `totals.total`, after coupon and including shipping, across the cohort. Label “Placed order value,” not collected revenue. |
| `pendingOrders` | Integer >=0 | Cohort orders currently pending. It is not the all-time pending backlog. |
| `averagePlacedOrderAmount` | Integer piastres or null | Placed value divided by placed-order count, rounded to nearest piastre, halves upward. Null when no orders. |

`trend[]` adds `ordersPlaced`, `unitsPlaced`, `placedOrderAmount` to the bucket boundaries, using the same cohort and definitions. It has no pending count or average.

`topProducts` is at most five ProductPerformanceRow objects, ranked by units using the delivered-only rules below. The overview's placed-order metrics and its delivered-product rankings deliberately have different status bases.

`recentOrders` is at most five existing staff Order DTOs, selected from all statuses in the placement cohort, newest `createdAt` first then descending ID. It is not a second report-specific Order schema. Use [the complete Orders contract](../orders/ORDERS_FRONTEND.md) for bounds, history, proof access, retained IDs and update recovery. Their fields are:

| Field/group | Source, meaning and reuse |
| --- | --- |
| `id`, `status`, `createdAt`, `updatedAt`, `currency` | Order ID for staff detail navigation/status API, current six-state status, creation/update timestamps and EGP. Retain `status` as `expectedStatus` only after refreshing detail before a write. Reports have no status-write operation. |
| `customer` | Historical `name`, `email`, `phone`; personal contact information visible only to allowed staff. Do not store reports in a public cache or persist contacts unnecessarily. |
| `address` | Historical `governorateCode`, `governorate`, `district`, `building`, `street`, `floor`, `apartment`, `details`. Optional delivery text is stored as empty strings, not fabricated current address-book data. |
| `items[]` | Historical `productId`, nullable `variantId`, localized `name`, `slug`, nullable `category`, nullable `values` and `sku`, `quantity`, `price`, nullable `discountedPrice`, `unitPrice`, `lineTotal`, `couponDiscount`, `lineTotalAfterDiscount`, nullable `activeSale`. `values` maps actual option keys to value keys. Amounts are snapshots; no current stock or images appear on Order items. |
| `items[].category` | Null for uncaptured legacy items or `{id,name}` with string category ID and localized historical name. This is the assigned direct category at quote/placement, not current category membership or an ancestor path. New Orders snapshot it independently of the earlier quote. Display unknown when null. |
| `activeSale` | Null or `{id,name,discountType,discountValue,startsAt,endsAt}`: historical campaign ID/localized name, percentage/fixed rule, whole-percent or piastre value and UTC dates. It does not reprice the Order. |
| `coupon` | Null or `{id,code,name,discountType,discountValue}`: historical coupon identity and applied rule; code is uppercase, fixed value is piastres and percentage is whole percent. |
| `shipping` | `{id,governorateCode,name,fee,currency,source}` snapshot. Default uses null `id`/`name`, `source:"default"`; override has its saved ID/localized name and `source:"override"`. |
| `totals` | `{subtotal,discountAmount,shippingFee,total}` historical piastre amounts; total equals subtotal minus coupon discount plus shipping. Sale prices already enter subtotal. |
| `payment` | `method` cod/instapay; nullable historical `receivingAccount`; boolean `hasProof`; nullable `verifiedAt`, `cashCollectedAt`; staff-only nullable `proofId`, `verifiedBy`, `cashCollectedBy`. Retain `id` and load proof through the authenticated staff Orders proof API; no private storage URL is supplied. |
| `refund` | Null or `{amount,at,actorId}`: full-order refund marker amount, UTC date and staff ID. This does not prove a cash/bank refund occurred. |
| `history` | Ordered `{status,at,actorId}` entries; initial actor ID can be null. Contains actual transition timestamps, but reporting v1 ranks by order creation date. |
| `userId`, `stockRestored` | Nullable owning customer ID (null for guests) and whether cancellation/return stock restoration ran. Reading reports never changes them. |
| `quotedPreview` | Earlier quote's `items`, `coupon`, `shipping`, `totals`, `currency`, `quotedAt`, `receivingAccount`; localized for this response. Quote and final Order can differ. A legacy quote's item category is null. Do not use quote amounts instead of final `totals` for reports. |

## Finance response

`data` contains exactly `meta`, `orderAmounts`, `collectionMarkers`, `refundMarkers`, `byStatus`, `byPaymentMethod`, `trend`.

| Field | Type | Definition |
| --- | --- | --- |
| `orderAmounts.subtotal` | Integer >=0 piastres | Sum of stored Order `totals.subtotal` in the placement cohort. Includes effective Sale/base discounted prices before coupon. |
| `orderAmounts.couponDiscountAmount` | Integer >=0 piastres | Sum of stored `totals.discountAmount` in that cohort. Does not include a second deduction for Sale discounts. |
| `orderAmounts.shippingFee` | Integer >=0 piastres | Sum of cohort snapshot shipping fees. |
| `orderAmounts.total` | Integer >=0 piastres | Sum of cohort `totals.total`; equals subtotal minus couponDiscountAmount plus shippingFee. No refunds subtracted. |
| `collectionMarkers.instapayVerifiedAmount` | Integer >=0 piastres | Full stored Order totals for InstaPay orders whose `payment.verifiedAt` is in range. Staff acceptance creates this marker. Includes orders placed outside the period and orders later canceled/returned. |
| `collectionMarkers.codCollectedAmount` | Integer >=0 piastres | Full stored totals for COD orders whose `payment.cashCollectedAt` is in range. Staff delivery creates this marker. Subsequent returns do not erase it. |
| `collectionMarkers.totalRecordedAmount` | Integer >=0 piastres | Sum of the two preceding marker amounts, without subtracting refund markers. Label as recorded collection markers, not reconciled cash. |
| `refundMarkers.amount` | Integer >=0 piastres | Sum of stored `refund.amount` where `refund.at` is in range. Staff cancellation/return creates a marker even when no collection was recorded. |
| `refundMarkers.orderCount` | Integer >=0 | Number of orders with a refund marker dated in range; not number of bank transactions. |

`byStatus` always has all six entries in order `pending`, `accepted`, `shipped`, `delivered`, `canceled`, `returned`. Each is `{status,count,orderAmount}`: status at query time, placement-cohort order count and full stored total, without refund subtraction. Missing groups are zeros.

`byPaymentMethod` always has two entries, COD then InstaPay, each `{method,orderCount,orderAmount,recordedCollectionAmount}`. `orderCount` and `orderAmount` refer to orders placed in range, grouped by stored method. `recordedCollectionAmount` independently uses that method's verification/collection timestamp in range. A row can have zero placed orders and a positive collection marker. These values are not a reconciliation equation and must not share a misleading common “orders in period” caption.

Finance `trend[]` contains `bucketStart`, `bucketEnd`, `placedOrderAmount`, `instapayVerifiedAmount`, `codCollectedAmount`, `refundMarkerAmount`. Their bases are respectively `createdAt`, `payment.verifiedAt`, `payment.cashCollectedAt`, `refund.at`, each independently filtered to the range. Every money field is a nonnegative integer; empty buckets contain zeros.

Do not add a “net cash,” “settled refunds,” “profit” or “bank balance” tile by subtracting these values. The backend has no actual refund/settlement transactions, cost-of-goods, expenses or bank balances.

## Sales-performance response

`data` contains exactly `meta`, `rankingBasis`, `items`, `pagination`, `categories`.

`rankingBasis` is `{dateField:"createdAt",includedStatuses:["delivered"],rankBy:"units"|"merchandiseAmount"}`. Count only orders placed in range that are currently delivered. Pending, accepted, shipped, canceled and returned orders do not qualify. An order placed in September and delivered in October appears in September's product ranking once delivered. Returning it removes it when September is refreshed. There is no delivery-date ranking switch.

ProductPerformanceRow, used by `items[]` and overview `topProducts[]`:

| Field | Type/presence | Source, meaning and reuse |
| --- | --- | --- |
| `productId` | Required lowercase 24-hex string | Historical product identity. All variants of that product aggregate into one row. Use for staff Product navigation; handle a missing product normally. |
| `name` | Required string | Most recent qualifying Order item's historical bilingual name localized by X-Language; other language is fallback. Most recent means descending order creation timestamp then order ID. Ties inside the same Order use item order. Current catalog renames do not change it. |
| `slug` | String or null | Current catalog slug as a navigation hint, not the historical slug or category source. Null when catalog product is absent. Hidden products can retain a slug but are not guaranteed to have a public detail page. |
| `image` | Image object or null | Current first product-level image; no variant-image fallback here. Null if absent/deleted/no product-level image. Not a historical photo. |
| `quantity` | Integer >=0 | Sum purchased quantities of all qualifying product/variant lines. |
| `orderCount` | Integer >=0 | Count distinct qualifying Orders containing the product, even when multiple variants appear in the same Order. |
| `merchandiseAmount` | Integer >=0 piastres | Sum item `lineTotalAfterDiscount`, after the allocated coupon, excluding shipping. Never recalculate from current catalog prices or multiply an average price. |

Image is `{id,url,width,height}`: media ID string, public HTTPS URL for an img element, positive integer pixel width/height for layout. It contains no storage password/object key. See [shared Image conventions](../../../../docs/frontend/api-conventions.md). Do not upload/re-attach this image as part of reporting.

`pagination` is `{page,limit,total,pages}`. `total` counts distinct ranked products, not orders/variants/units; `pages=Math.ceil(total/limit)`, including zero for an empty cohort. A page beyond the last returns `items:[]` and unchanged totals/categories. Ranking and paging happen on the server after aggregation. Do not download all Order pages to calculate reports in the browser.

`categories` is the complete array of `{categoryId,name,quantity,merchandiseAmount}` under the same delivered-only placement cohort, independent of the selected product page. `categoryId` is the captured direct-category 24-hex string or null; `name` is its localized historical name or null for unknown. The name comes from the most recently placed qualifying item for that category. Quantity and amount follow the same line rules as product rankings. There is no category `orderCount`, pagination, ancestor rollup or current-category lookup.

New Order items capture category ID and both names under the checkout catalog transaction lock, alongside prices. Quote and placement each take their own snapshot. Older Order items and quotes are not backfilled from today's catalog; absent/null category groups as `{categoryId:null,name:null,...}`. The FE must show its own localized “Unknown category” label. Moving, renaming or deleting a category does not rewrite stored reports. Product/category renames can yield several historical labels over time; the latest qualifying snapshot supplies each displayed group label, not an assertion that all past labels were identical.

## Complete minimal example and request sequence

For a 24-hour UTC empty selection, the service may return two intersecting Cairo calendar buckets. For this full Cairo day it returns exactly one:

```json
{
  "success": true,
  "code": "OK",
  "message": "Done.",
  "requestId": "11111111-1111-4111-8111-111111111111",
  "data": {
    "meta": {
      "from": "2026-01-01T22:00:00.000Z",
      "to": "2026-01-02T22:00:00.000Z",
      "timezone": "Africa/Cairo",
      "interval": "day",
      "currency": "EGP",
      "generatedAt": "2026-10-22T10:00:00.000Z",
      "definitionsVersion": "v1",
      "limitations": ["offline-payment-refund-markers-only", "current-order-status", "legacy-category-unknown", "direct-category-snapshots-only"]
    },
    "metrics": {"ordersPlaced": 0, "unitsPlaced": 0, "placedOrderAmount": 0, "pendingOrders": 0, "averagePlacedOrderAmount": null},
    "trend": [{"bucketStart": "2026-01-01T22:00:00.000Z", "bucketEnd": "2026-01-02T22:00:00.000Z", "ordersPlaced": 0, "unitsPlaced": 0, "placedOrderAmount": 0}],
    "topProducts": [],
    "recentOrders": []
  }
}
```

The message is illustrative localized feedback, not a value to compare. Generated OpenAPI/Postman artifacts also contain actual populated/empty Express response examples for every route, including staff Orders, Image and category-null cases.

1. Sign into the B2C dashboard through Auth. Retain the access JWT in the normal application auth state; let the HttpOnly refresh cookie follow the existing Auth flow.
2. Hide reporting navigation from moderators/users. Select a Cairo date range, granularity and, for the performance screen, rank/page/limit. Retain that screen state in frontend state or an appropriately encoded URL; it is not a server session.
3. Fetch only the report needed for the current screen. Use explicit range instants, with normal Bearer/X-Language headers. Show loading and disable repeated refreshes while a request is running. No prefetch of every Order is required.
4. Render exact returned metrics with accurate captions and limitations. Use locale-aware EGP formatting after converting piastres. Render a dash for null average; show useful empty states for empty recent orders/rankings and zero charts for empty buckets. Null image uses a local placeholder; unknown category uses a localized text label.
5. Retain returned Order IDs for staff detail navigation and Product IDs/current slugs for supported product navigation. Refresh Order detail before a status change. Report rows are historical data, not editable Product/Order payloads.
6. After a staff status transition, refetch affected reports when revisiting/refreshing. Historical rankings can change with current status. There is no socket/push invalidation or cross-report consistency token.

## Errors, limits, retries and side effects

| HTTP / code | Cause | Frontend recovery |
| --- | --- | --- |
| 401 `UNAUTHORIZED` | Invalid/expired/missing or wrong-store access token. | Run existing Auth refresh/retry once; otherwise sign in. Do not send REFRESH as Bearer. |
| 403 `FORBIDDEN` | User/moderator role, or role changed since login. | Hide report screens, refresh identity. Do not repeatedly retry. |
| 404 `NOT_FOUND` | Wrong route, including any B2B Reports route. | Use exact B2C endpoints. |
| 422 `VALIDATION_ERROR` | Missing/bad/duplicate/unsupported query, range >366 days, invalid year, rank/page/limit. | Keep screen selection, correct it; shared validation errors may identify `field`, `location`, `code`, `message`. Cross-field/service errors may have no field entries. |
| 429 `TOO_MANY_REQUESTS` | Reports budget or shared account/IP budget exhausted. | Read exposed `Retry-After`, pause report requests and offer retry afterward. Preserve the selected range; never continuously auto-retry. |
| 503 `REPORT_BUSY` | MongoDB aggregation exceeds its 10-second execution budget. | Offer a shorter range and an explicit retry. No partial financial results are returned. |
| 503 `REPORT_TOTAL_UNAVAILABLE` | A nonnegative total/count exceeds safe exact JavaScript integers. | Offer a shorter range; do not show approximate or silently rounded totals. |
| 500 shared internal error / network failure | Unexpected storage/application issue or lost response. | Show unavailable state, preserve filters and allow bounded manual retry. Read-only repeats cannot place orders or move money. |

All three routes share one authenticated B2C account budget of 30 requests per minute, spanning report endpoints, sessions, tokens and IPs. Existing general account 120/minute and API IP 240/minute also apply; denial/invalid requests after authentication consume relevant budgets. Counters are local to the confirmed single Node process, not distributed DDoS protection. Database aggregations are time-limited to 10 seconds; these are bounded operations, not a production load benchmark.

Reports create no database records, stock changes, coupon use, notifications, payment events or refund markers. No write version/idempotency key is required. The category snapshot addition only affects newly calculated checkout previews/placements; existing orders and their price/payment/history data are preserved. There is no data migration or guessed backfill.

## Verification boundaries

Focused unit, actual Express HTTP and isolated real-MongoDB tests cover the implemented definitions, permissions, strict queries, empty periods, integer rounding/overflow, Cairo DST/week/month buckets, separate marker dates, distinct product-order counts, pagination, legacy categories, status changes and unchanged stored Orders. Test evidence and final package/API synchronization results are recorded in the main handoff audit. Live bank/refund confirmation, frontend charts/browser integration and production load are not established by these tests.
