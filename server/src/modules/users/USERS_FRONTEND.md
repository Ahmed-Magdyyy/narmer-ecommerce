# Users API handoff

B2B Leads integration (2026-10-12): an authenticated B2B customer may submit a Lead and read only submissions explicitly owned by their account. Guest submissions remain guest-owned even when email/phone matches an account or the visitor later signs in. Profiles and addresses may prefill editable contact in the frontend; Leads snapshots the submitted name/phone/optional email/governorate/district, and does not look up an addressId or current profile later. B2B staff uses its own Leads dashboard permissions. See the [Leads contract](../leads/LEADS_FRONTEND.md) for exact ownership, credential and contact fields.

Source checked: 2026-10-13

This document describes the implemented account profile, saved-address, and dashboard account-management APIs for B2C and B2B. Shared response/error conventions and broader journeys are linked at [API conventions](../../../../docs/frontend/api-conventions.md), [B2C flow](../../../../docs/frontend/b2c-flow.md), and [B2B flow](../../../../docs/frontend/b2b-flow.md). Those documents are maintained separately; this handoff includes the exact Users schemas and behavior.

Related module handoffs: [Auth](../auth/AUTH_FRONTEND.md).

## Scope and request handling

The API prefix is `/api/v1`. Customer self-service endpoints exist under `/api/v1/b2c/users` and `/api/v1/b2b/users`. Dashboard staff endpoints are separate at `/api/v1/admin/b2c/users` and `/api/v1/admin/b2b/users`. Each store's account and address data is isolated. A token for one store returns 401 when used under the other store.

Every endpoint requires `Authorization: Bearer <accessToken>`. Access tokens expire after 15 minutes; see [Auth handoff](../auth/AUTH_FRONTEND.md) for login, refresh-cookie, logout, Origin, locale, and rate-limit behavior. Staff routes accept only current `superAdmin` or `admin` roles for listing, reading, and updating accounts; deletion is super-admin-only. Customer address routes accept only the `user` role. Moderators cannot access staff account routes. Authentication failures return 401 `UNAUTHORIZED`; authenticated role failures return 403 `FORBIDDEN`.

Success envelopes are `{ "success": true, "code": "OK", "message": "...", "data": ..., "requestId": "..." }` (address creation uses 201; otherwise 200). Delete success has `data: null`. Errors use `{ "success": false, "code": "...", "message": "...", "errors": [...], "requestId": "..." }`. Validation errors are 422 `VALIDATION_ERROR`; error `errors` entries contain `field`, `location`, `code`, and localized `message`. The shared [API conventions](../../../../docs/frontend/api-conventions.md) file defines these envelopes for all modules.

Only recognized fields are consumed. Unknown fields are ignored, including attempted `email`, `store`, `role` in self-profile edits and password/internal fields in staff edits. IDs are Mongo ObjectId hex strings in paths and output; malformed IDs are 422 `VALIDATION_ERROR` with an `INVALID_FIELD` detail.

## Endpoints

### Customer self-service

| Method and path | Role | Success | Other implemented statuses |
|---|---|---|---|
| GET `/api/v1/{store}/users/me` | Any active authenticated account | 200 profile | 401 `UNAUTHORIZED`; 403 `EMAIL_NOT_VERIFIED`; 500 `INTERNAL_ERROR` |
| PATCH `/api/v1/{store}/users/me` | Any active authenticated account | 200 updated profile | 401 `UNAUTHORIZED`; 403 `EMAIL_NOT_VERIFIED`; 422 `VALIDATION_ERROR`; 500 `INTERNAL_ERROR` |
| GET `/api/v1/{store}/users/me/addresses` | `user` | 200 array of addresses | 401 `UNAUTHORIZED`; 403 `FORBIDDEN` or `EMAIL_NOT_VERIFIED`; 500 `INTERNAL_ERROR` |
| GET `/api/v1/{store}/users/me/addresses/{addressId}` | `user` | 200 one address | 401 `UNAUTHORIZED`; 403 `FORBIDDEN` or `EMAIL_NOT_VERIFIED`; 404 `ADDRESS_NOT_FOUND`; 422 `VALIDATION_ERROR`; 500 `INTERNAL_ERROR` |
| POST `/api/v1/{store}/users/me/addresses` | `user` | 201 new address | 401 `UNAUTHORIZED`; 403 `FORBIDDEN` or `EMAIL_NOT_VERIFIED`; 422 `VALIDATION_ERROR`; 500 `INTERNAL_ERROR` |
| PATCH `/api/v1/{store}/users/me/addresses/{addressId}` | `user` | 200 updated address | 401 `UNAUTHORIZED`; 403 `FORBIDDEN` or `EMAIL_NOT_VERIFIED`; 404 `ADDRESS_NOT_FOUND`; 422 `VALIDATION_ERROR`; 500 `INTERNAL_ERROR` |
| DELETE `/api/v1/{store}/users/me/addresses/{addressId}` | `user` | 200 `OK`, `data: null` | 401 `UNAUTHORIZED`; 403 `FORBIDDEN` or `EMAIL_NOT_VERIFIED`; 404 `ADDRESS_NOT_FOUND`; 422 `VALIDATION_ERROR`; 500 `INTERNAL_ERROR` |

