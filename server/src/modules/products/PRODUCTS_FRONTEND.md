# Products frontend contract (B2C)

B2B Leads integration (2026-10-12): Wholesale offers may reuse visible B2C products/composed variants. Leads captures selected offer/product/composition snapshots and protects the historical offer from permanent deletion. Saved offers continue to protect referenced B2C products/variants, including disabled offers. Staff may still deactivate sources; historical snapshots remain readable. B2B inquiries do not reserve/deduct stock or use B2C prices, Sales, Coupons, Cart or Orders, and B2B-only products remain outside this module. See [Wholesale](../wholesale/WHOLESALE_FRONTEND.md) and [Leads](../leads/LEADS_FRONTEND.md).

This document describes the Products HTTP contract checked against source on 2026-10-13. The shared success/error envelope, request IDs, localization headers, and common error handling are described in [API conventions](../../../../docs/frontend/api-conventions.md). The product and nested DTOs below are module-specific and explicit. Related flows: [B2C flow](../../../../docs/frontend/b2c-flow.md), [Categories](../categories/CATEGORIES_FRONTEND.md), [Cart](../cart/CART_FRONTEND.md), and [Media](../media/MEDIA_FRONTEND.md).

Products is B2C-only. Public routes are below `/api/v1/b2c/products`; dashboard routes are below `/api/v1/admin/b2c/products`. This module does not expose B2B products. The API creates product records, not a Sales, Coupon, Wishlist, or Order resource; those integrations use their own implemented contracts.

## Product behavior and money

Products have an immutable `type`: `simple` or `variant`. Simple products have a single price, optional SKU, and stock quantity. Variant products have option definitions and one or more sellable variants; price, optional SKU, stock, discount, and image gallery belong to each variant. The database stores null product-level price, stock, discount, and SKU on variant products, but those product-level fields are omitted from variant DTOs. Product prices are integer piastres in EGP (`25000` means EGP 250.00); all accepted prices and stock values are safe integers from `0` through `1000000000`. A saved `discountedPrice` submitted in product writes may be `0` or `null`; when non-null it must be less than its corresponding base `price`. Public campaign results may equal the base price for a zero-priced item or a percentage reduction rounding to zero. `effectivePrice` is the discount when present, otherwise base price. Public prices include active timed Sales; no tax, coupon or order total is calculated here. Dashboard prices are saved baseline values.

An optional SKU is trimmed and uppercased. Empty string clears it to `null`; omitted SKU on a patch preserves the existing value. Supplied SKUs must match `^[A-Z0-9][A-Z0-9._/-]{0,99}$`. The unique namespace is shared by every non-null simple-product SKU and every non-null variant SKU in B2C, including across product types. Slugs are required at creation, trimmed, lower-case hyphen-separated ASCII letters/digits, and unique within B2C.

Creation defaults in storage are `isActive: true`, empty `description.ar` and `description.en`, `sku: null`, `discountedPrice: null`, `stock: 0`, empty `images`, and `version: 0`. Variant products also store null product-level `sku`, `price`, `discountedPrice`, and `stock`; the Products DTO omits those fields for variant products. Creation still requires a base price for a simple product and a price for every variant. Option and value bilingual names are required in both languages.

Every product refers to one category by `categoryId`. Create/update checks that the ID exists in the B2C category catalog, including inactive categories. An inactive category or inactive ancestor makes its products invisible publicly. Public listing includes only active products in visible categories. Dashboard listing can include inactive products and categories. Category references prevent category deletion while any product is assigned there; see [Categories](../categories/CATEGORIES_FRONTEND.md).


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

Do not copy public campaign discountedPrice into a dashboard price editor. Refetch Product/Cart data after campaign or catalog edits and before later checkout. Refetching replaces retained display metadata; it never locks a price. Coupons preview is implemented through [Coupons](../coupons/COUPONS_FRONTEND.md); it does not change public Product prices. Orders snapshots current product/variant prices at placement; read its separate contract.

## Endpoints

| Method and path | Access | Success |
|---|---|---|
| `GET /api/v1/b2c/products` | Public | `200`, `{ items, pagination }` |
| `GET /api/v1/b2c/products/facets` | Public | `200`, filter choices, counts, effective-price range and normalized applied filters; exact contract below |
| `GET /api/v1/b2c/products/:productId` | Public | `200`, product DTO |
| `GET /api/v1/admin/b2c/products` | `superAdmin` or `admin` bearer token | `200`, `{ items, pagination }` |
| `GET /api/v1/admin/b2c/products/:productId` | `superAdmin` or `admin` bearer token | `200`, dashboard product DTO |
| `POST /api/v1/admin/b2c/products` | `superAdmin` or `admin` bearer token | `201`, dashboard product DTO |
| `PATCH /api/v1/admin/b2c/products/:productId` | `superAdmin` or `admin` bearer token | `200`, updated dashboard product DTO |
| `DELETE /api/v1/admin/b2c/products/:productId` | `superAdmin` bearer token only | `200`, `data: null` |

Dashboard reads and writes require `Authorization: Bearer <accessToken>`. Missing/invalid authentication is `401 UNAUTHORIZED`; an authenticated role outside the route allowlist gets `403 FORBIDDEN`. The B2C store is set by the route prefix. Requests to B2B product routes do not exist (`404`). JSON mutations use `Content-Type: application/json`. Use `X-Language: en` or `X-Language: ar` to select the public localized DTO; `Accept-Language` is the fallback language negotiation header. Dashboard DTOs are bilingual and do not localize. See the shared conventions for exact envelopes and headers.

### List query

Both list endpoints accept:

| Query key | Type and constraints | Default / effect |
|---|---|---|
| `page` | Integer, 1–100000 | `1` |
| `limit` | Integer, 1–100 | `20` |
| `categoryId` | 24-hex Mongo ID | Limits to that category and descendants, through the maximum three-level category depth. Public requests for a missing or non-visible category return `404 CATEGORY_NOT_FOUND`. |
| `type` | `simple` or `variant` | No type filter |
| `isActive` | String `true` or `false`, converted to boolean | Dashboard filter only. The public validator accepts this key, but public behavior always filters to active products. |

Page and limit are returned as integers. Default ordering is newest first, with ID descending as a stable tie-breaker. The public list additionally supports the filters and price sorting below; dashboard list behavior is unchanged. `pagination.total` is the total matching record count and `pages` is `ceil(total / limit)` (zero for no results).

### Product ID

