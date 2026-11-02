import type { DeskPacket, PacketField } from "@saas/contracts/desk";
import { fieldsForStage, SRP_CATALOG_VERSION, SRP_STAGES, type SrpStage } from "@saas/contracts/srp-fields";
import type { DeskCase, DeskProduct, DeskRepository, DeskSubmission } from "@saas/db/desk";
import { applyToCase, pastInstant, requiredText } from "./cases.js";
import { computeDeadlines } from "./clocks.js";
import { fail, invalid, notFound, ok } from "./http.js";
import { casePublicId, orgPublicId, productPublicId } from "./ids.js";

const STAGES: ReadonlySet<string> = new Set(SRP_STAGES);
const MAX_FIELD_LENGTH = 20_000;

function previousStage(stage: SrpStage): "early_warning" | "notification" | null {
  return stage === "notification" ? "early_warning" : stage === "final" ? "notification" : null;
}

/** What Earlywarn already knows. Everything else a person writes. */
export function prefill(c: DeskCase, product: DeskProduct | null): Record<string, string> {
  const values: Record<string, string> = {
    "1": c.kind === "vulnerability" ? "Actively Exploited Vulnerability" : "Severe Incident",
    "2": c.title,
    [c.kind === "vulnerability" ? "v26" : "i37"]: c.awareAt,
  };
  if (product) {
    values["5"] = product.memberStates.join(", ");
    values["6"] = product.name;
    if (product.versionsNote) values["7"] = product.versionsNote;
    if (product.productType) values["8"] = product.productType;
    if (product.supportEndsOn) values["11"] = `Support ends ${product.supportEndsOn}`;
  }
  if (c.correctiveAvailableAt) values.v22 = c.correctiveAvailableAt;
  return values;
}

function dueFor(c: DeskCase, stage: SrpStage): string | null {
  return stage === "early_warning" ? c.earlyWarningDueAt : stage === "notification" ? c.notificationDueAt : c.finalDueAt;
}

export async function handlePacket(
  repo: DeskRepository,
  orgId: string,
  caseId: string,
  stage: string | undefined,
  requestId: string,
): Promise<Response> {
  if (!stage || !STAGES.has(stage)) return notFound(requestId);
  const srpStage = stage as SrpStage;
  const c = await repo.getCase(orgId, caseId);
  if (!c) return notFound(requestId);
  const [product, submissions] = await Promise.all([
    repo.getProduct(orgId, c.productId),
    repo.listSubmissions(orgId, caseId),
  ]);
  const submitted = submissions.find((s) => s.stage === srpStage) ?? null;
  const values = submitted?.fields ?? prefill(c, product);
  const fields: PacketField[] = fieldsForStage(c.kind, srpStage).map((f) => {
    const value = values[f.id] ?? null;
    return {
      id: f.id,
      label: f.label,
      requirement: f.requirement,
      note: f.note ?? null,
      value,
      missing: f.requirement === "required" && !value,
    };
  });
  const before = previousStage(srpStage);
  const packet: DeskPacket = {
    stage: srpStage,
    catalogVersion: SRP_CATALOG_VERSION,
    dueAt: dueFor(c, srpStage),
    submitted,
    blockedBy: before && !submissions.some((s) => s.stage === before) ? before : null,
    fields,
  };
  return ok({ packet }, requestId);
}