`{store}` is exactly `b2c` or `b2b` through the mounted routes. A profile call works for a staff role too, but address service access is customer-only. An active account changing role away from `user` can still use `/me`, but address requests return 403.

### Dashboard staff account management

All paths below use `/api/v1/admin/{store}/users`.

| Method and path | Allowed role | Success | Other implemented statuses |
|---|---|---|---|
| GET `/api/v1/admin/{store}/users` | `superAdmin`, `admin` | 200 account page | 401 `UNAUTHORIZED`; 403 `FORBIDDEN` or `EMAIL_NOT_VERIFIED`; 422 `VALIDATION_ERROR`; 500 `INTERNAL_ERROR` |
| GET `/api/v1/admin/{store}/users/{userId}` | `superAdmin`, `admin` | 200 account | 401 `UNAUTHORIZED`; 403 `FORBIDDEN` or `EMAIL_NOT_VERIFIED`; 404 `ACCOUNT_NOT_FOUND`; 422 `VALIDATION_ERROR`; 500 `INTERNAL_ERROR` |
| PATCH `/api/v1/admin/{store}/users/{userId}` | `superAdmin`, `admin` | 200 updated account | 401 `UNAUTHORIZED`; 403 `FORBIDDEN` or `EMAIL_NOT_VERIFIED`; 404 `ACCOUNT_NOT_FOUND`; 409 `SUPER_ADMIN_PROTECTED` or `ACCOUNT_CONFLICT`; 422 `VALIDATION_ERROR`; 500 `INTERNAL_ERROR`; transaction configuration may return 503 `TRANSACTIONS_REQUIRED` |
| DELETE `/api/v1/admin/{store}/users/{userId}` | `superAdmin` only | 200 `OK`, `data: null` | 401 `UNAUTHORIZED`; 403 `FORBIDDEN` or `EMAIL_NOT_VERIFIED`; 404 `ACCOUNT_NOT_FOUND`; 409 `SUPER_ADMIN_PROTECTED` or `ACCOUNT_CONFLICT`; 422 `VALIDATION_ERROR`; 500 `INTERNAL_ERROR`; transaction configuration may return 503 `TRANSACTIONS_REQUIRED` |

The store is selected by URL. The API does not let staff list or change accounts from another store.

There is no staff account-create (`POST /admin/{store}/users`) operation in this module. Accounts enter through the Auth registration flow and receive the `user` role; staff role assignment is an update to an existing eligible account.

## Request schemas and validation

### Profile patch

`PATCH /users/me` accepts at least one of these optional fields:

- `name`: string, trimmed, 1–100 characters.
- `phone`: string, trimmed, then spaces, parentheses, and hyphens are removed; the result must contain 6–15 digits with an optional leading `+`.

An omitted field stays unchanged. There is no nullable/clear operation for either field. Empty body, fields that are only unknown, or values removed by the recognized-field whitelist produce 422. `email`, `role`, `status`, `store`, `addresses`, and password fields are ignored, not updated.

### Address create and patch

Create requires all four required fields; patch may include any non-empty subset. Every supplied string is trimmed before storage.

