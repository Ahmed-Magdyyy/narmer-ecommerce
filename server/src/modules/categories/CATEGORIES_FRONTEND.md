# Categories: complete frontend handoff

Apidog request setup (2026-10-21): category create and update use Body > JSON, not form-data. The default editable body shows all supported fields; required versus optional status remains defined below. Create requires name.ar, name.en and slug. For an image, create the category first and retain data.id as categoryId; upload raw image bytes with POST /api/v1/admin/b2c/media/category/<categoryId>; retain the upload's data.id as imageId; then PATCH /api/v1/admin/b2c/categories/<categoryId> with {"imageId":"<uploaded image ID>"}. The upload's image ID and the category's ID are different. PATCH does not require a version. The separate saved attachImage request template demonstrates this final step. A failed upload does not undo successful category creation: retry upload/attachment for the existing category rather than creating a duplicate.

Source checked: 2026-10-13. Implemented for B2C only. Read [shared API conventions](../../../../docs/frontend/api-conventions.md) and [B2C overall flow](../../../../docs/frontend/b2c-flow.md). Related modules: [Products](../products/PRODUCTS_FRONTEND.md) and [Media](../media/MEDIA_FRONTEND.md).

## Purpose, ownership, and permissions

One Categories module represents roots, children, and grandchildren with a parent reference. Maximum depth is three including the root. The name remains Category, not Collection. There are no separate subcategory or sub-subcategory endpoints/models. Public responses serve storefront navigation; dashboard responses preserve both languages for editing.

The URL selects B2C. The body cannot select a store, owner, creator, or audit actor. Public reads require no access token. Dashboard reads/creation/edits require a current B2C `superAdmin` or `admin` JWT; deletion requires `superAdmin`. B2C moderators/customers and all B2B credentials cannot manage these records. Inactive records remain visible to authorized staff. There are no B2B category routes.

All documented responses use the five-field success envelope in API conventions, with code `OK`. Reads/edits/deletion use HTTP 200, creation uses 201. Examples below labeled `data` are the complete inner payload, not the entire wire envelope. JSON mutation bodies require `Content-Type: application/json`; authenticated requests require `Authorization: Bearer <B2C staff accessToken>`. Locale headers affect public text only; dashboard text remains bilingual.

## Every endpoint

| Method and exact path | Role | Path/query/body | Success `data` |
| --- | --- | --- | --- |
| `GET /api/v1/b2c/categories` | Public | No body/path fields; queries are not consumed | Array of localized root tree nodes, each with `children`. |
| `GET /api/v1/b2c/categories/:categoryId` | Public | Required path `categoryId`; no body/query fields | One localized category without `children`. |
| `GET /api/v1/admin/b2c/categories` | superAdmin/admin | Optional list query below; no body | `{items, pagination}`; flat bilingual records without `children`. |
| `GET /api/v1/admin/b2c/categories/tree` | superAdmin/admin | No body/path/query fields | Full bilingual root tree, including inactive categories. |
| `GET /api/v1/admin/b2c/categories/:categoryId` | superAdmin/admin | Required path `categoryId`; no body/query | One bilingual category without `children`. |
| `POST /api/v1/admin/b2c/categories` | superAdmin/admin | Creation JSON below | Created bilingual category, HTTP 201. |
| `PATCH /api/v1/admin/b2c/categories/:categoryId` | superAdmin/admin | Required path `categoryId`; partial update JSON below | Updated bilingual category, HTTP 200. |
| `DELETE /api/v1/admin/b2c/categories/:categoryId` | superAdmin only | Required path `categoryId`; no body/query | Null, HTTP 200. Deletion never returns a category object. |

The literal `/tree` is registered before the dashboard ID route. Detail endpoints use the category's returned `id`, never its slug or tree position. Path IDs must be 24-character hexadecimal ObjectIds. Invalid IDs fail with 422; a valid missing/invisible ID fails with 404 as described below.

## Every list query field

These queries apply only to dashboard GET collection. Unknown parameters are ignored. They are URL strings validated/coerced as shown; null is not a meaningful URL value.

| Query | Optional/default, validation | Meaning/source and frontend retention |
| --- | --- | --- |
| `page` | Optional; integer 1–100000; default 1; converted to number | Requested 1-based page. Keep with filters for navigation. |
| `limit` | Optional; integer 1–100; default 20; converted to number | Number of flat records per page. Keep the effective value returned in pagination. |
| `parentId` | Optional; ObjectId string or literal `root` | Omitted means all parents. `root` is converted to null and selects only roots. An ID selects direct children only, not all descendants. Obtain ID from a category response. |
| `isActive` | Optional; exact `true` or `false` string; converted to boolean | Filters each record's own flag, not effective ancestor visibility. Omitted means both active and inactive. |