export function canonicalFields(fields: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function recordSubmission(
  repo: DeskRepository,
  orgId: string,
  caseId: string,
  actor: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<Response> {
  const stage = input.stage;
  if (typeof stage !== "string" || !STAGES.has(stage)) {
    return invalid(requestId, { stage: ["Must be early_warning, notification or final"] });
  }
  const srpStage = stage as SrpStage;
  const c = await repo.getCase(orgId, caseId);
  if (!c) return notFound(requestId);

  const submittedAt = pastInstant(input.submittedAt, new Date());
  const rawFields = input.fields;
  const errors: Record<string, string[]> = {};
  if (!submittedAt) errors.submittedAt = ["Must be a time with a zone offset, not in the future"];
  if (!rawFields || typeof rawFields !== "object" || Array.isArray(rawFields)) {
    return invalid(requestId, { ...errors, fields: ["Must be an object of field id to value"] });
  }

  const catalog = fieldsForStage(c.kind, srpStage);
  const known = new Set(catalog.map((f) => f.id));
  const fields: Record<string, string> = {};
  for (const [id, value] of Object.entries(rawFields as Record<string, unknown>)) {
    if (!known.has(id)) {
      errors[`fields.${id}`] = ["This field does not apply to this stage"];
    } else if (typeof value !== "string" || value.length > MAX_FIELD_LENGTH) {
      errors[`fields.${id}`] = ["Must be text"];
    } else if (value.trim()) {
      fields[id] = value.trim();
    }
  }
  for (const field of catalog) {
    if (field.requirement === "required" && !fields[field.id]) errors[`fields.${field.id}`] = [`${field.label} is required`];
  }
  if (Object.keys(errors).length > 0) return invalid(requestId, errors);

  const submissions = await repo.listSubmissions(orgId, caseId);
  const before = previousStage(srpStage);
  if (before && !submissions.some((s) => s.stage === before)) {
    return fail("stage_out_of_order", `Record the ${before.replace("_", " ")} first, as the platform requires`, 409, requestId);
  }

  const submission: DeskSubmission = {
    stage: srpStage,
    fields,
    srpReference: requiredText(input.srpReference, 200),
    submittedAt: submittedAt!,
    submittedBy: actor,
  };
  if (!(await repo.insertSubmission(orgId, caseId, submission, new Date().toISOString()))) {
    return fail("already_recorded", "This stage is already recorded", 409, requestId);
  }
  const fieldsHash = await sha256(canonicalFields(fields));
  return applyToCase(repo, orgId, caseId, actor, requestId, (current) => {
    const notificationSubmittedAt = srpStage === "notification" ? submittedAt! : current.notificationSubmittedAt;
    return {
      next: { ...current, notificationSubmittedAt, ...computeDeadlines({ ...current, notificationSubmittedAt }) },
      type: "case.submission_recorded",
      payload: { stage: srpStage, submittedAt: submittedAt!, srpReference: submission.srpReference, fieldsHash },
    };
  });
}

export async function exportEvidence(
  repo: DeskRepository,
  orgId: string,
  caseId: string,
  requestId: string,
): Promise<Response> {
  const c = await repo.getCase(orgId, caseId);
  if (!c) return notFound(requestId);
  const [events, submissions, product] = await Promise.all([
    repo.listCaseEvents(orgId, caseId),
    repo.listSubmissions(orgId, caseId),
    repo.getProduct(orgId, c.productId),
  ]);
  return ok(
    {
      format: "earlywarn-evidence-v1",
      exportedAt: new Date().toISOString(),
      catalogVersion: SRP_CATALOG_VERSION,
      verifyWith: "tooling/desk/verify-evidence.mjs in the Earlywarn repository",
      headHash: events[events.length - 1]?.hash ?? null,
      case: {
        id: casePublicId(c.id),
        internalId: c.id,
        orgId: orgPublicId(c.orgId),
        kind: c.kind,
        title: c.title,
        status: c.status,
        awareAt: c.awareAt,
        awareRecordedBy: c.awareRecordedBy,
        earlyWarningDueAt: c.earlyWarningDueAt,
        notificationDueAt: c.notificationDueAt,
        finalDueAt: c.finalDueAt,
        product: product ? { id: productPublicId(product.id), name: product.name } : null,
      },
      events: events.map((e) => ({
        seq: e.seq,
        type: e.type,
        actor: e.actor,
        rawPayload: e.payload,
        occurredAt: e.occurredAt,
        prevHash: e.prevHash,
        hash: e.hash,
      })),
      submissions,
    },
    requestId,
  );
}