`:productId` must be a 24-hex Mongo ID; malformed IDs return `422 VALIDATION_ERROR` with an `INVALID_FIELD` field error. A well-formed but absent product returns `404 PRODUCT_NOT_FOUND`. Public detail also returns that 404 for an inactive product or product in a category with an inactive ancestor, so it does not reveal hidden product existence.

## Product DTOs

The fields in this section are the `data` values inside the shared envelope. Server-generated image entries always have exactly these exposed fields: `id` (24-hex string), `url` (public catalog CDN URL), `width` and `height` (integer pixels, each 1–1600). URLs and image metadata are server-owned; clients cannot write image URLs directly.

### Public localized DTO

The localized product name and description are strings. The selected language falls back to the other language when that product’s selected description is empty. `version` is omitted from public DTOs.

Simple product keys:

| Key | Type / meaning |
|---|---|
| `id` | Product ID string |
| `type` | Literal `simple` |
| `categoryId` | Category ID string |
| `name`, `description` | Localized strings |
| `slug` | Product slug |
| `isActive` | Boolean; public results are always `true` |
| `images` | Ordered product gallery, image objects above; empty array if none |
| `currency` | Literal `EGP` |
| `sku` | Uppercase SKU string or `null` |
| `price` | Integer piastres |
| `discountedPrice` | Integer piastres or `null` |
| `effectivePrice` | Integer piastres, computed from current discount or base price |
| `activeSale` | Null or the complete campaign metadata object described above; public simple products only |
| `stock` | Non-negative integer stock quantity |

Variant product has the common keys `id`, `type` (`variant`), `categoryId`, localized `name` and `description`, `slug`, `isActive`, `images`, and `currency`, plus:

| Key | Type / meaning |
|---|---|
| `options` | Array in configured order. Each entry is `{ key, name, values }`; `name` is the localized option label string and `values` contains the choices described below. |
| `options[].values` | Ordered array of `{ key, name }`; `name` is the localized choice label string. |
| `variants` | Ordered array of sellable variant DTOs below |
| `priceFrom` | Lowest `effectivePrice` among all current variants, in piastres. It is computed as `min(discountedPrice ?? price)` from the current public campaign-priced variant list, so a zero discount makes `priceFrom` zero. It is a display hint; use a selected variant's price for its cart line. |

Each public `variants[]` object has `id` (stable variant ID string), `sku` (string or `null`), `price`, `discountedPrice` (integer or `null`), `effectivePrice`, `activeSale` (null or metadata below), `stock`, `values` (object from option key to value key), and `images` (ordered image array). If a variant has no own images, its public `images` is the product gallery. Dashboard data does not apply this fallback, so the admin can see and manage each independent gallery. Product-level fields `sku`, `price`, `discountedPrice`, and `stock` are absent on variant products.

### Dashboard DTO

Dashboard `name` and `description` are bilingual objects `{ "ar": string, "en": string }`; option and choice names use the same object. All other common and type-specific keys are as above, except `activeSale` is omitted from simple products and variants, campaign pricing is not applied, and `version` is included as a non-negative integer on both product types. Dashboard variants expose their own `images` array without public fallback. Product images are still returned as `images: []` when empty. A simple product has no `options`, `variants`, or `priceFrom` keys. A variant product omits product-level `sku`, `price`, `discountedPrice`, `effectivePrice`, and `stock`; those sellable fields appear on each variant instead.

The following table gives each returned top-level field's source and what the client should retain. Public name/description and option/choice labels are localized strings; dashboard values remain bilingual objects.

| Response field | Source and exact shape | Frontend handling |
|---|---|---|
| `id` | Server-generated product Mongo ID, serialized as lowercase 24-hex string | Keep as the product path ID. Never submit it as a create field. |
| `type` | Stored immutable `simple` or `variant` | Keep; this determines which fields and editors apply. |
| `categoryId` | Stored category reference, lowercase ID | Keep for future edits; category labels/details come from Categories APIs. |
| `name.ar`, `name.en` | Stored bilingual names; public route returns the selected localized string | Keep both translations in dashboard forms. For public UI, display the localized string. |
| `description.ar`, `description.en` | Stored bilingual descriptions; public route selects language and falls back to the other language when empty | Keep both dashboard translations; public UI displays only the returned string. |
| `slug` | Stored unique product slug | Keep if editing or linking the product; submit changed slug explicitly. |
| `isActive` | Stored visibility flag | Keep in dashboard; public data only contains active products whose category ancestry is visible. |
| `images` | Stored ordered product gallery of `{id,url,width,height}` server-owned image references | Keep IDs and order; submit `imageIds`, never the image DTO or URL. |
| `currency` | Server constant `EGP` | Display as returned; do not infer or send a different currency. |
| `version` | Stored optimistic-concurrency integer; dashboard only | Keep the latest value and send it on every PATCH. It is omitted publicly. |
| `sku` | Present on simple products as stored normalized SKU or `null`; omitted at product level for variant products | Keep dashboard value; only write on simple products or individual variants. |
| `price` | Present on simple products as stored integer piastres; omitted at product level for variant products | Keep dashboard value; for public simple product use with `effectivePrice` as needed. |
| `discountedPrice` | Present on simple products as saved dashboard discount or calculated public campaign result, integer piastres or `null`; omitted at product level for variant products | Keep null distinctly from zero; null means no discount, zero means free. |
| `effectivePrice` | Derived for a simple product or each variant as `discountedPrice ?? price`; omitted at variant product level | Treat as read-only current display value. |
| `stock` | Present on simple products as stored integer quantity; omitted at product level for variant products | Keep dashboard value; update through the matching sellable item. |
| `options[]` | Stored ordered option definitions; each is `{ key, name, values }` with bilingual dashboard or localized public name | Keep stable keys and order; display returned names. |
| `options[].values[]` | Stored ordered choice definitions `{key,name}` | Keep machine keys for selections; names are display labels. |
| `variants[]` | Stored ordered sellable variant records | Keep the array order and each `id` when editing. Submitting the array replaces the stored list. |
| `variants[].id` | Server-generated stable variant ID | Keep and send as `id` to retain that variant on PATCH. Do not show as a shopper-facing option label. |
| `variants[].values` | Stored selection mapping, e.g. `{ "size": "small" }` | Keep these option/value keys when editing; render the matching option names and selected value names from `options`. |
| `variants[].images` | Stored variant gallery; public response falls back to product gallery only when the variant gallery is empty | Dashboard manages this independent array; public UI can display it directly. |
| `priceFrom` | Derived lowest effective variant price, in piastres | Display as a starting-price hint; recalculate only by refetching after edits. |

