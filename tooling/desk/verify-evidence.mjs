#!/usr/bin/env node
// Checks an Earlywarn evidence export on your own machine: no account, no network,
// no dependencies. Usage: node verify-evidence.mjs export.json
//
// It recomputes every timeline hash, and each recorded submission's hash on that
// timeline. It proves the file is internally unaltered. It cannot prove the newest
// events were not removed before export: compare headHash with a fingerprint from
// an earlier alert or a saved export for that.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const GENESIS = "0".repeat(64);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function canonicalFields(fields) {
  return JSON.stringify(Object.fromEntries(Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}

export function verify(evidence) {
  const problems = [];
  let prev = GENESIS;
  evidence.events.forEach((event, index) => {
    const label = `event ${index + 1}`;
    if (event.seq !== index + 1) problems.push(`${label}: out of sequence`);
    if (event.prevHash !== prev) problems.push(`${label}: does not follow the event before it`);
    const canonical = JSON.stringify({
      actor: event.actor,
      caseId: evidence.case.internalId,
      occurredAt: event.occurredAt,
      payload: event.rawPayload,
      seq: event.seq,
      type: event.type,
    });
    if (sha256(`${prev}\n${canonical}`) !== event.hash) problems.push(`${label}: contents do not match its hash`);
    prev = event.hash;
  });
  if (evidence.headHash !== prev) problems.push("headHash does not match the last event");

  for (const submission of evidence.submissions) {
    const recorded = evidence.events.find(
      (e) => e.type === "case.submission_recorded" && JSON.parse(e.rawPayload).stage === submission.stage,
    );
    if (!recorded) {
      problems.push(`${submission.stage}: not on the timeline`);
    } else if (JSON.parse(recorded.rawPayload).fieldsHash !== sha256(canonicalFields(submission.fields))) {
      problems.push(`${submission.stage}: fields do not match the hash on the timeline`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node verify-evidence.mjs export.json");
    process.exit(2);
  }
  const problems = verify(JSON.parse(readFileSync(path, "utf8")));
  if (problems.length > 0) {
    console.error(`NOT VERIFIED\n${problems.map((p) => `- ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log("VERIFIED: the timeline and recorded submissions are unaltered.");
}
