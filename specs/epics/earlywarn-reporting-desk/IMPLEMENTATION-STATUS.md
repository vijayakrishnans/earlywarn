# earlywarn-reporting-desk (EW) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| EW0 — the spec | ✅ | #3 |
| EW1 — the register | | |
| EW2 — public intake | | |
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