For public option and variant rendering, keys are machine identifiers and the names are display text. Persisting labels instead of keys will break selection matching when translations change.

Nested response field shapes and sources:

| Response field | Dashboard source/shape | Public source/shape | Frontend retention |
|---|---|---|---|
| `options[].key` | Stored option key string | Same key string | Keep as machine identifier; use it as the property name in `variants[].values`. |
| `options[].name.ar`, `options[].name.en` | Stored bilingual label strings | Replaced by localized `options[].name` string | Keep translations in dashboard; display the route-localized string publicly. |
| `options[].values[].key` | Stored option choice key string | Same key string | Keep as machine selection value; do not display in place of a label. |
| `options[].values[].name.ar`, `options[].values[].name.en` | Stored bilingual choice labels | Replaced by localized `options[].values[].name` string | Keep translations in dashboard; display localized label publicly. |
| `variants[].id` | Stored embedded variant ID, returned lowercase | Same ID | Keep for PATCH identity; shoppers should select using `values`, not this ID. |
| `variants[].values` | Stored key-to-key map | Same map | Resolve the selected variant and labels through `options`; Cart receives product/variant IDs, not this map. Keep it for dashboard variant edits. |
| `variants[].values.<optionKey>` | Stored selected choice key string for the matching option | Same selected choice key string | Keep as a machine choice; pair its key with `options[].values[].key` and display that choice's localized name. |
| `variants[].sku` | Stored normalized SKU or `null` | Same | Keep in dashboard; optional display for product shoppers. |
| `variants[].price` | Stored integer piastres | Same | Keep as base price; public display should normally use `effectivePrice`. |
| `variants[].discountedPrice` | Stored integer piastres or `null` | Campaign result while active, otherwise stored discount | Retain `null` distinctly from zero. |
| `variants[].effectivePrice` | Derived from stored price/discount | Derived from current campaign result or saved price/discount | Read-only calculated sell price. |
| `variants[].stock` | Stored integer quantity | Same | Keep current available quantity; it can change after another sale. |
| `variants[].images` | Stored gallery, possibly `[]` | Stored gallery, or product `images` fallback when empty | Dashboard owns each independent gallery; public clients consume returned gallery for display. |
| `priceFrom` | Minimum computed effective price across stored variants | Same | Display hint only; it does not identify the variant chosen for cart/checkout. |

List data is `{ "items": [product DTO, ...], "pagination": { "page": integer, "limit": integer, "total": integer, "pages": integer } }`; each DTO follows the public or dashboard shape for its route.

