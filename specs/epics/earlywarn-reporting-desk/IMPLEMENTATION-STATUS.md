# earlywarn-reporting-desk (EW) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| EW0 — the spec | ✅ | #3 |
| EW1 — the register | ✅ on stage (#4, #5); prod sign-in still blocked | #5 |
| EW2 — public intake | Code merged (#6, deploy fixed in EW-5); needs `DESK_ENCRYPTION_KEY` seeded | #6 |
| EW3 — cases and clocks | ✅ | #8 |
| EW4 — escalation | Scheduler proven on stage; email needs a domain; prod needs sign-in | #9, EW-9 |
| EW5 — the SRP packet | Merged; field mapping not checked against the portal (EW-G) | #10 |
| EW6 — the front door | | |

## Departures from the design

### Solo mode switched off (EW-2)

The design assumed teams and webhooks were on. The baseline ships with `SOLO_MODE=true`, which hides members, invitations, projects and webhooks, so EW-2 turns it off in the edge, identity, membership and the console build.

### Sign-in has no production path yet (open)

The baseline's stage returns sign-in codes in the API response (`DEBUG_DELIVERY=true`). Prod sends them by email, which needs a verified domain, and no OAuth provider is configured. Until one of those exists nobody can sign in on prod.

### Register routes and the chain (EW-3)

Authenticated routes live under `/desk/` (`/desk/products`, `/desk/settings`, `/desk/escalation`, `/desk/readiness`) rather than directly under the organization, so they cannot collide with baseline routes. Escalation steps store a name and an email rather than a `user_id`: the baseline's member list carries no email address, and a backup need not hold a console login to be alerted. Readiness combines representatives with the chain, whose first two steps are the primary and the backup.

### Disclosure page served by the worker (EW-4)

The design placed the public page in the console. It is served as plain HTML by `desk-worker` at `/disclose/{slug}` on the edge's address, because it must work without JavaScript and without depending on the console build. Routes are `/disclose/{slug}`, `/disclose/{slug}/security.txt`, `/receipt/{token}` and `/v1/public/receipts/{token}`; there is no JSON submission route. Title and product are sealed with the rest of the report instead of stored in clear, and `product_id` is not set at intake: a stranger cannot name a registered product, so triage links it when opening a case in EW3. Spam protection is a per-IP limit of 20 requests a minute at the edge and a hidden field; Turnstile remains optional later.

### The key was declared as required (EW-5)

EW-4 listed `DESK_ENCRYPTION_KEY` under `secretEnv`, so every `desk-worker` lane failed with `Secret not found` before the key existed, and #6 reached `main` with those lanes red. `desk-worker` stayed on its EW-3 build while the edge and migration 210 deployed. EW-5 moves the key to `optionalSecretEnv`, the baseline's form for secrets seeded after deploy.

### Cases as built (EW-6)

Case status is `open` or `closed`; which reports have been filed is tracked by submissions in EW5 rather than by further statuses. A case is opened from a report with `reportId` on `POST /desk/cases` rather than a route under the report. Actions are `/notes`, `/awareness`, `/corrective-measure`, `/acknowledge` and `/close`. See EW-J for the limits of the chain and EW-K for what is stored in clear.

### Escalation as built (EW-7)

The chain starts when a case is opened, not at a backdated awareness, so a late-opened case does not page everyone at once. Deadline reminders send only the latest threshold passed. Each alert is recorded after delivery, not before: a crash may retry, and the notification key and deterministic event id collapse the duplicate, whereas claiming first could lose an alert. Every alert writes an event, so a `webhook` channel on a step restricts nothing: selecting only `webhook` means that step gets no email. Webhook payloads carry the timeline's head hash, a partial answer to EW-J. Scheduled work reads across organizations by design, in two named scheduler queries.

### The report packet (EW-8)

`srp_reference` is optional: ENISA's submission guidance describes a dashboard entry and a confirmation email but mentions no reference number. Stage order follows that guidance's preconditions. Case state does not change on each filing: `desk_submissions` holds it, and the case's `notification_submitted_at` starts an incident's final clock.

### Email alerts and what "sent" means (EW-9)

EW-7 reached stage unable to send email: `notifications-worker` only accepts listed internal callers and `desk-worker` was not listed, and the unit tests mocked that worker. EW-9 adds it, with a test against the real router and validator.

`case.alert_sent` means the alert was handed over, not that it arrived. Without a verified sending domain the provider fails after accepting the request, so an email-only step can show as alerted and reach nobody. Until a domain is verified, chains should include a webhook; see EW-D.
