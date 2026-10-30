# Customer email delivery infrastructure

Last checked against the email delivery worker, queue model/repository, environment parser, sender, lifecycle scheduler, and Orders/Leads event sources on 2026-10-13. This is internal delivery infrastructure, not a resource API. It has no HTTP controller, route, request validator, or customer/staff CRUD endpoint. Business events remain owned by the existing Orders and Leads modules and are enqueued through the infrastructure inside their existing transactions.

Read this with [shared API conventions](../../../../../docs/frontend/api-conventions.md), [B2C Orders](../../../modules/orders/ORDERS_FRONTEND.md), and [B2B Leads](../../../modules/leads/LEADS_FRONTEND.md). Public response envelopes and DTOs are unchanged; no email delivery state is exposed to frontend clients.

## What sends an email

When delivery is enabled for a side, the worker sends one plain-text notification for each of these committed events:

| Store | Internal event | When enqueued | Recipient snapshot | Notification language |
| --- | --- | --- | --- | --- |
| B2C | <code>order.placed</code> / status <code>pending</code> | On the first successful order placement. | Email in the order's immutable checkout customer snapshot. | Locale selected when the order was placed, persisted internally as <code>notificationLocale</code>. |
| B2C | <code>order.status</code> | On every actual permitted order status change: <code>accepted</code>, <code>shipped</code>, <code>delivered</code>, <code>canceled</code>, or <code>returned</code>. Pending is the initial placement event; no transition returns to pending. | The same order customer email snapshot. | Original order <code>notificationLocale</code>, not staff request language. |
| B2B | <code>lead.submitted</code> / status <code>submitted</code> | On first successful lead submission. | Submitted normalized <code>contact.email</code>, only when it exists. | Locale of original successful submission, persisted internally as <code>notificationLocale</code>. |
| B2B | <code>lead.contacted</code> / status <code>contacted</code> | On the first actual transition from submitted to contacted. | Same submitted lead contact email, only when it exists. | Original submission locale, not staff request language. |

The recipient comes from the resource's saved customer/contact data, never a current account profile or staff address. Leads email remains optional. No lead email job is inserted when contact email is absent. No staff email, push notification, SMS, account-email-change notification, or separate recovery email is part of this infrastructure. Staff dashboard arrivals are implemented separately in [Notifications](../../../modules/notifications/NOTIFICATIONS_FRONTEND.md). The SMTP sender also supports existing Auth one-time codes; that Auth flow is separate from this notification queue.

The event is enqueued only after business logic produces its accepted event, and it shares the same MongoDB transaction as the order/lead change. A queue insertion failure aborts and rolls back that business transaction. If email is disabled for that store, or the event has no recipient, enqueue is a no-op. No job is created for events missed while delivery was disabled, and enabling delivery later does not backfill old events. Replaying a successful order placement or an already-contacted lead does not enqueue another event. A unique queue key also prevents inserting the same <code>(store, resourceId, event, resourceStatus)</code> event twice.

An enqueued job does not mean SMTP has sent it. Email send failures happen after the business transaction commits and do not roll back the business event. A successful Orders/Leads response means the order/lead event committed; it does not promise email delivery. The public Order and Lead DTOs do not include <code>notificationLocale</code>, queue state, attempt count, SMTP error, or sent time.

## Per-store enablement and safe configuration

Delivery is enabled independently for <code>b2c</code> and <code>b2b</code>. A side is enabled only when SMTP configuration and that side's tracking-link template are both present.

| Side | Tracking template key |
| --- | --- |
| B2C | <code>B2C_TRACKING_URL_TEMPLATE</code> |
| B2B | <code>B2B_TRACKING_URL_TEMPLATE</code> |

SMTP uses <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code>, <code>SMTP_FROM</code>, and optional <code>SMTP_PORT</code>. A non-empty host requires user, password, and from-address. Port defaults to 587 and must be an integer from 1 through 65535. Port 465 selects implicit TLS; other ports require TLS. If either side's link template is configured but SMTP is absent, environment validation fails at startup. SMTP without a side's template can still serve other configured email uses, but notifications for that side are disabled.