Representative public simple product:

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
  "activeSale": null,
  "stock": 12,
  "sizeChart": null
}
```

Representative dashboard variant product (omitted `…` fields are shown nowhere in the actual object; this sample contains the complete shape):

```json
{
  "id": "66f000000000000000000002",
  "type": "variant",
  "categoryId": "66f000000000000000000010",
  "name": {
    "ar": "قميص",
    "en": "Shirt"
  },
  "description": {
    "ar": "",
    "en": ""
  },
  "slug": "variant-shirt",
  "isActive": true,
  "images": [],
  "currency": "EGP",
  "version": 0,
  "options": [
    {
      "key": "size",
      "name": {
        "ar": "المقاس",
        "en": "Size"
      },
      "values": [
        {
          "key": "small",
          "name": {
            "ar": "صغير",
            "en": "Small"
          }
        }
      ]
    }
  ],
  "variants": [
    {
      "id": "66f000000000000000000003",
      "sku": "SMALL-01",
      "price": 25000,
      "discountedPrice": 0,
      "effectivePrice": 0,
      "stock": 4,
      "values": {
        "size": "small"
      },
      "images": []
    }
  ],
  "priceFrom": 0,
  "sizeChartId": null
}
```

Complete public variant example during the 20% campaign (the saved zero discount is replaced while active):

```json
{
  "id": "66f000000000000000000002",
  "type": "variant",
  "categoryId": "66f000000000000000000010",
  "name": "Shirt",
  "description": "",
  "slug": "variant-shirt",
  "isActive": true,
  "images": [],
  "currency": "EGP",
  "options": [
    {
      "key": "size",
      "name": "Size",
      "values": [
        {
          "key": "small",
          "name": "Small"
        }
      ]
    }
  ],
  "variants": [
    {
      "id": "66f000000000000000000003",
      "sku": "SMALL-01",
      "price": 25000,
      "discountedPrice": 20000,
      "effectivePrice": 20000,
      "stock": 4,
      "values": {
        "size": "small"
      },
      "images": [],
      "activeSale": {
        "id": "66f000000000000000000050",
        "name": "Summer sale",
        "discountType": "percentage",
        "discountValue": 20,
        "startsAt": "2026-10-11T12:00:00.000Z",
        "endsAt": "2026-10-12T12:00:00.000Z"
      }
    }
  ],
  "priceFrom": 20000,
  "sizeChart": null
}
```

## Create and update requests

### Create a simple product

`POST /api/v1/admin/b2c/products` requires `type`, `categoryId`, `slug`, and both `name.ar` and `name.en`, plus `price` for a simple item. The canonical example below includes all supported fields; optional fields can be omitted.

For creation, product text, slug, type, SKU, price, discount, stock, and publication state come from the current staff form. Select `categoryId` from `id` in the Categories dashboard list/tree; never derive it from a slug or name. For PATCH, initialize from the latest dashboard Product DTO and preserve omitted values. The handoffs below identify fields that must come from another response or later request:

| Value | Source | Exact next request use |
|---|---|---|
| Product `id` | `data.id` from Products POST, dashboard GET, or PATCH | Canonical ID for `GET/PATCH/DELETE /api/v1/admin/b2c/products/:productId`, Media `POST /api/v1/admin/b2c/media/product/:targetId`, and Cart `PUT /api/v1/b2c/cart/items` body `productId`. Slug and SKU are not substitutes. |
| Dashboard `version` | Latest `data.version` from Products POST/GET/PATCH | Required as body `version` on every `PATCH /api/v1/admin/b2c/products/:productId`. On `409 PRODUCT_CONFLICT`, refetch dashboard detail and reconcile before retrying; never replay with the stale version. |
| `categoryId` | Selected Categories DTO `id` (dashboard list/tree includes inactive categories) | Product create/PATCH JSON body `categoryId`. Category slug is display/navigation data and cannot be sent instead. |
| `options[].key` and `options[].values[].key` | On edit, preserve keys from the current dashboard Product DTO; on create, use stable machine keys in the product editor state | Use option keys as keys in each `variants[].values` JSON map and choice keys as their values. When editing, submit the full option definitions if changing them and update every submitted variant map to match. These are selection keys, not labels. |
| `variants[].id` | Current dashboard Product DTO for a retained variant; server-generated IDs in the create response for later edits | Send as `variants[].id` in a replacement PATCH to preserve that variant. For shopping, send the selected current ID as Cart body `variantId` with the parent `productId`; resolve the selected row by matching `variants[].values` to the shopper's option selections. |
| `images[].id` / Media response `id` | Current dashboard Product DTO, or `data.id` from Media upload bound to this product | Send ordered IDs as product or `variants[].imageIds` in a versioned Product PATCH. Use only IDs from this exact product target; render `url`, never submit it. |
| Public `effectivePrice`, `discountedPrice`, `activeSale`, and `priceFrom` | Current localized public Product DTO | Display current catalog pricing only. Do not send these values as authority; Cart `PUT /api/v1/b2c/cart/items` accepts product/variant IDs and quantity, then returns current server pricing. |

Returned `slug` and SKU remain display/search metadata; all Products detail and mutation paths require the canonical `id`. A public product `id` can also be used as Cart `productId`, while a variant choice must use its `variants[].id` as Cart `variantId`.

```json
{
  "type": "simple",
  "categoryId": "66f000000000000000000010",
  "slug": "cotton-shirt",
  "name": { "ar": "قميص قطني", "en": "Cotton shirt" },
  "description": { "ar": "", "en": "Soft cotton" },
  "isActive": true,
  "sku": " shirt-01 ",
  "price": 25000,
  "discountedPrice": null,
  "stock": 12
}
```

`sku` is normalized to `SHIRT-01`. Create returns `201` and a dashboard DTO with `version: 0` and an empty `images` array. Images cannot be uploaded before this request because the server creates the product ID and Media requires an existing target. To add a gallery, follow this sequence:

1. POST the product without `imageIds`; retain the returned `id` and `version`.
2. POST each raw file to `/api/v1/admin/b2c/media/product/{returned-id}` and retain each returned image `id` in the desired order.
3. PATCH `/api/v1/admin/b2c/products/{returned-id}` with the returned version and the complete desired `imageIds` array.

For example, if creation returned product ID `66f000000000000000000001` at version `0` and the upload returned ID `66f000000000000000000020`, attach it with:

```json
{ "version": 0, "imageIds": ["66f000000000000000000020"] }
```

The patch response contains `version: 1` and the resolved image DTO in `images`. For variant products, create without image IDs, upload against the created product ID, then patch with the complete retained variant list and each variant's gallery IDs.

### Create a variant product

Variant product creation requires one or more `options` and one or more `variants`. It rejects top-level `sku`, `price`, `discountedPrice`, and `stock` even though these fields are accepted by the general shape validator; send those only on each variant. There can be at most 5 options, at most 50 values per option, and at most 100 variants. Option and value keys are stable machine keys and must be unique within their respective list. Option keys match `^[a-z][a-z0-9_-]{0,39}$`; value keys match `^[a-z0-9][a-z0-9_-]{0,39}$`. The reserved keys `constructor`, `prototype`, and `__proto__` are rejected. Every variant must choose exactly one configured value for every option, and no two variants may have the same combination.

#### Option request fields

| Request field | Requiredness, type, constraints, and meaning | Omission, null, and retention |
|---|---|---|
| `options` | Required for a variant product by business validation; array of 1–5 definitions. | On patch, omission preserves all current definitions. `[]` is invalid for variant products; for simple products only an empty list is allowed. `null` is invalid. If supplied, it replaces the definitions. |
| `options[].key` | Required string, 1–40 characters, lowercase key pattern above; stable identifier used by variant `values`. Must be unique among options. | No default; no `null`; no trim or case conversion. Keep it stable when changing labels. |
| `options[].name` | Required object when an option is supplied. | No default or `null`. Supply both translations even when patching other option properties. |
| `options[].name.ar` | Required trimmed string, 1–200 characters, Arabic label. | Cannot be omitted or `null` for a supplied option. |
| `options[].name.en` | Required trimmed string, 1–200 characters, English label. | Cannot be omitted or `null` for a supplied option. |
| `options[].values` | Required array of 1–50 choices for each option. | No default or `null`; a supplied option must contain at least one choice. |
| `options[].values[].key` | Required lowercase 1–40 character value identifier matching the value-key pattern above; unique within this option. | No default or `null`; keep this key stable because variants reference it. |
| `options[].values[].name` | Required bilingual object for each choice. | No default or `null`; both translations required. |
| `options[].values[].name.ar` | Required trimmed string, 1–200 characters; Arabic display label. | Cannot be omitted or `null` for a supplied choice. |
| `options[].values[].name.en` | Required trimmed string, 1–200 characters; English display label. | Cannot be omitted or `null` for a supplied choice. |

Changing option/value keys requires updating every submitted variant's `values` map to match. Labels can change without changing keys. The endpoint does not preserve omitted translations inside a supplied option definition; send both names. If `options` itself is omitted on patch, the prior definitions remain.

#### Variant request fields

| Request field | Requiredness, type, constraints, and meaning | Omission, null, and retention |
|---|---|---|
| `variants` | Required for a variant product by business validation; 1–100 variant records. | Omitted on patch: keep all prior variants. Supplied array: replace the complete list; entries not represented are removed. `[]` and `null` are invalid. |
| `variants[].id` | Optional existing 24-hex variant ID, used to identify the stored record to retain. | Omitted: server generates a new ID; old fields/images are not matched. `null` is invalid. Supplied ID must belong to this product, and IDs cannot repeat. |
| `variants[].values` | Required plain JSON object mapping every option key to one configured value key. Exactly one value per option; no extra keys or duplicate combinations across variants. | No default or `null`. On patch send the complete selection. Retained IDs keep identity, but their option selection can change if it is valid and unique. |
| `variants[].values.<optionKey>` | Required string for every current option; value must be one of that option's configured value keys. | Omission, `null`, an unknown key/value, or a partial/extra selection is invalid. These are machine keys, not localized labels. |
| `variants[].sku` | Optional string or `null`; trimmed, uppercased, then validated against the SKU pattern. | On a retained variant, omission preserves its SKU. On a new variant it defaults to `null`. `null` or blank string clears it. |
| `variants[].price` | Required safe integer 0–1000000000, in EGP piastres. | Must be supplied for every variant sent, including retained variants; `null` is invalid. |
| `variants[].discountedPrice` | Optional safe integer 0–1000000000 below `price`, or `null`. Zero is valid. | On a retained variant, omission preserves it; on a new variant default is `null`; `null` clears the discount. |
| `variants[].stock` | Optional safe integer 0–1000000000 units. | On a retained variant, omission preserves it; on a new variant default is `0`. `null` is invalid. |
| `variants[].imageIds` | Optional array of up to 10 distinct 24-hex upload IDs for this product target, in display order. | On a retained variant, omission preserves its gallery; on a new variant it defaults to empty. `[]` clears; `null` is invalid. |

Each variant's `id` is identity; `values` is the machine selection; `options` supplies human-readable labels. Do not use the ID or value key as display text, and do not omit retained variant entries from a replacement list.

```json
{
  "type": "variant",
  "categoryId": "66f000000000000000000010",
  "slug": "cotton-shirt",
  "name": { "ar": "قميص قطني", "en": "Cotton shirt" },
  "description": { "ar": "", "en": "Soft cotton" },
  "options": [{
    "key": "size",
    "name": { "ar": "المقاس", "en": "Size" },
    "values": [
      { "key": "small", "name": { "ar": "صغير", "en": "Small" } },
      { "key": "medium", "name": { "ar": "متوسط", "en": "Medium" } }
    ]
  }],
  "variants": [
    { "values": { "size": "small" }, "sku": "shirt-s", "price": 25000, "discountedPrice": 20000, "stock": 4 },
    { "values": { "size": "medium" }, "sku": null, "price": 25000, "discountedPrice": null, "stock": 7 }
  ]
}
```

The server generates each variant `id` during creation. `values` is a plain JSON object mapping every option key to a configured value key. Variants are explicit sellable records; the server does not generate a Cartesian product from option values. To add variant images, upload against the returned product ID, then PATCH using the returned `version` and the full variant array, retaining each returned variant `id` and supplying `imageIds` for the galleries being changed.

### Patch a product

`PATCH /api/v1/admin/b2c/products/:productId` is a partial product update but requires `version` on every request. Send the current dashboard DTO version. A successful patch increments it by one. A stale version or simultaneous write returns `409 PRODUCT_CONFLICT`; a missing product returns `404 PRODUCT_NOT_FOUND`. Refetch the product and reconcile before retrying a conflict. Empty updates containing only `version` return `422 INVALID_PRODUCT`.

For localized fields, each language may be sent independently; an omitted language is retained. If a provided `name` object omits one language, the previous translation is retained. Description can be empty. Names are required on creation in both languages. Text is trimmed. Names max at 200 characters per language; descriptions max at 10000.

Patch validation and update semantics:

| Field | Required/optional and accepted form | Omission / null behavior |
|---|---|---|
| `version` | Required integer 0–1000000000 | Required for every patch; no default. |
| `type` | Optional `simple` or `variant` | Omit to preserve. Changing it returns `409 PRODUCT_TYPE_IMMUTABLE`. |
| `categoryId` | Optional 24-hex ID | Omit to preserve. `null` is invalid. Missing category returns `409 CATEGORY_PARENT_NOT_FOUND`. |
| `slug` | Optional trimmed slug, max 150; `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Omit to preserve. `null` invalid. Duplicate returns `409 PRODUCT_SLUG_EXISTS`. |
| `isActive` | Optional JSON boolean | Omit to preserve; `null` invalid. |
| `name.ar`, `name.en` | Optional strings, trimmed, 1–200 chars | Omitted language is preserved. `null` invalid. |
| `description.ar`, `description.en` | Optional strings, trimmed, 0–10000 chars | Omitted language is preserved. Empty string clears that translation. |
| `imageIds` | Optional array of up to 10 24-hex IDs, no duplicates | Omit to preserve product gallery; `[]` clears it; `null` invalid. |
| `sku` | Optional string or `null`, normalized as above | Omit preserves; `null` or blank string clears. SKU conflicts return `409 PRODUCT_SKU_EXISTS`. |
| `price`, `stock` | Optional integer 0–1000000000 | For simple products, omission preserves; cannot be `null`. Variant products reject these at top level. |
| `discountedPrice` | Optional integer 0–1000000000 or `null` | Omit preserves; `null` clears. Must be less than base price. |
| `options` | Optional full array, 1–5 entries with the creation shape | Omit preserves current definitions; `[]` is invalid for variant products and any non-empty options are invalid for simple products. |
| `variants` | Optional full replacement array, 1–100 entries | Omit preserves current variants. When present, it replaces the list and any old variant not represented is removed (subject to reference checks). |

