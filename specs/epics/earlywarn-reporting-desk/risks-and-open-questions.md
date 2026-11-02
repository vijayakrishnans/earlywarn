# earlywarn-reporting-desk — risks and open questions

**RISK** (open, with a mitigation), **RESOLVED** (decided), **ACCEPTED** (a cost we carry knowingly), **SETTLED** (decided for now; revisit on a stated cadence).

## EW-A — The product is mistaken for legal judgement (RISK, mitigated)

Whether something is "actively exploited" or "severe", and when awareness began, are legal judgements with fines of up to €15m or 2.5% of turnover behind them. Earlywarn records a human's decision, labels its clocks as derived from that decision, and states in the UI and terms that it is not legal advice. Get the copy and terms reviewed by a lawyer before charging anyone.

## EW-B — Manual submission remains (SETTLED; revisit when ENISA publishes an API)

The SRP launched without an API and the Cloud Security Alliance reports no committed date for one. Earlywarn prepares and records and a person submits. CRACI says it submits on customers' behalf; how is not described. Revisit on ENISA's SRP status page each quarter.

## EW-C — A crowded, price-compressed market (RISK, the largest)

CVD Portal offers free hosted intake and describes free Article 14 reporting; CRAdar, Musterproof, CRACI and Venvera all sit nearby. Reminders are not unique, and a rival could add an escalation chain quickly. Absence of paging from competitors is read from their marketing pages only. Mitigation: ship EW4 before any wider work, and talk to ten target teams before building paid plans. If they say email reminders are enough, stop or reposition.

## EW-D — Email needs a verified domain (RISK)

The baseline's notifications send through Cloudflare Email Service, which needs a sending domain with DKIM and SPF. `earlywarn.app` is a placeholder until someone owns a domain. Until then, EW4's email half cannot be proven on prod; signed webhooks can.

## EW-E — We hold customers' unpatched vulnerabilities (RISK, mitigated)

The service becomes an attractive target. Application-level encryption, minimal reporter data, no contents in webhooks or notification bodies, and audit on every read of a report. Confirm where D1 stores data; EU customers will ask, and the baseline may need an EU jurisdiction setting before prod holds real reports.

## EW-F — Pricing is unknown (RESOLVED for this release)

No paid plans in the first release. Working hypothesis to test: free for one product with email only, about €79 a month for escalation and evidence export, between CRAdar's listed $49 per product and Musterproof's $149.

## EW-G — The field catalogue goes stale (RISK, mitigated)

The SRP reached v1.2.1 on 20 October 2026 and ENISA says its documentation is still being updated. The catalogue carries a version and retrieval date. The stage mapping came from a text extraction of ENISA's table and must be checked against the original page and user manual in EW5.

## EW-H — Scope of the regulation (ACCEPTED)

The duty falls on manufacturers of products with digital elements; pure SaaS is generally not the customer, and stewards' duties begin on 11 December 2027. That narrows the market to downloadable software and devices, which is the buyer we want.

## EW-I — Demand is unvalidated (ACCEPTED, for now)

The strongest public data is ENISA's survey: 194 self-selected responses, not representative, showing weak incident response and only 13% with good understanding of documentation requirements. No customer has been interviewed. Building a first release before interviews is a deliberate, low-cost choice; charging before them is not.

## EW-J — What the hash chain can and cannot prove (ACCEPTED, for now)

The chain shows that an exported timeline has not been edited or reordered, and the case page flags a broken chain. It cannot show that the newest events were not deleted, and someone with database access could rebuild the whole chain. Rows are append-only by code path, not by database trigger: the migration runner splits files on every top-level semicolon and cannot apply a trigger body. Anchoring the head hash somewhere outside this database, such as in each email or webhook alert, would close most of the gap, and EW5's export carries the head hash so a customer's saved copy can serve that role.

## EW-K — Case titles and notes are stored in clear (RISK, mitigated)

Report contents are sealed, but case titles and timeline notes are not, because they must stay readable by the scheduler and form part of the hash. The console tells people to keep titles free of exploit detail. Sealing notes while hashing their ciphertext is a sensible follow-up before prod holds real cases.
