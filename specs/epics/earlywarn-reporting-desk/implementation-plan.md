# earlywarn-reporting-desk — implementation plan

Milestones land in order. Each is one or more tasks, each task one pull request. A milestone is marked ✅ here when its "done when" list is true, and recorded in `IMPLEMENTATION-STATUS.md`.

## EW0 — the spec

This doc set, merged to `main`.

**Done when**
- the five documents are on `main`
- `task_get earlywarn-reporting-desk` shows the epic with EW0–EW6, and `EW-1` reads `done`

## EW1 — the register

New `apps/desk-worker` wired behind `api-edge`; migrations for products, settings and escalation steps; products, settings and readiness surfaces.

**Done when**
- the worker's `/health` answers on stage and prod through the edge
- migrations are applied on stage and prod
- a member of another organization gets `not_found` on these routes, by test
- a new workspace can turn its readiness checklist green in the stage console

## EW2 — public intake

Disclosure page, public report route with encryption at rest and KV rate limiting, receipt token, `security.txt`, triage list.

**Done when**
- an unauthenticated submission on stage appears in triage for that organization only
- the stored row holds ciphertext, by test
- the receipt returns status and no contents
- `security.txt` validates against RFC 9116's required fields
- the rate limit answers `rate_limited`, by test

## EW3 — cases and clocks

Cases, recorded awareness, computed deadlines, hash-chained timeline, case page.

**Done when**
- the deadline table in `design.md` is covered by tests for both case kinds, including a corrective measure arriving late and a backdated `aware_at`
- a concurrent append produces one winner and a retry, by test
- changing any stored event makes chain verification fail, by test
- a case can be opened from a report and from nothing on stage

## EW4 — escalation

Acknowledgement, chain editor, per-minute scheduler, email and signed webhook delivery, test alert.

**Done when**
- on prod, an unacknowledged test case alerts step one, then reaches step two after its delay, with no human action
- acknowledging stops the chain and deadline reminders continue
- re-running a scheduler tick sends nothing twice, by test
- a webhook payload contains no report contents, by test
- each alert appears on the case timeline

## EW5 — the SRP packet

Field catalogue, packet view per stage, missing-required check, submission record, evidence export with an offline verifier.

**Done when**
- catalogue tests cover every field in the glossary for each stage and case kind
- a seeded case of each kind is walked through all three stages on stage
- recording a stage out of order answers `stage_out_of_order`
- the exported JSON verifies with the documented script, without an account, and fails after any edit

## EW6 — the front door

Landing page, onboarding to a published disclosure page, sample case, terms-of-use note stating what the product does not do.

**Done when**
- a fresh sign-up on prod reaches a published disclosure page in under ten minutes
- the sample case cannot alert anyone outside the workspace or be mistaken for a real one
- the landing page states plainly that Earlywarn does not file on the customer's behalf

## Sequencing note

EW1 gives every later milestone its products and people. EW3 needs no intake but EW2 is smaller and gives cases a real source. EW4 needs EW3's deadlines and needs a verified email domain to deliver email; until then webhooks prove the chain on stage. EW5 could run beside EW4. EW6 comes last so it describes what exists.