Every supplied variant needs `values` and `price`; `stock`, `sku`, `discountedPrice`, and `imageIds` are optional. `id` is optional on each variant. To retain and edit an existing variant, send its existing `id`; then omitted `sku`, `stock`, and `discountedPrice` preserve the values attached to that ID, while `price` must still be sent. If `id` is omitted, the server creates a new variant ID, treats it as a new variant, and does not carry its old SKU, stock, discount, or gallery. Therefore a replacement array that omits an old variant ID removes that old variant; if it has live Cart or historical Order references, removal returns `409 PRODUCT_REFERENCED`. An ID not belonging to this product is invalid. Retained IDs must be unique in the request.

For an existing variant, `imageIds` omission preserves its gallery; `[]` clears it. Variant `imageIds` are separate from product `imageIds` and from other variants. All IDs must be upload IDs owned by the same product target. On public reads only, an empty variant gallery falls back to the product gallery.

Prices and stock on each variant follow the simple product integer bounds. `discountedPrice: 0` is a valid free price. A positive discount must be strictly below that variant’s base price. Any repeated option combination or duplicate SKU within the submitted variants is invalid/conflicting.

Complete patch example to change names and keep every variant stable, updating one price:

```json
{
  "version": 0,
  "name": { "en": "Updated cotton shirt" },
  "variants": [
    { "id": "66f000000000000000000003", "values": { "size": "small" }, "price": 25500 },
    { "id": "66f000000000000000000004", "values": { "size": "medium" }, "price": 25000 }
  ]
}
```

