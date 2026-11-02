import { DESK_CASE_KINDS, type PublicDeskCase, type PublicDeskCaseEvent } from "@saas/contracts/desk";
import type { DeskCase, DeskCaseEvent, DeskCaseKind, DeskRepository } from "@saas/db/desk";
import { GENESIS_HASH, hashEvent, verifyChain } from "./chain.js";
import { computeDeadlines } from "./clocks.js";
import { exportEvidence, handlePacket, recordSubmission } from "./packet.js";
import { fail, invalid, notFound, ok } from "./http.js";
import {
  casePublicId,
  orgPublicId,
  parseCaseId,
  parseProductId,
  parseReportId,
  productPublicId,
  reportPublicId,
} from "./ids.js";

const KINDS: ReadonlySet<string> = new Set(DESK_CASE_KINDS);
const MAX_APPEND_ATTEMPTS = 5;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function toCase(c: DeskCase): PublicDeskCase {
  return {
    orgId: orgPublicId(c.orgId),
    kind: c.kind,
    title: c.title,
    status: c.status,
    awareAt: c.awareAt,
    awareRecordedBy: c.awareRecordedBy,
    correctiveAvailableAt: c.correctiveAvailableAt,
    notificationSubmittedAt: c.notificationSubmittedAt,
    earlyWarningDueAt: c.earlyWarningDueAt,
    notificationDueAt: c.notificationDueAt,
    finalDueAt: c.finalDueAt,
    acknowledgedAt: c.acknowledgedAt,
    acknowledgedBy: c.acknowledgedBy,
    isSample: c.isSample,
    createdAt: c.createdAt,
    id: casePublicId(c.id),
    productId: c.isSample ? "prd_sample" : productPublicId(c.productId),
    reportId: c.reportId ? reportPublicId(c.reportId) : null,
  };
}

function toEvent(e: DeskCaseEvent): PublicDeskCaseEvent {
  return {
    seq: e.seq,
    type: e.type,
    actor: e.actor,
    payload: JSON.parse(e.payload) as Record<string, unknown>,
    occurredAt: e.occurredAt,
    prevHash: e.prevHash,
    hash: e.hash,
  };
}

/** A past-or-present instant, normalised to UTC. Zone offsets are required so "when" is never ambiguous. */
export function pastInstant(value: unknown, now: Date): string | null {
  if (typeof value !== "string" || !ISO_RE.test(value)) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime()) || at.getTime() > now.getTime() + CLOCK_SKEW_MS) return null;
  return at.toISOString();
}

export function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

async function buildEvent(
  caseId: string,
  orgId: string,
  seq: number,
  prevHash: string,
  type: string,
  actor: string,
  payload: Record<string, unknown>,
  occurredAt: string,
): Promise<DeskCaseEvent> {
  const base = { caseId, seq, type, actor, payload: JSON.stringify(payload), occurredAt };
  return { ...base, id: crypto.randomUUID(), orgId, prevHash, hash: await hashEvent(prevHash, base) };
}

type Change = (current: DeskCase) => { next: DeskCase; type: string; payload: Record<string, unknown> } | Response;

/**
 * Re-reads, applies and appends until this writer holds the next position.
 * The unique (case_id, seq) index is what makes a race a retry instead of a fork.
 */
export async function applyToCase(
  repo: DeskRepository,
  orgId: string,
  caseId: string,
  actor: string,
  requestId: string,
  change: Change,
): Promise<Response> {
  for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
    const current = await repo.getCase(orgId, caseId);
    if (!current) return notFound(requestId);
    const applied = change(current);
    if (applied instanceof Response) return applied;
    const events = await repo.listCaseEvents(orgId, caseId);
    const head = events[events.length - 1];
    const now = new Date().toISOString();
    const event = await buildEvent(
      caseId,
      orgId,
      (head?.seq ?? 0) + 1,
      head?.hash ?? GENESIS_HASH,
      applied.type,
      actor,
      applied.payload,
      now,
    );
    const next = { ...applied.next, updatedAt: now };
    if (await repo.appendCaseEvent(next, event)) return ok({ case: toCase(next) }, requestId);
  }
  return fail("chain_conflict", "The case changed while saving. Try again.", 409, requestId);
}

