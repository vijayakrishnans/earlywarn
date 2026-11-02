# earlywarn-reporting-desk — design

Everything new lives in one bounded context, `apps/desk-worker`, behind `api-edge`. Tables carry the `desk_` prefix, as the baseline's D1 boundary requires. Timestamps are ISO-8601 UTC text.

## 1. The resource

Reused from the baseline: users, organizations, memberships and RBAC, the audit trail, notifications, outbound webhooks, billing.

```
desk_products          prd_…   org_id, name, type, versions_note, support_ends_on, member_states (JSON)
desk_settings          one per org: public_slug, policy_text, main_establishment_state, coordinating_csirt,
                       triage_target_minutes (default 240), disclosure_published_at
desk_escalation_steps  esc_…   org_id, position, user_id, after_minutes, channels (JSON: email, webhook)
desk_reports           rpt_…   org_id, product_id?, title, body_ciphertext, reporter_contact_ciphertext?,
                       receipt_hash, status (new|triaged|duplicate|rejected), received_at
desk_cases             cas_…   org_id, report_id?, product_id, kind (vulnerability|incident), title,
                       status (open|early_warning_sent|notified|final_sent|closed),
                       aware_at, aware_recorded_by, corrective_available_at?,
                       early_warning_due_at, notification_due_at, final_due_at?, acknowledged_at?
desk_case_events       evt_…   case_id, seq, type, actor, payload (JSON), occurred_at, prev_hash, hash
                       UNIQUE (case_id, seq)
desk_submissions       sub_…   case_id, stage (early_warning|notification|final), fields (JSON),
                       srp_reference?, submitted_at, submitted_by
```

**Deadlines** (from the Commission's CRA reporting page):

| Stage | Vulnerability | Severe incident |
|---|---|---|
| Early warning | `aware_at` + 24h | `aware_at` + 24h |
| Notification | `aware_at` + 72h | `aware_at` + 72h |
| Final report | `corrective_available_at` + 14 days, unset until then | notification submission + 1 month |

`aware_at` is always entered by a named user, may be earlier than the entry time, and can only be corrected through a new timeline event that keeps the original.

**The hash chain.** `hash = sha256(prev_hash || canonical_json(event))`. D1 has no interactive transactions, so an append reads the head, computes the hash and inserts at `seq + 1`; `UNIQUE (case_id, seq)` turns a race into a retry. Case-state changes and their event go in one atomic `batch()`.

**Sensitive fields.** Report bodies and reporter contact details are encrypted in the application with AES-GCM under a per-environment secret. They contain unpatched vulnerability details.

## 2. The API

Envelopes follow the baseline's `{ data, meta }` shape. Authenticated routes are under `/v1/organizations/{org}` and require membership; writes require an admin or responder role.

```
GET|POST        /products            GET|PATCH|DELETE /products/{id}
GET|PUT         /desk/settings       GET              /desk/readiness
GET|PUT         /desk/escalation
GET             /reports             GET|PATCH        /reports/{id}
POST            /reports/{id}/case
GET|POST        /cases               GET              /cases/{id}
POST            /cases/{id}/acknowledge
POST            /cases/{id}/events
PATCH           /cases/{id}/corrective-measure
GET             /cases/{id}/packet/{stage}
POST            /cases/{id}/submissions
GET             /cases/{id}/export
```

Public, no account, rate limited:

```
GET   /v1/public/disclose/{slug}              policy and form metadata
POST  /v1/public/disclose/{slug}/reports      returns a one-time receipt token
GET   /v1/public/receipts/{token}             acknowledgement status only, never contents
GET   /v1/public/disclose/{slug}/security.txt RFC 9116
```

Errors: `not_found`, `forbidden`, `validation_failed`, `rate_limited`, `stage_out_of_order`, `chain_conflict`.

## 3. The console

- **Readiness** — products, markets, CSIRT, representatives, escalation chain, published policy. Each item links to its fix.
- **Products** and **Escalation** — plain settings pages, plus a "send test alert" action.
- **Triage** — incoming reports by age against the triage target.
- **Case** — three countdowns, acknowledge button, timeline, packet per stage.
- **Packet** — each SRP field labelled as ENISA labels it, with copy buttons and required fields still missing. A clear note says submission happens in the SRP portal.
- **Public disclosure page** — server-rendered, works without JavaScript.

## 4. Events, secrets, and integrations

**Scheduler.** A Cron Trigger on `desk-worker` runs every minute: finds open cases past a stage's escalation thresholds (50%, 75%, 90% of the window, then overdue) or unacknowledged past a chain step, and dispatches idempotently, keyed on `(case, stage, threshold, step)`.

**Channels.** Email through `notifications-worker`; signed webhooks through `webhooks-worker` with `case.opened`, `case.escalated`, `case.deadline_approaching`, `case.overdue`, `report.received`. Webhook payloads never include report contents. Slack and PagerDuty are reached through documented webhook recipes.

**Secrets.** `DESK_ENCRYPTION_KEY` per environment. Optional Turnstile keys on the public form. Sending email requires a verified domain (see EW-D).

**SRP fields.** A versioned catalogue in `packages/contracts` transcribed from ENISA's SRP Glossary, for SRP v1.2.1, with each field's id, label, applicability and requirement per stage. Early warning, for example, requires notification type, title, summary, manufacturer, Member States, product name and version, and the awareness timestamp.

## 5. Out of scope

- Automatic filing to the SRP, which has no API (EW-B).
- Deciding whether something is reportable (EW-A).
- SBOM generation, component scanning, Annex VII technical documentation and conformity assessment: Musterproof, CRAdar, FOSSA and others cover these, and Earlywarn is meant to sit beside them.
- SMS and voice paging: reached through a webhook to the customer's paging tool.
- Inbound `security@` email parsing: a follow-on that needs a customer DNS step.
- Paid plans: the baseline's billing stays unconfigured until customer conversations set the price (EW-F).