`imageIds` on the product or a variant accepts IDs, never a client URL or an `images` object. `images`, `store`, `skuKeys`, and audit fields are not writable API fields; unknown properties are stripped by request validation and do not appear in the DTO. Do not rely on this stripping to persist data. Image workflows and constraints are detailed in [Media](../media/MEDIA_FRONTEND.md).

### Delete

Changing categoryId can fail 409 SALE_OVERLAP when it would introduce overlapping enabled campaigns. The existing product/category assignment and version remain unchanged on failure.

Only `superAdmin` can permanently delete. Delete is rejected with `409 PRODUCT_REFERENCED` if the product or one of its variants is referenced. Live carts block selected product/variant removal. Every saved product-targeted Sale blocks product deletion, including disabled/expired campaigns; remove or retarget those campaigns first. Sale references alone do not block variant removal because their target is the whole product. Saved product-targeted Coupons also block whole-product deletion, including disabled/expired/exhausted definitions; retarget or remove an unused coupon first. Coupon references alone do not block variant removal. Category coupons follow current product membership after a move. Otherwise the product is removed and its images are retired for cleanup. Prefer deactivation (`PATCH {"version": n, "isActive": false}`) when the record must remain. Deletion response is the standard success envelope with `data: null`.

## Statuses and actionable errors

Orders deducts stock on placement and restores it once on staff cancellation/return using conditional transaction writes. Each stock change advances the Product version, so refetch before dashboard edits or on PRODUCT_CONFLICT. Every historical order, including canceled/returned, blocks deletion of its product and removal of its selected variants; deactivate instead. Other unreferenced variants remain removable. Order snapshots survive catalog edits. Product/Cart DTOs are unchanged. See the [Orders contract](../orders/ORDERS_FRONTEND.md).

In addition to shared validation/authentication errors, these module outcomes are relevant:

| HTTP | Code | Meaning and frontend action |
|---|---|---|
| `201` | `OK` | Created product; retain returned `id`, `version`, generated variant IDs, and image DTOs. |
| `200` | `OK` | Read, patch, or delete completed. A delete has `data: null`. |
| `404` | `PRODUCT_NOT_FOUND` | Refetch catalog/list; public result can also mean hidden by inactive product/category. |
| `404` | `CATEGORY_NOT_FOUND` | Requested category filter is missing or not publicly visible. |
| `409` | `PRODUCT_CONFLICT` | Version mismatch or write race; GET current dashboard product and reconcile. |
| `409` | `PRODUCT_TYPE_IMMUTABLE` | Keep the product's original `type`; create a replacement if a different type is required. |
| `409` | `PRODUCT_SKU_EXISTS` | Choose another SKU or clear it. Applies across simple and variant SKUs. |
| `409` | `PRODUCT_SLUG_EXISTS` | Choose another slug. |
| `409` | `CATEGORY_PARENT_NOT_FOUND` | Choose an existing B2C category ID. Despite the name, this is the product-category reference error. |
| `409` | `SALE_OVERLAP` | Moving the product would overlap enabled campaigns; change campaign scope/dates or disable one before moving. |
| `409` | `PRODUCT_REFERENCED` | Keep the product/variant and deactivate it; referenced variants cannot be removed. |
| `422` | `INVALID_PRODUCT` | Correct the business shape, prices, options, choices, duplicate combinations, or empty patch. |
| `422` | `VALIDATION_ERROR` | Fix field-level constraints; `errors[]` identifies field, location, code, and message per shared conventions. |
| `409` | `MEDIA_CONFLICT` | An image ID expired, belongs to a different target, or is no longer available; upload it again to this product. |
| `503` | `MEDIA_UNAVAILABLE` | Image storage is not configured; retry later or save without images if the request has no image changes. |

The API also uses shared `400 INVALID_STORE` only if called internally with the wrong store context; normal B2B URLs are unmatched and return `404`. Transaction-backed changes require database transaction support; deployment/configuration failures use the shared error contract.

## Frontend persistence checklist

Keep the product `id` and current `version` for each dashboard record. Keep each variant `id` when editing that variant. Keep option/value keys stable as machine identifiers while allowing labels to change. Keep image IDs and URLs returned by the server; send only IDs in later product writes. Preserve omitted fields when constructing partial patches, and include all retained variants when sending the replacement `variants` list. For a complete product or variant replacement, explicitly send empty image arrays to clear galleries. Public clients should read current prices and stock from the API; submitted cart/order prices are not part of the Products write contract.

## Wishlist integration

The [Wishlist contract](../wishlist/WISHLIST_FRONTEND.md) reuses the current public batch Product DTO and Sales pricing. Only a B2C customer may save a visible product. A saved product reference, including a hidden product or a blocked/deleted account's retained list, blocks permanent product deletion with PRODUCT_REFERENCED. Staff may deactivate the product. Wishlist saves the whole product and does not block removal of individual variants by itself; Cart/Order variant guards still apply. All Wishlist mutations share the existing catalog transaction guard, so saving and deletion cannot create a dangling reference through a race. No new Product HTTP route or DTO field was added.

## B2B Wholesale selection and reference guard

[Wholesale](../wholesale/WHOLESALE_FRONTEND.md) adds an explicitly B2B staff-authorized read-only selector of visible B2C products through the Products service. It supports paginated literal name/slug search and simple/variant filtering. Source projections retain bilingual names/descriptions/options and current image/variant IDs, while omitting prices, stock, SKU, currency, Sales and dashboard versions. The existing B2C Product HTTP contract and public pricing remain unchanged.

Any saved B2B pouch offer, even disabled, blocks permanent source product deletion and removal of composed variants through PRODUCT_REFERENCED. Offer creation/editing and B2C mutations share the B2C catalog guard; source references cannot race deletion into dangling records. Deactivation is still permitted and makes dependent offers publicly unavailable. Native B2B products use a separate Wholesale collection and never appear in B2C lists/details/Cart. A B2B token never grants B2C mutation or Media permissions.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.


## Public browsing filters and facets — 2026-10-22

This section is implemented, replacing the earlier newest-only public browsing limitation. It extends GET /api/v1/b2c/products and adds GET /api/v1/b2c/products/facets. Both are public JSON GETs without a body, JWT, cookie or private header requirement. X-Language selects localized labels using the existing conventions. Global IP limits apply, including 429 recovery. These extensions do not add dashboard filters, B2B retail browsing, search, stock reservation, or price locking.