Each template must be a valid HTTP(S) URL with exactly one <code>{id}</code> placeholder and exactly one <code>{token}</code> placeholder. The token placeholder must be in the URL fragment, after <code>#</code>; it must not be in the path/query sent to the frontend web server. The origin must stay constant when {id} changes; unmatched braces and other placeholders are rejected. URL user-info/password is rejected, and other unrecognized brace placeholders are rejected. Production requires HTTPS; non-production may use HTTP. The backend substitutes the resource ID and token into the configured string. It does not choose or verify the site route, render the frontend, or test the link.

Synthetic template examples:

~~~text
https://shop.example.test/orders/tracking/{id}#token={token}
https://shop.example.test/requests/tracking/{id}#token={token}
~~~

Use the actual frontend routes agreed for each application. Do not put real tokens, SMTP credentials, or private mailbox addresses in committed examples or logs. No environment values or provider credentials are documented here.

An empty token is possible for an authenticated customer's email. The frontend must treat an empty fragment value as “no guest bearer token”: if the customer is signed in to the matching store, load the resource through the authenticated account endpoint; otherwise show sign-in and preserve the resource ID for after sign-in. For a guest email with a non-empty token, read the token from the fragment and send it only in the resource-specific tracking header:

| Side | Guest tracking read | Authenticated account fallback |
| --- | --- | --- |
| B2C Orders | <code>GET /api/v1/b2c/orders/tracking/:orderId</code> with <code>X-Order-Token</code> | <code>GET /api/v1/b2c/orders/:orderId</code> with B2C user bearer token |
| B2B Leads | <code>GET /api/v1/b2b/leads/tracking/:leadId</code> with <code>X-Lead-Token</code> | <code>GET /api/v1/b2b/leads/:leadId</code> with B2B user bearer token |

The token belongs in the browser fragment so it is not sent in the initial HTTP request for the frontend page. The frontend should avoid retaining it in analytics, application logs, referrer data, or shared caches. Follow Orders and Leads for response DTOs, credential handling, and expiry rules.

Guest tracking credentials expire 90 days after order placement or lead submission. An already-delivered original link remains valid until original expiry, including after JWT/HMAC secret rotation, because the tracking endpoint compares the submitted token to its stored hash. Rotation prevents the worker from recomputing a matching guest token for a later notification. If the source still exists but the worker cannot produce a valid link, it still sends event details without a link and tells the recipient to use a saved link if it has not expired or contact staff. It never sends a newly generated invalid replacement link or extends tracking expiry. An authenticated customer's resource can be read through account APIs even when the template token is empty.

## Message content

The worker creates one text-only message; there are no attachments or HTML templates in this slice. Subject is <code>Narmer - Order update</code> for B2C and <code>Narmer - Request update</code> for B2B, with Arabic subject equivalents when the saved notification locale is Arabic. Body is composed from saved locale and event:

- Greeting with name read from the current resource snapshot.
- A received confirmation for <code>order.placed</code> and <code>lead.submitted</code>; other events say an update was recorded.
- Resource reference, event's recorded status, and event timestamp in ISO-8601 form. B2C uses the persisted `orderNumber` when present and falls back to the MongoDB Order ID for existing unnumbered Orders. B2B keeps its Lead ID. Tracking links and queue resource IDs always retain the MongoDB ID; a readable reference does not grant access.
- B2C Orders only: order total formatted as EGP from the stored integer amount in minor units. No bank/payment verification claim is made.
- For <code>canceled</code> or <code>returned</code> B2C statuses, a sentence says staff handles any refund offline. It does not claim that a refund has been issued.
- If a valid link is available, a “Track the latest status” link and a warning to keep it private.
- If no valid link can be produced, a localized note says to use a saved unexpired link or contact staff.

The status and timestamp in an email describe the queued event. Delivery may be delayed, and the resource can have a later status by the time the recipient opens the email. The link is intended to show the latest status available through the applicable tracking/account read.

The worker looks up the current resource before rendering. For Orders it reads customer name and total plus whether a guest tracking token is still reproducible; for Leads it reads contact name and whether a guest tracking token is reproducible, or whether an authenticated customer can use the account path. It does not attach order proof images, lead images, receipts, bank details, or full form answers.