Example: `GET /api/v1/admin/b2c/categories?page=1&limit=20&parentId=root&isActive=true`. Sorting is ascending `position`, then ascending MongoDB `_id`, established by the repository. There is no search, custom sort, cursor, or depth query. Public tree reads do not accept those dashboard filters; do not expect `?parentId=...` to change the public tree.

## Every create/update request field

The service uses only validated fields. Extra keys such as `id`, `store`, `children`, timestamps, actor, image URL, or `version` do not update the record. No category version must be retained for editing.

For creation, names, descriptions, slug, position, and `isActive` come from the current staff form. For PATCH, initialize them from the dashboard category DTO and submit only changed fields. `parentId` comes from a selected category DTO's `id` (or explicit root selection as `null`); `imageId` comes from the Media upload response for this category. Returned `id` is the canonical identifier for detail/PATCH/DELETE paths, child `parentId`, Product `categoryId`, and the Media `targetId`; `slug` is never an API identifier.

| JSON field | Create | PATCH | Type, limits, defaults, and source | Meaning and later use |
| --- | --- | --- | --- | --- |
| `name` | Supplies both leaves below | Optional object containing edited leaves | Nested object; only `ar`/`en` are recognized | Localized display names; container alone does not replace both translations. |
| `name.ar` | Required | Optional | String trimmed to 1–150 characters | Arabic name entered by staff. Keep returned value for the Arabic editor. |
| `name.en` | Required | Optional | String trimmed to 1–150 characters | English name entered by staff. Keep returned value for the English editor. |
| `description` | Optional | Optional object containing edited leaves | Nested object with recognized translations only | Optional description text. |
| `description.ar` | Optional; defaults to empty string | Optional; omitted preserves existing text | String trimmed, at most 2000 characters; empty allowed; null rejected | Arabic description; send empty string to clear it. |
| `description.en` | Optional; defaults to empty string | Optional; omitted preserves existing text | Same rules as Arabic | English description; send empty string to clear it. |
| `slug` | Required | Optional | Trimmed string, at most 150 characters, matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`; unique in B2C | Staff-chosen navigation slug. It is not an API lookup key or server-generated value. It is not automatically lowercased: send lowercase. |
| `parentId` | Optional; absent/null creates a root | Optional; absent preserves parent, null moves to root | Null or 24-character hexadecimal ID; choose from existing B2C categories | Controls tree placement. An ID creates/moves under that category. No name/slug substitute is accepted. |
| `position` | Optional; default 0 | Optional; omitted preserves value | Integer from 0 to 100000; validator accepts integer strings and coerces to number, but send a JSON integer | Ordering among the repository's sorted records/siblings. Equal positions sort by ID. |
| `isActive` | Optional; default true | Optional; omitted preserves value | Actual JSON boolean; strings/numbers/null rejected | Own publication flag. An inactive ancestor hides this record even if its own flag is true. |
| `imageId` | Optional; omit or null in normal creation | Optional; omitted preserves image, null clears it | Null or Media image ID string | Attaches one Media upload bound to this exact category. The ordinary image flow requires creating the category first. |

Partial translation PATCH updates only the supplied translation. For example, `{ "name": { "ar": "ملابس جديدة" } }` preserves `name.en`. Required text cannot be cleared with blank/null. Empty PATCH or a body containing only ignored fields returns 422. `imageId: null` is a meaningful edit and can clear an existing image.

Parent must exist in B2C. Self-parenting and cycles fail. Moving a branch also validates the resulting depth of every descendant; moving a category that already has grandchildren under another root would create a fourth level and fails. Do not limit the UI depth check to the selected category alone. Inactive parents are allowed for staff organization, but their descendants are hidden publicly. Each structural mutation and product assignment is coordinated transactionally; the frontend must still handle a conflict if another staff member changed the tree.

## Every category response field

The following exact fields appear on public/detail/dashboard/create/update DTOs. Tree DTOs add `children`; flat/detail DTOs do not include that key.

| Response field | Type/presence | Meaning/source | Frontend retention |
| --- | --- | --- | --- |
| `id` | Always lowercase ObjectId string | Generated by backend at creation | Required for get/PATCH/DELETE, child `parentId`, Products `categoryId`, and Media target binding. |
| `parentId` | Always ObjectId string or null | Stored parent reference, null for root | Build breadcrumbs/tree editors; send a new parent ID or null to move. |
| `slug` | Always string | Stored validated slug | Navigation/display metadata; API details still use id. |
| `name` | Public: string; dashboard: object | Public selects requested language; dashboard returns both stored translations | Do not use one TypeScript shape for both variants without discriminating context. |
| `name.ar`, `name.en` | Both string keys on dashboard `name` only | Stored staff translations | Initialize/edit bilingual inputs. Not present on localized public `name`. |
| `description` | Public: string; dashboard: object | Public selects locale and falls back to other translation if the selected description is empty; dashboard returns both strings | Empty is a valid description. |
| `description.ar`, `description.en` | Both string keys on dashboard only | Stored descriptions, each possibly empty | Use exact translation as editing state, not the public fallback. |
| `position` | Always integer | Stored ordering value | Retain for ordering edits. |
| `isActive` | Always boolean | This category's own flag | Staff visibility switch. It is not an `isVisible` computed flag. |
| `image` | Always image object or null | Verified attached Media reference, never arbitrary client URL | Show optional image; retain image.id to preserve attachment. |
| `image.id` | String if image exists | Media-created lowercase ObjectId string | Reuse as imageId only for this target. |
| `image.url` | Absolute URL string if image exists | Server-created public WebP CDN URL | Display only; do not submit as imageId. |
| `image.width`, `image.height` | Integer 1–1600 each if image exists | Processed image pixel dimensions | Use aspect ratio/layout. |
| `children` | Array on tree nodes only; empty at leaves | Server nests direct children recursively up to the supported depth | Render recursively; do not send it in a mutation. |

There are no `store`, `level`, `depth`, `isVisible`, `createdAt`, `updatedAt`, `version`, audit fields, product counts, or descendant-ID arrays in the category DTO. A public category must be active with every ancestor active to appear. Public detail of a hidden category returns the same `CATEGORY_NOT_FOUND` as a missing record.

Dashboard paginated GET has exactly `data.items` (array of flat bilingual DTOs) and `data.pagination.page`, `.limit`, `.total`, `.pages` (integers, defined in shared conventions). Total counts after dashboard filters. Empty result: `{ "items": [], "pagination": { "page": 1, "limit": 20, "total": 0, "pages": 0 } }`. Both tree endpoints return `data: []` when there are no visible/all roots respectively. They do not return pagination.

## Complete representative payloads

Create a root with no image:

```json
{
  "name": { "ar": "ملابس", "en": "Clothing" },
  "description": { "ar": "", "en": "Finished clothing" },
  "slug": "clothing",
  "parentId": null,
  "position": 0,
  "isActive": true
}
```

HTTP 201 response, with a synthetic generated ID:

```json
{
  "success": true,
  "code": "OK",
  "message": "Request completed successfully.",
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "parentId": null,
    "slug": "clothing",
    "name": { "ar": "ملابس", "en": "Clothing" },
    "description": { "ar": "", "en": "Finished clothing" },
    "position": 0,
    "isActive": true,
    "image": null
  },
  "requestId": "f138736c-2bce-4b41-b229-7b044998ceef"
}
```

Create a child with POST by using the returned root ID:

```json
{
  "name": { "ar": "قمصان", "en": "Shirts" },
  "slug": "shirts",
  "parentId": "507f1f77bcf86cd799439011"
}
```

Public GET tree with `X-Language: en` returns this complete `data` shape for that root and child:

```json
[
  {
    "id": "507f1f77bcf86cd799439011",
    "parentId": null,
    "slug": "clothing",
    "name": "Clothing",
    "description": "Finished clothing",
    "position": 0,
    "isActive": true,
    "image": null,
    "children": [
      {
        "id": "507f1f77bcf86cd799439012",
        "parentId": "507f1f77bcf86cd799439011",
        "slug": "shirts",
        "name": "Shirts",
        "description": "",
        "position": 0,
        "isActive": true,
        "image": null,
        "children": []
      }
    ]
  }
]
```

Other request examples: PATCH `{ "parentId": null }` moves to root; PATCH `{ "position": 3, "isActive": false }` edits sorting/publication; PATCH `{ "description": { "en": "" } }` clears one description. GET and DELETE have no JSON body. Detail response is the corresponding category object above with no `children`. Dashboard detail uses bilingual text even when X-Language is en/ar.

## Image flow and fields to retain

1. POST category without an image and retain returned category `id`.
2. Call `POST /api/v1/admin/b2c/media/category/:targetId` with `targetId=<category id>` using raw bytes and a staff JWT. The route parameter is `kind=category`; there is no `targetType` body field.
3. Retain upload `id`, `url`, `width`, and `height`. Its unattached reference expires after 24 hours, but the response does not contain `expiresAt`. See Media for exact response.
4. PATCH this category with `{ "imageId": "<upload id>" }`. The response's `image` is the canonical attached image.
5. Omit imageId to preserve it. Send null to remove it. A category has one image; replacing it retires the prior reference after successful commit.

Do not attach another category's upload or copy a Product image ID here. The upload is target-bound, including while ready. Sending imageId in an ordinary create cannot attach an upload for a category that did not yet exist; use the create/upload/PATCH sequence. Replacing/deleting a category image commits the database edit before asynchronous provider cleanup, so successful deletion does not guarantee immediate disappearance from CDN cache. Never depend on the public URL remaining valid after retirement.

## Deletion, errors, and recovery

No cascade deletion exists. A category with direct child categories cannot be deleted, even if children are inactive. A category directly assigned to a product cannot be deleted, including assignment to inactive products. Move children/products first, then an authorized superAdmin deletes empty categories from the bottom upward. Normal admin UI should offer deactivation/movement instead of deletion. Deactivation hides the branch; it does not remove products, carts, or records.

| HTTP/code | Triggers/endpoints | Frontend action |
| --- | --- | --- |
| 401 `UNAUTHORIZED` | Protected dashboard requests with missing/invalid/wrong-store/revoked credentials | Follow Auth refresh/login recovery. |
| 403 `FORBIDDEN` | Wrong role on dashboard or admin attempting DELETE | Hide forbidden controls; do not retry as the same role. |
| 404 `CATEGORY_NOT_FOUND` | Detail or mutation target missing; public detail hidden | Refresh navigation/list and remove stale selection. |
| 409 `CATEGORY_SLUG_EXISTS` | POST/PATCH duplicate slug in B2C | Choose another slug. |
| 409 `CATEGORY_PARENT_NOT_FOUND` | POST/PATCH selected parent missing | Reload parent picker. |
| 409 `CATEGORY_CYCLE` | POST/PATCH would create a cycle/self-parent | Correct parent selection. |
| 409 `CATEGORY_DEPTH_EXCEEDED` | POST/PATCH branch would exceed three levels | Choose a shallower parent, accounting for descendants. |
| 409 `CATEGORY_HAS_CHILDREN` | DELETE has direct children | Move/delete children before retrying. |
| 409 `CATEGORY_HAS_COUPONS` | DELETE directly targets any saved Coupon, even disabled/expired/exhausted | Retarget or remove an unused coupon first; used definitions can be disabled but not deleted. |
| 409 `CATEGORY_HAS_SALES` | DELETE directly targets a category referenced by any saved Sale, even disabled/expired | Retarget or delete the campaign first; no cascade. |
| 409 `SALE_OVERLAP` | Reparenting would introduce overlap between enabled campaign scopes during intersecting schedules | Disable, reschedule, or retarget a conflicting Sale before retrying; the original tree is preserved. |
| 409 `CATEGORY_HAS_PRODUCTS` | DELETE has assigned products | Move products before retrying. |
| 409 `MEDIA_CONFLICT` | Attachment ownership/status/expiry is invalid | Obtain a fresh upload for this category and retry. |
| 503 `MEDIA_UNAVAILABLE` | Mutation needs Media storage but it is unavailable | Preserve the form; ask operator to configure/fix storage. |
| 503 `NOT_READY` | Missing catalog guard | Temporary/operator issue. |
| 503 `TRANSACTIONS_REQUIRED` | MongoDB cannot perform write transaction | Operator must fix deployment; not an input retry. |
| 422 `VALIDATION_ERROR` | Bad path/body/query or empty PATCH | Fix fields according to tables. |

Shared CORS/body/parser errors and unexpected 500s also apply. Structural errors have no promised field-level errors array; use top-level code/message. Failed transactions preserve prior tree, images, assignments, and audit state. Two staff edits are not protected by a client edit version here; reload after conflicts and replace UI state with the returned DTO rather than predicting field values.

## Integration checklist and source

Keep category IDs for later product creation/filtering and media uploads. Keep bilingual dashboard DTOs separately from localized public DTOs. Reload tree/list after move, deactivation, ordering change, creation, or deletion. Products category filtering includes descendants through Products, while category list `parentId` is direct children only. Category Sales include all current descendants. Reparenting checks the proposed tree against enabled campaigns before committing. New descendants/products inherit the category scope automatically. Staff manages campaigns through the separate [Sales](../sales/SALES_FRONTEND.md) contract. [Coupons](../coupons/COUPONS_FRONTEND.md) also scopes categories with all descendants, following current reparenting/product assignment dynamically. Coupons impose no Sales-style overlap restriction; direct targets block deletion in every state.

Source: `categories.routes.js`, `.controller.js`, `.validator.js`, `.service.js`, `.repository.js`, `.model.js`; shared image/response/context middleware; actual Products assignment and Media collaborators. Relevant tests: `categories-http.test.js`, `categories-service.test.js`, `products-http.test.js`, `identity-mongo.test.js`. Public/browser/provider behavior beyond those test boundaries is not newly established by this documentation.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.