### Additional public list queries and normalized inputs

All new queries below are optional scalar URL strings. Do not repeat a new key or send an array/object. New key values are case-sensitive and are not trimmed/lowercased. Unknown query names are ignored by existing validator whitelisting, not applied as filters. Existing page, limit, categoryId, type and isActive handling above remains unchanged; isActive never makes hidden products public.

| Query | Wire value, validation and default | Source, meaning and retained state |
| --- | --- | --- |
| minPrice | Digits only, numeric value 0–1000000000; no blank, sign, decimal, exponent, whitespace or repeated values. Omitted means no lower bound. Leading zeroes normalize to an integer. | Convert a validated EGP amount to integer piastres; inclusive effective unit-price lower bound. Keep in listing state/URL, not Cart or Checkout payloads. |
| maxPrice | Same rules; at least minPrice if both supplied. Omitted means no upper bound. | Inclusive upper bound. Both bounds must match the same variant as selected size/color/Sale conditions. |
| size | 1–40 characters matching ^[a-z0-9][a-z0-9_-]{0,39}$; omitted means any size. | Use a facets sizes[].key, never its translated name. Matches variants[].values.size. A syntactically valid unknown key gives an empty matching list, not 422. |
| color | Same key rules; omitted means any color. | Use colors[].key; matches variants[].values.color. Unknown valid keys give no matches. |
| saleOnly | Exactly true or false, normalized to a Boolean; default false. | True requires effectivePrice strictly below price on the matching sellable item. Includes saved product/variant discounts and current timed campaigns. False applies no discount restriction. |
| sort | newest, price-asc or price-desc; default newest. | Select in the UI. Price order uses the lowest effective price among matching variants; simple products use their effectivePrice. Equal prices use product ID ascending in both price directions. Newest uses createdAt descending, then product ID descending. |

Catalog convention: use option.key=size and option.key=color for semantic apparel options. Their names remain bilingual display labels; values have stable keys such as small/red. Existing generic Product options remain supported and no records are renamed automatically. An option with another key does not participate in size/color filters merely because its display label says Size/Color. Simple products have no variant size/color selection and therefore do not match a supplied size/color filter.

One real variant must satisfy every supplied size, color, minimum price, maximum price and saleOnly condition. Small/red plus large/blue does not match small/blue. Zero-stock products/variants remain visible and may match; adding to Cart still checks stock. Visibility always requires an active product and visible category ancestry. Category scope includes descendants. Filtering and price calculation happen before counting, sorting and pagination; never filter only the fetched page on the frontend.

All campaign activation in one list/facets request uses one captured server instant. Separate list and facets requests can cross a campaign boundary; refetch both when their data becomes stale. These reads are not database snapshot transactions or a promise that data cannot change between requests. On a concurrent product deletion/change, a hydrated page may contain fewer items than limit; re-fetch rather than inventing a product or stale variant.

Sale browsing and coupon eligibility are separate: saved discounts may appear on the Sale page while remaining coupon-eligible. An active campaign excludes the line from coupon discount under the existing Coupons rules, even when its computed price reduction rounds to zero. No coupon policy changed.

### Additional public list response fields

The existing success envelope and data.items/pagination stay intact. Every returned public list item always adds both keys below, including requests without filters. These keys are absent from public detail, dashboard, Cart, Wishlist and price-free B2B Wholesale projections.

| Field | Exact type and source | How to use and retain it |
| --- | --- | --- |
| items[].matchingVariantId | Lowercase 24-hex variant ID, or null for a simple product. For variants, the cheapest matching variant wins; equal effective prices use variant ID ascending. | Use as a listing preview/deep-link hint, not an automatic Cart selection. Reconcile against fresh detail before choosing/adding. The product ID remains items[].id. |
| items[].matchingPrice | Integer piastres, 0–1000000000, always present and non-null. Derived from that matching sellable item's effectivePrice. | Display the price associated with the filters. Zero is valid. Do not submit it as a trusted Cart/Checkout amount. |

All existing product options/variants remain available in the list DTO; filtering does not truncate it to the matching variant. Existing priceFrom retains its meaning as the lowest price across all variants and can differ from matchingPrice. Detail does not apply retained listing filters. Pagination counts distinct matching products, not matching variants. No match returns items:[], total:0, pages:0, preserving effective page/limit. An out-of-range page can have empty items with a positive total.

Example list request: GET /api/v1/b2c/products?size=small&color=red&minPrice=10000&maxPrice=30000&saleOnly=true&sort=price-asc&page=1&limit=20. Omit inactive filters instead of sending empty strings. Existing complete product DTO examples above still apply, with the two mandatory list-only fields added, for example matchingVariantId:null and matchingPrice:20000 on a simple product. The generated OpenAPI/Postman examples contain complete HTTP list responses.

### Facets endpoint: every request and response field

GET /api/v1/b2c/products/facets accepts categoryId, type, minPrice, maxPrice, size, color and saleOnly with exactly the public list rules. It has no pagination/sort control. page, limit, sort and other unrecognized query keys are ignored. Its literal /facets route is registered before /:productId. A syntactically invalid recognized query fails 422; a missing/hidden category fails 404 CATEGORY_NOT_FOUND.

Normal success is 200 with the existing success/code/message/data/requestId envelope. Every data key below is always present. There is no items or pagination wrapper.

| Response field | Type, meaning and provenance | Frontend use |
| --- | --- | --- |
| currency | Literal EGP | Prices use integer piastres. |
| pricedAt | ISO UTC timestamp with milliseconds, captured at this request's start | Display/debug freshness; not an edit version, expiry or reusable price credential. |
| price | Object with min and max | Current scope's effective-price range. |
| price.min, price.max | Nonnegative integer piastres or null; both null when no eligible sellable item remains | Inclusive range from current category/type/size/color/Sale scope while ignoring both current price bounds. Use null for no available range, never convert it to zero. |
| sizes | Array of {key,name,count}, ordered by key | Distinct declared size choices in the public category/type scope, including zero counts. Empty when none exist. |
| colors | Array of {key,name,count}, ordered by key | Same for color choices. |
| sizes[].key, colors[].key | Stable option-value key string | Retain and reuse as query size/color. Never use the translated label as identity. |
| sizes[].name, colors[].name | Localized display string from the corresponding option value, with normal language fallback | Display only. If products reuse one key with inconsistent labels, the newest product's definition wins; maintain consistent catalog labels. No color hex/swatches are returned. |
| sizes[].count, colors[].count | Nonnegative integer counting distinct matching products, never variants | Size counts ignore only the selected size while honoring color/price/Sale; color counts ignore only color while honoring size/price/Sale. Multiple matching variants of one product count once for a choice. |
| applied | Object containing every normalized selection below | Replace retained filter state with normalized values when appropriate. It is not a credential. |
| applied.categoryId | Lowercase 24-hex ID or null | Current selected category from the query, null when omitted. |
| applied.type | simple, variant or null | Query type or no restriction. |
| applied.minPrice, applied.maxPrice | Integer piastres or null | Supplied normalized bounds; null means omitted. The range above can extend outside these bounds because it ignores them. |
| applied.size, applied.color | Stable key string or null | Supplied selection, including an unknown syntactically valid key. No fabricated choice is added for it. |
| applied.saleOnly | Boolean, default false | Effective discount restriction. |