## Internal queue record

The queue is a MongoDB collection with a unique event key on <code>(store, resourceId, event, resourceStatus)</code> and a worker-selection index. Queue records have timestamps and no TTL. These fields are internal and are not frontend request or response fields.

| Field | Type and nullability | Meaning |
| --- | --- | --- |
| <code>store</code> | Enum string: <code>b2c</code> or <code>b2b</code> | Selects resource source and per-store enablement/template. |
| <code>resourceId</code> | Mongo ObjectId | Order or Lead ID. |
| <code>event</code> | Enum string: <code>order.placed</code>, <code>order.status</code>, <code>lead.submitted</code>, or <code>lead.contacted</code> | Committed business event. |
| <code>resourceStatus</code> | String | Event status: one of six Order statuses or <code>submitted</code>/<code>contacted</code> for Leads. |
| <code>eventAt</code> | Date | Business transition time, not later SMTP send time. |
| <code>to</code> | String email address | Recipient copied from Order customer data or submitted Lead contact. It is one mailbox, not a list. |
| <code>locale</code> | Enum string: <code>en</code> or <code>ar</code> | Locale selected at order placement or lead submission. |
| <code>state</code> | Enum string, default <code>pending</code> | One of <code>pending</code>, <code>sending</code>, <code>sent</code>, <code>failed</code>, or <code>skipped</code>. |
| <code>attempts</code> | Integer, default 0 | Number of times a worker claimed the job; a claim increments it. |
| <code>nextAttemptAt</code> | Date | Earliest pending retry time; initially the event time. |
| <code>leaseId</code> | String or null | Random claim identifier that prevents a stale worker from finishing a reclaimed lease. |
| <code>leaseUntil</code> | Date or null | Claim expiry, two minutes after claim. |
| <code>sentAt</code> | Date or null | Time worker recorded a successful sender return. |
| <code>lastCode</code> | String or null | Stable reason: <code>SOURCE_UNAVAILABLE</code>, <code>DELIVERY_FAILED</code>, or <code>LEASE_EXPIRED</code>. Never stores provider response text or credentials. |
| <code>createdAt</code>, <code>updatedAt</code> | Dates | Mongoose timestamps. |

No raw tracking token, rendered URL, SMTP username/password, message body, access key, or provider credential is persisted in the queue. The worker reconstructs a link from the resource and current configuration immediately before sending.

## Worker schedule, leases, retries, and delivery guarantees

When SMTP and at least one side's template are configured, the server starts an unreferenced interval that calls the worker every 60 seconds. It does not run immediately at process startup. An in-process guard prevents overlapping drains in one server process. Each drain processes at most 20 jobs and processes enabled stores only. Multiple app instances coordinate through an atomic database claim and a two-minute lease. Jobs are considered in due-time/creation order.

A worker claims a pending due job or a sending job whose lease expired, sets it to <code>sending</code>, assigns a new random lease ID, sets <code>leaseUntil</code> two minutes ahead, and increments attempts. The worker then reads the current Order/Lead, builds the localized message, and calls SMTP. SMTP connection, greeting, and socket timeouts are each 10 seconds.

On sender success, the worker records <code>sent</code>, <code>sentAt</code>, clears the lease, and clears <code>lastCode</code>. If the source Order/Lead no longer exists, the job becomes <code>skipped</code> with <code>SOURCE_UNAVAILABLE</code>; this is not retried. If the source exists but a guest token is expired/unavailable or cannot be reconstructed after secret rotation, the email still sends without a tracking URL as described above.

On a processing/send failure, the worker records <code>DELIVERY_FAILED</code> and schedules automatic retry after 1, 2, 4, then 8 minutes. The fifth claimed attempt is the final automatic attempt and becomes <code>failed</code>; no sixth automatic send occurs. If a worker disappears with a lease, another worker may reclaim it after two minutes. A reclaimed job with five attempts is marked <code>failed</code> with <code>LEASE_EXPIRED</code> instead of being claimed again. Queue records, including failed/skipped/sent records, are retained; no automated pruning is configured.