async function createCase(
  repo: DeskRepository,
  orgId: string,
  actor: string,
  body: unknown,
  requestId: string,
): Promise<Response> {
  const input = (body ?? {}) as Record<string, unknown>;
  const now = new Date();
  const fields: Record<string, string[]> = {};
  const title = requiredText(input.title, 200);
  if (!title) fields.title = ["Required, at most 200 characters"];
  if (typeof input.kind !== "string" || !KINDS.has(input.kind)) fields.kind = ["Must be vulnerability or incident"];
  const awareAt = pastInstant(input.awareAt, now);
  if (!awareAt) fields.awareAt = ["Must be a time with a zone offset, not in the future"];
  const productId = typeof input.productId === "string" ? parseProductId(input.productId) : null;
  if (!productId || !(await repo.getProduct(orgId, productId))) fields.productId = ["Must be one of your products"];
  let reportId: string | null = null;
  if (input.reportId !== undefined && input.reportId !== null) {
    reportId = typeof input.reportId === "string" ? parseReportId(input.reportId) : null;
    if (!reportId || !(await repo.getReport(orgId, reportId))) fields.reportId = ["Must be one of your reports"];
  }
  if (Object.keys(fields).length > 0) return invalid(requestId, fields);

  const kind = input.kind as DeskCaseKind;
  const id = crypto.randomUUID();
  const stamp = now.toISOString();
  const record: DeskCase = {
    id,
    orgId,
    reportId,
    productId: productId!,
    kind,
    title: title!,
    status: "open",
    awareAt: awareAt!,
    awareRecordedBy: actor,
    correctiveAvailableAt: null,
    notificationSubmittedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    isSample: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...computeDeadlines({ kind, awareAt: awareAt!, correctiveAvailableAt: null, notificationSubmittedAt: null }),
  };
  const first = await buildEvent(
    id,
    orgId,
    1,
    GENESIS_HASH,
    "case.opened",
    actor,
    { kind, title: title!, awareAt: awareAt!, productId: productPublicId(productId!) },
    stamp,
  );
  await repo.insertCase(record, first);
  if (reportId) await repo.setReportStatus(orgId, reportId, "triaged", stamp);
  return ok({ case: toCase(record) }, requestId, 201);
}

const SAMPLE_PRODUCT_ID = "sample";

/** A practice case for trying the desk. It has no product and the scheduler never reads it. */
async function openSampleCase(repo: DeskRepository, orgId: string, actor: string, requestId: string): Promise<Response> {
  const existing = await repo.findOpenSample(orgId);
  if (existing) return ok({ case: toCase(existing) }, requestId);
  const now = new Date();
  const stamp = now.toISOString();
  const awareAt = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const id = crypto.randomUUID();
  const title = "[Sample] Practice case: not real, alerts nobody";
  const record: DeskCase = {
    id,
    orgId,
    reportId: null,
    productId: SAMPLE_PRODUCT_ID,
    kind: "vulnerability",
    title,
    status: "open",
    awareAt,
    awareRecordedBy: actor,
    correctiveAvailableAt: null,
    notificationSubmittedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    isSample: true,
    createdAt: stamp,
    updatedAt: stamp,
    ...computeDeadlines({ kind: "vulnerability", awareAt, correctiveAvailableAt: null, notificationSubmittedAt: null }),
  };
  const first = await buildEvent(id, orgId, 1, GENESIS_HASH, "case.opened", actor, { sample: true, title, awareAt }, stamp);
  await repo.insertCase(record, first);
  return ok({ case: toCase(record) }, requestId, 201);
}