Counts are disjunctive: a filter ignores its own selection to show alternatives. Consequently a size count may be positive even if the current size/color combination has no list results. Known declared choices remain with count 0 when other filters exclude them. If an unknown size/color is supplied, applied retains it while the choice arrays contain only real configured keys. Empty category scopes have empty choice arrays and null price bounds.

Complete synthetic facets response (a small/red variant at EGP 200 and a large/blue variant at EGP 300; only small/red matches this request):

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "currency": "EGP",
    "pricedAt": "2026-10-22T10:00:00.000Z",
    "price": { "min": 20000, "max": 20000 },
    "sizes": [
      { "key": "large", "name": "Large", "count": 0 },
      { "key": "small", "name": "Small", "count": 1 }
    ],
    "colors": [
      { "key": "blue", "name": "Blue", "count": 0 },
      { "key": "red", "name": "Red", "count": 1 }
    ],
    "applied": {
      "categoryId": null,
      "type": null,
      "minPrice": 10000,
      "maxPrice": 25000,
      "size": "small",
      "color": "red",
      "saleOnly": false
    }
  },
  "requestId": "f138736c-2bce-4b41-b229-7b044998ceef"
}
```

### Screen sequence, errors, concurrency and verification

1. Load categories, retain a selected category ID, and load listing/facets with the same filter state and X-Language. Independent GETs may run together; each has its own pricing instant.
2. Build size/color choices from facets, convert EGP inputs to piastres, and debounce changes. Reset page to 1 on any filter or sort change. Do not invent options from only the current product page.
3. Discard stale in-flight responses when the visitor changes filters/language. Keep the last successful display while loading; show a real no-results state only after the current request succeeds empty. Preserve inputs after transport errors.
4. Product cards can use matchingPrice and matchingVariantId for previews. Opening detail fetches the real product. Validate the selected combination and current stock before Cart; Cart/Checkout still recalculate independently.
5. Refresh list and facets after relevant catalog/Sale edits, campaign boundaries or explicit reload. Neither response reserves stock, persists a filter, starts a checkout or changes coupon uses. No additional client-retained server token/version is needed.

422 VALIDATION_ERROR uses the existing field errors and leaves filter input available for correction; bounds are inclusive and maxPrice must not be below minPrice. 404 CATEGORY_NOT_FOUND means clear/reselect the missing/hidden category after refreshing Categories. A valid unknown size/color gives 200 with empty matches; clear that selection rather than reporting a server error. 429 TOO_MANY_REQUESTS requires Retry-After/backoff, paused automatic filtering and preserved state; do not refresh JWTs. Network/5xx errors retain state and allow a bounded retry of these read-only GETs. Standard CORS/envelope/error behavior remains in shared conventions. No new resource or error code was added.

The implementation scans lean public price/option projections, reuses existing Sales pricing, then hydrates only the selected page's full product DTOs. Product images/descriptions are not loaded for the whole catalog. This is a deliberate small/medium-catalog implementation; an indexed pricing projection is the upgrade when measured browse latency/catalog growth warrants it. It is not a performance or load-test claim. Relevant regression evidence is recorded in the integration readiness update; no live database/provider/browser claim follows from fixture tests.


## Optional reusable size charts — 2026-10-22

Product POST/PATCH accepts optional sizeChartId, an existing 24-hex B2C chart ID or null. Create omission defaults null; PATCH omission preserves; null clears. Product.version is still required for Product PATCH and is independent of chart.version. Obtain IDs from the [Size Charts dashboard API](../sizecharts/SIZECHARTS_FRONTEND.md). Inactive charts are assignable but produce no public guide. An absent target fails404 SIZE_CHART_NOT_FOUND; assigning/deleting charts shares the transactional catalog guard. Product dashboard list/detail/create/PATCH always return sizeChartId, null when unset, including legacy records.

Public Product list/detail always add `sizeChart:null` or `{id,name,image,alt,measurements}`. `id` is chart identity; `name` and `alt` are localized display strings. `image` is a public Image object or null: it uses the requested language, otherwise the other attached language, and is null for numeric-only charts. `alt` falls back to the other language and then the chart name. `measurements` is null or `{unit:"cm",rows:[{size,chest,length,sleeve}]}`; its ordered rows are shared across locales, and values are centimetres. Localize table labels in the frontend; the server does not infer whether values mean flat garment width or circumference. An active image-only legacy chart has `measurements:null`; a numeric-only chart has `image:null`; mixed charts return both. Render numeric data first and use the image as fallback otherwise. Missing/inactive/unresolvable charts return null; hide the guide button. Neither chart version, `sizeChartId`, assigned-product count nor provider internals are public. A chart does not define variants or override size selection, stock/prices or coupon rules. Cart, Wishlist, Orders and B2B Wholesale DTOs do not gain chart fields; open B2C Product detail for its guide. The linked Size Charts contract defines every nested field, full editor/upload/assignment sequence, language/ownership rules, examples and errors.

Homepage curation (2026-10-22): [Homepage](../homepage/HOMEPAGE_FRONTEND.md) returns this same localized public detail projection, current Sale prices and sizeChart for selected visible Products, in staff-defined order. It omits listing-only matchingPrice/matchingVariantId. Saved homepage productIds block permanent Product deletion with409 PRODUCT_REFERENCED until removed from both selections; deactivation remains allowed and hides public cards. Product-level homepage references alone do not block variant removal. Selection/deletion share the catalog transaction guard. Homepage does not modify stock/prices or replace Product detail/Cart selection.