| Field | Create | Patch | Type and constraints | Meaning/output |
|---|---|---|---|---|
| `label` | Required | Optional | String, 1–100 characters | User-facing label such as Home |
| `governorate` | Required | Optional | String, 1–100 characters | Governorate text |
| `building` | Required | Optional | String, 1–200 characters | Building identifier |
| `street` | Required | Optional | String, 1–200 characters | Street text |
| `district` | Optional | Optional | String, max 100 characters | District; omitted values default to empty string on create |
| `floor` | Optional | Optional | String, max 50 characters | Floor; omitted values default to empty string on create |
| `apartment` | Optional | Optional | String, max 50 characters | Apartment; omitted values default to empty string on create |
| `details` | Optional | Optional | String, max 1000 characters | Additional delivery details; omitted values default to empty string on create |
| `contactPhone` | Optional | Optional | String or null | Override phone; trimmed and normalized like profile phone. Empty string or null is accepted and stored as null. Omitted create defaults to null. |

No address fields support clearing to a missing/omitted state. Optional descriptive fields accept empty strings (after trimming); required fields do not. For contact phone, null and an empty/whitespace string explicitly clear the override. If cleared or omitted, the returned `effectiveContactPhone` uses the current profile phone. This effective value is computed on every response and is not stored separately. Updating the profile phone therefore changes the effective address contact phone for addresses without an override.

`governorate` is currently accepted and stored as free-form text and is returned unchanged as `governorate`. It is not validated against a catalog and does not automatically map to shipping configuration. For new frontend work, retain a stable `governorateCode` alongside the display label where the shipping flow needs a code; preserve existing saved labels when displaying or editing legacy addresses. This API does not currently accept or return `governorateCode`.

Patch with no recognized fields returns 422. Unknown fields such as `userId`, `store`, or an arbitrary ID are ignored. Ownership is implicit from the bearer identity: the request cannot choose another account's address. Address IDs are generated by the server and returned as `id`; clients must retain this ID for get/update/delete.

### Account list query

`GET /admin/{store}/users` accepts optional query parameters:

- `page`: integer from 1 through 100000; default 1.
- `limit`: integer from 1 through 100; default 20.
- `role`: `superAdmin`, `admin`, `moderator`, or `user`.
- `status`: `active`, `blocked`, or `deleted`.

The repository sorts newest-first by `createdAt`, then descending `_id`. When status is omitted, deleted accounts are excluded. Supplying `status=deleted` selects deleted accounts. The service returns the validated pagination values (with defaults), total matching count, and `pages = ceil(total / limit)`; no max offset beyond the page bound is separately enforced.

### Representative requests

The following examples show request bodies; reads and deletes have no body.

```http
PATCH /api/v1/b2c/users/me
Authorization: Bearer <accessToken>
Content-Type: application/json

{"name":"Updated Customer","phone":"+20 (100) 987-6543"}
```

```http
POST /api/v1/b2c/users/me/addresses
Authorization: Bearer <accessToken>
Content-Type: application/json

{"label":"Home","governorate":"Cairo","district":"Nasr City","building":"12A","street":"Main Street","floor":"2","apartment":"5","details":"Ring the bell","contactPhone":null}
```

```http
PATCH /api/v1/b2c/users/me/addresses/507f1f77bcf86cd799439022
Authorization: Bearer <accessToken>
Content-Type: application/json

{"apartment":"6","contactPhone":""}
```

```http
PATCH /api/v1/admin/b2c/users/507f1f77bcf86cd799439011
Authorization: Bearer <accessToken>
Content-Type: application/json

{"name":"Store Staff","role":"moderator","status":"active"}
```

GET requests take no body; for example, `/api/v1/admin/b2c/users?page=2&limit=20&role=admin&status=active` applies the documented filters. DELETE requests take no body. There is no account-creation request body because no account POST endpoint is implemented.

### Account update

`PATCH /admin/{store}/users/{userId}` accepts at least one recognized field:

- `name`: same 1–100 character trimmed string rules as profile edit.
- `phone`: same normalization and 6–15 digit validation as profile edit.
- `role`: `admin`, `moderator`, or `user`. Promotion to `superAdmin` is intentionally rejected by validation; use the explicit handover workflow. Admins and super-admins may update this field.
- `status`: `active` or `blocked`. `deleted` is not an allowed update; deletion has its own endpoint. Admins and super-admins may update this field.

Omitted values stay as-is. No recognized values yields 422. Unknown values (`email`, `store`, `passwordHash`, `addresses`, `authVersion`, and any other unrecognized keys) are ignored. A target already deleted or outside the selected store behaves as `ACCOUNT_NOT_FOUND`. A super-admin account is protected from ordinary update.

## Response data schemas

### Exact input sources and later request mapping

