# Epic: earlywarn-reporting-desk (EW)

**Since 11 September 2026, makers of software and connected products sold in the EU must warn ENISA's Single Reporting Platform within 24 hours of becoming aware of an actively exploited vulnerability or a severe incident, yet a two-to-twenty-person team has no on-call security function and the platform has no API. Earlywarn makes a missed deadline hard: a named person records the moment of awareness, the deadlines are fixed from it, and an escalation chain keeps going until a human acknowledges, ending in a stage-by-stage packet ready to enter by hand and a tamper-evident record of what happened.**

Earlywarn is for small manufacturers without a security team: firmware and device makers, plugin authors, downloadable and self-hosted software vendors. When it ships, such a team can publish a disclosure page, receive a report at 3am, have someone reliably reach the right person, and produce proof of what was known and when.

Earlywarn does not decide whether something is reportable and does not file on the customer's behalf. It is not legal advice.

## Status

| Field | Value |
|-------|-------|
| Status | In progress |
| Cluster | **EW** (EW0–EW6) |
| Owner(s) | `apps/desk-worker` (the resource) · `packages/db` + `packages/contracts` + `packages/sdk` (the wire) · `apps/web-console-next` (the surface) |
| Builds on | `cirrus-baseline baseline-v27` — identity, membership, RBAC, audit, notifications, webhooks, billing |
| Changes | Adds one bounded-context Worker and its console surfaces; baseline contexts are consumed, not altered |
| Decisions locked | (1) A human records awareness; the product never infers it. (2) No filing on the customer's behalf until ENISA ships an API. (3) Escalation is the differentiator; intake is table stakes. (4) Cloudflare only. |
| Gate | EW1 is the first user-visible change. EW4 is the first release worth showing a customer. |
| Shipped as | |

## Read order

1. `design.md` — the resources, routes, surfaces and what is out of scope
2. `implementation-plan.md` — the milestones and what "done" means for each
3. `risks-and-open-questions.md` — what could go wrong and what was decided
4. `IMPLEMENTATION-STATUS.md` — what actually shipped

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| EW0 — the spec | this doc set | merged to `main`; the epic and its milestones read back from `task_get` |
| EW1 — the register | products, EU markets, coordinating CSIRT, primary and backup representatives | a workspace sees its readiness checklist turn green on stage |
| EW2 — public intake | hosted disclosure page, `security.txt`, reporter receipt | a stranger submits a report and it appears in triage |
| EW3 — cases and clocks | triage, recorded awareness, 24h/72h/final deadlines, hash-chained timeline | deadlines are correct by test for both case types |
| EW4 — escalation | acknowledgement, chain, email and signed webhooks | an unacknowledged case reaches the backup on prod with no human action |
| EW5 — the SRP packet | stage-specific fields, missing-field check, submission record, evidence export | a seeded case is walked through all three stages; its export verifies offline |
| EW6 — the front door | landing page, onboarding, sample case | a new sign-up reaches a published disclosure page in under ten minutes |