export async function handleCaseRoute(
  request: Request,
  repo: DeskRepository,
  orgId: string,
  path: string,
  body: unknown,
  requestId: string,
): Promise<Response> {
  const method = request.method;
  const actor = request.headers.get("x-actor-subject-id") ?? "unknown";

  if (path === "cases") {
    if (method === "GET") return ok({ cases: (await repo.listCases(orgId)).map(toCase) }, requestId);
    if (method === "POST") return createCase(repo, orgId, actor, body, requestId);
    return fail("unsupported", "Method not allowed", 405, requestId);
  }

  if (path === "cases/sample") {
    if (method !== "POST") return fail("unsupported", "Method not allowed", 405, requestId);
    return openSampleCase(repo, orgId, actor, requestId);
  }

  const [, rawId, action] = path.split("/");
  const caseId = rawId ? parseCaseId(rawId) : null;
  if (!caseId) return notFound(requestId);
  const input = (body ?? {}) as Record<string, unknown>;

  if (!action) {
    if (method !== "GET") return fail("unsupported", "Method not allowed", 405, requestId);
    const record = await repo.getCase(orgId, caseId);
    if (!record) return notFound(requestId);
    const events = await repo.listCaseEvents(orgId, caseId);
    return ok({ case: toCase(record), events: events.map(toEvent), chainValid: await verifyChain(events) }, requestId);
  }

  const apply = (change: Change): Promise<Response> => applyToCase(repo, orgId, caseId, actor, requestId, change);
  const closed = (): Response => fail("case_closed", "This case is closed", 409, requestId);

  if (action === "acknowledge" && method === "POST") {
    return apply((current) => {
      // A second acknowledgement is recorded but keeps the first person and time.
      const stamp = new Date().toISOString();
      return {
        next: {
          ...current,
          acknowledgedAt: current.acknowledgedAt ?? stamp,
          acknowledgedBy: current.acknowledgedBy ?? actor,
        },
        type: "case.acknowledged",
        payload: {},
      };
    });
  }

  if (action === "notes" && method === "POST") {
    const note = requiredText(input.note, 4000);
    if (!note) return invalid(requestId, { note: ["Required, at most 4000 characters"] });
    return apply((current) => ({ next: current, type: "case.note", payload: { note } }));
  }

  if (action === "awareness" && method === "PUT") {
    const awareAt = pastInstant(input.awareAt, new Date());
    const reason = requiredText(input.reason, 1000);
    const fields: Record<string, string[]> = {};
    if (!awareAt) fields.awareAt = ["Must be a time with a zone offset, not in the future"];
    if (!reason) fields.reason = ["Say why the time is being corrected"];
    if (Object.keys(fields).length > 0) return invalid(requestId, fields);
    return apply((current) => {
      if (current.status === "closed") return closed();
      return {
        next: { ...current, awareAt: awareAt!, ...computeDeadlines({ ...current, awareAt: awareAt! }) },
        type: "case.awareness_corrected",
        payload: { from: current.awareAt, to: awareAt!, reason: reason! },
      };
    });
  }

  if (action === "corrective-measure" && method === "PUT") {
    const availableAt = pastInstant(input.availableAt, new Date());
    const description = requiredText(input.description, 4000);
    const fields: Record<string, string[]> = {};
    if (!availableAt) fields.availableAt = ["Must be a time with a zone offset, not in the future"];
    if (!description) fields.description = ["Describe the corrective measure"];
    if (Object.keys(fields).length > 0) return invalid(requestId, fields);
    return apply((current) => {
      if (current.status === "closed") return closed();
      if (current.kind !== "vulnerability") {
        return invalid(requestId, { kind: ["An incident's final report follows its notification instead"] });
      }
      const correctiveAvailableAt = availableAt!;
      return {
        next: { ...current, correctiveAvailableAt, ...computeDeadlines({ ...current, correctiveAvailableAt }) },
        type: "case.corrective_measure",
        payload: { availableAt: correctiveAvailableAt, description: description! },
      };
    });
  }

  if (action === "packet" && method === "GET") {
    return handlePacket(repo, orgId, caseId, path.split("/")[3], requestId);
  }

  if (action === "submissions" && method === "POST") {
    return recordSubmission(repo, orgId, caseId, actor, input, requestId);
  }

  if (action === "export" && method === "GET") {
    return exportEvidence(repo, orgId, caseId, requestId);
  }

  if (action === "close" && method === "POST") {
    const reason = requiredText(input.reason, 1000);
    if (!reason) return invalid(requestId, { reason: ["Say why this case is closing"] });
    return apply((current) => {
      if (current.status === "closed") return closed();
      return { next: { ...current, status: "closed" }, type: "case.closed", payload: { reason: reason! } };
    });
  }

  return notFound(requestId);
}