All self-service selection comes from the current Bearer account and store route; no self-service request accepts userId or a selected store in its body. For editable fields, prefill from the returned DTO, allow the user to edit the documented values, and submit only changed fields on PATCH. GET and DELETE requests have no body. Unknown fields are ignored, while null fails for supplied fields except address contactPhone. There are no client version/idempotency headers in Users.

| Input or retained value | Source | Concrete next call and rule |
| --- | --- | --- |
| Profile name/phone | Typed edits to GET /api/v1/{store}/users/me data.name/data.phone, initially also available as Auth data.user.name/data.user.phone. | PATCH /api/v1/{store}/users/me body name and/or phone. At least one recognized field is required; replace current identity display values with the response. |
| Address label | User-entered label, optionally prefilling existing address data.label. | Address POST/PATCH body label; free text, not a predefined apartment/work/villa enum and not a Checkout field. |
| Address governorate/district/building/street/floor/apartment/details | The address form, prefilling the same keys from the selected returned address. Required/optional/empty-string rules are in the address schema table. | Address POST or PATCH body uses those same names. Floor/apartment/building are strings so values such as Ground or 12A can be represented within their bounds; do not coerce them to numbers. |
| Address contactPhone | Optional user-entered address override, prefilling data.contactPhone rather than effectiveContactPhone. | Send contactPhone:null or an empty string to clear the override; omission on PATCH preserves it. The returned effectiveContactPhone is computed and must not be submitted as an editable field. |
| addressId | Address create/detail data.id, or list data[].id. The address list is a raw array inside data, not data.items. | Use the exact canonical returned lowercase ID in GET/PATCH/DELETE /api/v1/{store}/users/me/addresses/:addressId. Do not use an account ID or an array index. The address validator does not lowercase the input, and the service matches saved address IDs as strings; preserve the returned spelling. |
| Staff userId | Dashboard account detail data.id or account-list data.items[].id. | GET/PATCH/DELETE /api/v1/admin/{store}/users/:userId, or Auth handover body userId where authorized. Self-profile data.id is not a way to select another account for /me. |
| Staff role/status | Current target DTO plus a deliberate staff form choice using the exact accepted enum strings. | Dashboard PATCH body role/status; regular PATCH cannot assign superAdmin or set deleted. Use Auth handover or authorized DELETE for those operations. |
| List page/limit/role/status | Current staff UI pagination/filter choices. | Encode as query strings on GET /api/v1/admin/{store}/users. They are not body fields; omitted status hides deleted accounts, and an empty filter value is not omission. |
| Checkout contact | Current profile name/email plus selected address effectiveContactPhone, or the buyer's confirmed edits. | Explicit customer.name/customer.email/customer.phone in B2C Checkout; the backend does not look up addressId/profile values for you. |
| Checkout address | Selected saved fields plus a current frontend governorate selection. | Map saved keys to address keys, obtain address.governorateCode separately from the selection, and collect a required missing district. There is no saved governorateCode property or automatic label-to-code lookup. |

Address optional string defaults are empty strings on creation. On PATCH, omission preserves an existing value; sending an empty string clears an optional descriptive value, while required label/governorate/building/street reject it. Empty or whitespace contactPhone becomes null. Sending null to district/floor/apartment/details is not the documented clearing operation. Response address keys remain present after clearing.

Address creation is not idempotent: a repeated successful POST creates another address with another ID. On a lost response, reload the current address list and reconcile before retrying. Address DELETE returns data:null; repeating it after success returns ADDRESS_NOT_FOUND. A self-profile or address PATCH has no optimistic version field and can overwrite the same edited field from another tab; fetch current state before editing and use the returned DTO afterward. Staff mutation uses its internal authVersion guard but does not accept an expectedVersion from the frontend. A status/name/phone/role edit invalidates the target's sessions as documented below.

An empty address list is data:[], and an empty staff list is data:{items:[],pagination:{...}}. Requested out-of-range staff pages return an empty items array while preserving the actual matching total/pages; select a valid page. Keep loading, empty, unavailable and error states separate. Session/role failure should stop private requests, while an address/detail 404 should refresh the relevant list without discarding unrelated account state.

### Profile

Both `GET` and `PATCH /users/me` return:

```json
{
  "id": "507f1f77bcf86cd799439011",
  "store": "b2c",
  "name": "Example Customer",
  "email": "customer@example.com",
  "phone": "+201001234567",
  "role": "user",
  "emailVerified": true
}
```