A manual CLI retry resets failed jobs to pending with attempt count zero and due time now for currently enabled stores, then drains the queue:

~~~powershell
npm run notifications:deliver -- --retry-failed
~~~

Run this through the normal server operations process. It does not retry <code>skipped</code> jobs, backfill events never enqueued, or create a new event. The command requires normal runtime configuration and database access; it is not a public API.

This is at-least-once delivery, not exactly-once email. SMTP can accept a message while the worker loses its lease or fails to persist the <code>sent</code> update. A later attempt may send a duplicate. Slow/concurrent workers and per-job retries can also cause later resource states to arrive before earlier ones. The database lease prevents stale workers from overwriting a newer claim's queue state, but it cannot retract a message SMTP already accepted. The email identifies the event status/time and links to the latest resource state.

## Operational failures and scope limits

SMTP setup is validated at configuration load; successful parsing does not prove the host, account, sender domain, or delivery reputation works. Nodemailer send failures are caught by the worker, recorded for retry, and logged with a delivery ID only. Scheduler-level failures log a deferred event without exception details. The standalone command logs only its stage on failure. This delivery path does not log raw tokens, URLs, SMTP secrets, message bodies, or recipients.

If a business transaction cannot insert its enabled email event, that business operation fails and rolls back atomically. If the later SMTP send fails, the business operation remains committed and the internal queue retries independently. A returned resource DTO does not report whether a message is pending, sent, failed, or skipped. There is no frontend polling/retry endpoint; operators may inspect internal logs/queue through approved tools and manually retry failed jobs with the CLI above.

No template-management dashboard, staff/customer email-delivery-status screen, email preferences/opt-out model, marketing email, staff email notification, Web Push, SMS, or general email queue API is implemented. Email is limited to the configured transactional Order and Lead events described here. The separate staff dashboard feed does not report SMTP delivery state.

## Verification status

Source inspection establishes event insertion points, transaction placement, queue indexes/fields, worker schedule/retry rules, SMTP settings, and message composition. It does not establish real SMTP delivery or frontend browser behavior. Do not claim production sender verification without a separately authorized provider test.

Seven focused email tests and six lifecycle tests passed. The full local suite passed 143 tests, with two opt-in MongoDB tests skipped. The dedicated authorized MongoDB email test passed, using real queue/Order/Lead repositories and transactions with controlled catalog collaborators and mocked SMTP. Its disposable database cleanup was verified. Checks covered queue/business rollback, replay and transition deduplication, initial locale, competing workers, lease ownership/reclaim, retry limits and key-rotation fallback. Follow-up independent source review found no remaining actionable issue. The reviewer’s restricted loopback test attempt was environment-limited; the main authorized HTTP regression run passed.

Safe configuration inspection confirmed SMTP present and both tracking templates unset, so customer delivery remains disabled. No live mail was sent. Staff dashboard arrivals are implemented independently; web push and lost-link recovery remain deferred.

## Dashboard arrival integration (2026-10-13)

The application composes two separate handlers on the existing Order/Lead event hook: staff Notifications first, then this customer email queue. Both use the caller's business transaction. First placement/submission creates a sparse staff arrival and any eligible customer email job atomically. If either insertion fails, neither remains committed and the business change rolls back.

Status/contact events create only the existing eligible customer email jobs, not additional arrival rows. Customer delivery disabled by SMTP/templates or missing optional Lead email does not disable the staff feed. Staff mark-as-read APIs do not inspect/reset email jobs, retry SMTP or update Order/Lead state. The existing notifications:deliver command still drains only customer email jobs.

The expanded combined database proof is available as npm --prefix server run test:db:notifications or test:db:emails; both aliases run the same asserted disposable-database test with mocked SMTP. It passed staff/email/business rollback, source replay, actual personal feed queries and competing delivery leases. This does not prove live SMTP inbox arrival or deployed frontend polling.

## Order-history actor scope

The Order `history[].actor` name/role snapshot is staff-only response data. Transactional customer emails keep the order-number/legacy-ID reference and existing ID/token tracking link; they do not include staff names, roles or history actor snapshots. The queue and B2B references are unchanged.
