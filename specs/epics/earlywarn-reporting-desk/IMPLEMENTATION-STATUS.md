# earlywarn-reporting-desk (EW) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| EW0 — the spec | ✅ | #3 |
| EW1 — the register | ✅ on stage (#4, #5); prod sign-in still blocked | #5 |
| EW2 — public intake | Code merged (#6, deploy fixed in EW-5); needs `DESK_ENCRYPTION_KEY` seeded | #6 |
| EW3 — cases and clocks | | |
| EW4 — escalation | | |
| EW5 — the SRP packet | | |
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