| Field | Type/presence/nullability | Source and meaning | FE retention/use |
|---|---|---|---|
| `id` | String, required, non-null | User Mongo ID as hex | Retain as account ID for UI; cannot select another account for self-service |
| `store` | String (`b2c` or `b2b`), required, non-null | User record and route scope | Retain for matching route context; authorization still comes from token and URL |
| `name` | String, required, non-null | User profile | Retain for display and edit form |
| `email` | String, required, non-null | Immutable normalized account email | Retain for display; this API cannot change it |
| `phone` | String, required, non-null | Normalized current profile phone | Retain for display/contact and as address fallback |
| `role` | String, required, non-null | Current account role | Retain for UI navigation only; server checks role |
| `emailVerified` | Boolean, required, non-null | Derived from `emailVerifiedAt` | Retain for UI state |

Password hash, auth version, address collection, status, and timestamps are omitted.

### Address

Address list data is an array of the same address object returned by get/create/update:

```json
{
  "id": "507f1f77bcf86cd799439022",
  "label": "Home",
  "governorate": "Cairo",
  "district": "Nasr City",
  "building": "12A",
  "street": "Main Street",
  "floor": "2",
  "apartment": "5",
  "details": "Ring the bell",
  "contactPhone": null,
  "effectiveContactPhone": "+201001234567"
}
```

| Field | Type/presence/nullability | Source and meaning | FE retention/use |
|---|---|---|---|
| `id` | String, required, non-null | Embedded address ID as hex | Retain for get/update/delete paths |
| `label` | String, required, non-null | Saved address label | Retain for list/detail display |
| `governorate` | String, required, non-null | Free-form text stored from request | Retain label for legacy display/edit; no automatic shipping-code mapping |
| `district` | String, required, non-null; may be empty | Stored district, default empty string | Retain and display as present |
| `building` | String, required, non-null | Stored building value | Retain and display |
| `street` | String, required, non-null | Stored street value | Retain and display |
| `floor` | String, required, non-null; may be empty | Stored floor, default empty string | Retain and display as present |
| `apartment` | String, required, non-null; may be empty | Stored apartment, default empty string | Retain and display as present |
| `details` | String, required, non-null; may be empty | Stored delivery details, default empty string | Retain and display as present |
| `contactPhone` | String or null, required key | Explicit normalized address override; null means no override | Retain for editing; null/empty input clears it |
| `effectiveContactPhone` | String, required, non-null | Override if set, otherwise the account's current phone | Use as resolved contact number; do not persist as an address override |

The response does not include the owning user ID.

### Staff account

GET by ID, list `items`, and update return the same staff view shape:

```json
{
  "id": "507f1f77bcf86cd799439011",
  "store": "b2c",
  "name": "Example Staff",
  "email": "staff@example.com",
  "phone": "+201001234567",
  "role": "admin",
  "emailVerified": true,
  "status": "active",
  "createdAt": "2026-10-11T10:00:00.000Z",
  "deletedAt": null
}
```

| Field | Type/presence/nullability | Source and meaning | FE retention/use |
|---|---|---|---|
| `id` | String, required, non-null | User Mongo ID as hex | Retain for staff detail/edit/delete routes |
| `store` | String (`b2c` or `b2b`), required, non-null | Account tenant | Retain for displayed context; route still determines scope |
| `name` | String, required, non-null | Profile name | Retain for display/edit |
| `email` | String, required, non-null | Immutable account email | Retain for display; cannot be edited here |
| `phone` | String, required, non-null | Normalized profile phone | Retain for display/edit |
| `role` | String, required, non-null | Current assigned role | Retain for display; regular update cannot set `superAdmin` |
| `emailVerified` | Boolean, required, non-null | Derived from `emailVerifiedAt` | Retain for staff status display |
| `status` | String, required, non-null | Current account lifecycle state | Retain for display/filtering |
| `createdAt` | ISO date-time string, required, non-null | Mongoose creation timestamp | Retain/display if useful; no date filtering API is provided |
| `deletedAt` | ISO date-time string or null, required key | Soft-delete timestamp or null | Retain for deleted-account display; deleted accounts cannot be restored through this API |

`passwordHash`, `authVersion`, and `addresses` are excluded. Deleted accounts appear in list results only with `status=deleted`. Direct get returns deleted account records because its repository query does not filter their status; update and delete treat them as not found. For GET by ID, `ACCOUNT_NOT_FOUND` means that the ID does not exist in the selected store.

List data is:

```json
{
  "items": [
    {
      "id": "507f1f77bcf86cd799439011",
      "store": "b2c",
      "name": "Example Staff",
      "email": "staff@example.com",
      "phone": "+201001234567",
      "role": "admin",
      "emailVerified": true,
      "status": "active",
      "createdAt": "2026-10-11T10:00:00.000Z",
      "deletedAt": null
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

`items` may be empty; `pages` is zero when total is zero. Pagination values are numbers. The API does not return `hasNextPage` or a cursor.

| Field | Type/presence/nullability | Source and meaning | FE retention/use |
|---|---|---|---|
| `items` | Array, required; may be empty | Current result page of staff views defined above | Retain only for current page; replace when filters/page change |
| `pagination` | Object, required | Server-calculated paging summary | Retain to render current page controls |
| `pagination.page` | Integer, required | Requested page or default 1 | Use as current page |
| `pagination.limit` | Integer, required | Requested limit or default 20 | Use as current page size |
| `pagination.total` | Integer, required | Count matching store/role/status filter | Use for result count |
| `pagination.pages` | Integer, required | `ceil(total / limit)` | Use to bound page controls; zero when total is zero |

## Client flows and mutations

### Load and edit a profile

GET `/users/me` after login and retain `id`, display values, and role as needed by the UI. PATCH only the edited `name` and/or `phone`; use the returned profile as the canonical updated client state. Email cannot be changed by this API. Profile changes do not increment auth version or invalidate existing sessions.

### Manage saved addresses

GET the address collection to populate the UI. POST a complete address; retain its returned `id`. PATCH with only changed recognized fields, then replace local address state with the response. To clear a contact phone override send `contactPhone: null` or an empty string. Omitted fields on patch remain unchanged. DELETE removes the address permanently from that user's embedded address list; after success remove it locally or reload the collection. A missing or foreign address ID returns the same 404 `ADDRESS_NOT_FOUND`.

Addresses belong to one account and one selected store. There is no default-address flag, ordering API, address limit, or staff address-management endpoint. These are not implemented business rules and must not be assumed by the frontend.

### Manage dashboard accounts

Admins and super-admins can query the list, inspect an account, and patch allowed profile, role, or status fields. After a successful patch, use the returned full account view. Every successful staff update increments the target's auth version, even when the changed field is only name or phone; the target's existing access and refresh credentials are invalidated and they must sign in again. This applies to the target account; if an admin updates their own account through this dashboard endpoint, their own session is also invalidated. A concurrent update can return 409 `ACCOUNT_CONFLICT`; reload and retry against current state.

Deletion is a super-admin-only soft deletion: the row and email remain stored, status becomes `deleted`, `deletedAt` is set, and auth version increments. The endpoint returns no deleted account object. Existing target credentials stop working. Default staff listings hide the deleted record, while `?status=deleted` can retrieve it. The email remains reserved; deleted accounts cannot be reactivated with the update route and cannot sign in. These operations write audit records atomically with the mutation (`account.updated` or `account.deleted`), including actor, target, changed field names, and before/after role/status. The audit log has no public API in this module.

Super-admin role/status changes and deletion return 409 `SUPER_ADMIN_PROTECTED`; use `/api/v1/admin/{store}/auth/super-admin/handover` for the explicit transfer and consult [Auth handoff](../auth/AUTH_FRONTEND.md). Only one store-assigned super-admin exists. Staff cannot set `superAdmin` through the regular update request.

## Error codes specific to Users

- `ADDRESS_NOT_FOUND` (404): address is absent or does not belong to the current authenticated account in this store.
- `ACCOUNT_NOT_FOUND` (404): account is absent in this store; update/delete also return it for deleted accounts. GET by ID can still return deleted records.
- `ACCOUNT_CONFLICT` (409): target state changed during update/delete; reload before retrying.
- `SUPER_ADMIN_PROTECTED` (409): regular update/delete cannot alter or remove the assigned super-admin.
- `VALIDATION_ERROR` (422): invalid field, ID, query, or empty recognized-field patch.
- `FORBIDDEN` (403): caller's current role cannot use this customer/staff operation.
- `UNAUTHORIZED` (401): missing/invalid token, wrong store, stale session, or inactive account.

## Source and implemented boundaries

This contract was traced through Users routes, controller, validators, profile/address/staff services, repositories and models, Auth middleware and role checks, app mounting, shared response/error handling, and focused Auth HTTP and Users staff tests. Staff updates/deletions rely on Mongo transactions for mutation plus audit atomicity. This module does not implement account search, email changes, bulk actions, audit-history reads, address defaults, address ordering, pagination cursors, or account restoration.

## Prefilling B2C checkout

[Orders](../orders/ORDERS_FRONTEND.md) accepts explicit checkout contact/address snapshots, not an addressId. Map saved governorate, district, building, street, floor, apartment and details to the same keys in checkout.address. The address label is for the account address book and is not a checkout field. Supply address.governorateCode from the frontend’s stable governorate selection; saved free-text governorate labels do not contain that code and the backend does not infer it. Shipping overrides are not a complete governorate directory. Checkout requires district even when the saved address omitted it; ask for the missing value.

Prefill customer.name/email from the current Users/Auth profile and customer.phone from the saved address’s returned effective contactPhone, which already falls back to the current profile phone. The customer may confirm/change these contact values before preview. Checkout does not substitute profile values automatically, save edits to the profile/address book, or attach guest orders to an account by matching email. B2B Forms and Leads use separate implemented APIs; see the linked Leads contract for submission and private tracking.

## Customer Wishlist ownership

The [B2C Wishlist module](../wishlist/WISHLIST_FRONTEND.md) uses the current authenticated customer ID; staff and B2B accounts cannot access another account's list. Blocking or soft-deleting an account invalidates its access through the existing account/session checks. These Users operations do not erase saved Wishlist selections; retained references still protect products from permanent deletion. An account with the same email in B2B has a separate identity and no access to this list. No Users endpoint or DTO changed.

## B2B form rendering and profile prefill

[Forms](../forms/FORMS_FRONTEND.md) now exposes public definitions with protected name/phone/email/governorate/district keys. It returns definitions, not prefilled customer values or a submission resource. The frontend may prefill an authenticated B2B profile's contact details while keeping entered contact data editable. Exact submitted fields, optional account attribution and attachment/tracking behavior are specified in the implemented Leads contract; this module does not attach a guest request by matching email. No Users endpoint or response field changed.

## Staff notification access (2026-10-13)

Current active, confirmed superAdmin/admin/moderator accounts may use the [Notifications dashboard contract](../notifications/NOTIFICATIONS_FRONTEND.md) only for their own store. Current account/session/role checks apply on every request. Customer user accounts and guests cannot read feeds or acknowledge events. Blocking, soft deletion, session invalidation and role demotion remove access according to the existing Auth/Users rules.

The feed is shared by current staff, while read receipts are private to each account and have no expiry/deletion endpoint. Promoting an account to staff gives access to all retained module-era store events, not just future events; without previous receipts, those events are unread. Soft deletion keeps the account ID and earlier receipts; it does not make its personal acknowledgments another staff member's acknowledgments. Users response schemas, address ownership and existing role/deletion rules are unchanged. Reading a notification is separate from Order status changes or Lead contacted actions.

## Shared security and request throttling (2026-10-13)

Every endpoint in this contract participates in the API-wide effective-IP allowance of 240 requests per minute. Requests passing access-JWT authentication also participate in one store/account allowance of 120 requests per minute, shared across protected routes and sessions. Public login/refresh do not use this access-JWT allowance; guests have no stored account key. Earlier validation, IP or authentication failures may prevent later counters from being reached. Existing module limits are additional; see the complete [rate-limit table and response-header contract](../../../../docs/frontend/api-conventions.md).

Any endpoint can therefore return the shared 429 TOO_MANY_REQUESTS error, with no data and the normal success:false/code/message/errors/requestId fields. CORS exposes Retry-After (seconds), RateLimit and RateLimit-Policy to allowed browser origins. Preserve current form, IDs, versions, uploaded-file references and private credentials; pause polling/rapid requests and respect Retry-After. A 429 does not trigger token refresh. Resume using the module's documented safe read/replay rules, rather than assuming all mutations are idempotent. No request or response DTO field was added for limiting, and no limit header is a reusable credential.

These counters are local to the confirmed single Node.js process and reset on restart. Shared counters are required before adding workers/servers. This is application abuse protection; external network/HTTP DDoS filtering and verified proxy configuration remain deployment work. Read the [security report](../../../../docs/security.md) for actual proof and remaining acceptance limits.
