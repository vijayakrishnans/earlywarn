import { DESK_REPORT_STATUSES, type DeskReportStatus } from "@saas/contracts/desk";
import type { DeskReportRow, DeskRepository } from "@saas/db/desk";
import type { EventsRepository } from "@saas/db/events";
import type { Env } from "./env.js";
import { fail, invalid, notFound, ok } from "./http.js";
import { orgPublicId, parseReportId, reportPublicId } from "./ids.js";
import { openReport, type ReportContents } from "./seal.js";

const STATUSES: ReadonlySet<string> = new Set(DESK_REPORT_STATUSES);

function summary(row: DeskReportRow, contents: ReportContents) {
  return {
    id: reportPublicId(row.id),
    orgId: orgPublicId(row.orgId),
    title: contents.title,
    product: contents.product,
    status: row.status,
    receivedAt: row.receivedAt,
    acknowledgedAt: row.acknowledgedAt,
  };
}

/** Reading a report's contents leaves a mark: it may describe an unpatched flaw. */
async function audit(
  events: EventsRepository,
  request: Request,
  orgId: string,
  reportId: string,
  type: string,
  description: string,
  requestId: string,
): Promise<void> {
  const result = await events.appendEventWithAudit({
    event: {
      id: crypto.randomUUID(),
      type,
      version: 1,
      source: "desk-worker",
      occurredAt: new Date(),
      actorType: request.headers.get("x-actor-subject-type") ?? "user",
      actorId: request.headers.get("x-actor-subject-id") ?? "unknown",
      orgId,
      projectId: null,
      subjectKind: "desk_report",
      subjectId: reportId,
      subjectName: reportPublicId(reportId),
      requestId,
      payload: { reportId: reportPublicId(reportId) },
    },
    audit: { id: crypto.randomUUID(), category: "desk", description, projectId: null },
  });
  if (!result.ok) throw new Error("desk: audit append failed");
}

export async function handleReportRoute(
  request: Request,
  env: Env,
  repo: DeskRepository,
  events: EventsRepository,
  orgId: string,
  path: string,
  body: unknown,
  requestId: string,
  now: string,
): Promise<Response> {
  if (!env.DESK_ENCRYPTION_KEY) return fail("internal_error", "Service unavailable", 503, requestId);
  const key = env.DESK_ENCRYPTION_KEY;
  const method = request.method;

  if (path === "reports") {
    if (method !== "GET") return fail("unsupported", "Method not allowed", 405, requestId);
    const [rows, settings] = await Promise.all([repo.listReports(orgId), repo.getSettings(orgId)]);
    const reports = await Promise.all(
      rows.map(async (row) => summary(row, await openReport(row.sealed, key, orgId, row.id))),
    );
    return ok({ reports, triageTargetMinutes: settings.triageTargetMinutes }, requestId);
  }

  const id = parseReportId(path.slice("reports/".length));
  if (!id) return notFound(requestId);

  if (method === "GET") {
    const row = await repo.getReport(orgId, id);
    if (!row) return notFound(requestId);
    const contents = await openReport(row.sealed, key, orgId, row.id);
    await audit(events, request, orgId, id, "desk.report.read", "Opened a vulnerability report", requestId);
    return ok(
      {
        report: {
          ...summary(row, contents),
          details: contents.details,
          reporterContact: contents.reporterContact,
        },
      },
      requestId,
    );
  }

  if (method === "PATCH") {
    const status = (body as { status?: unknown } | null)?.status;
    if (typeof status !== "string" || !STATUSES.has(status) || status === "new") {
      return invalid(requestId, { status: ["Must be triaged, duplicate or rejected"] });
    }
    const row = await repo.setReportStatus(orgId, id, status as DeskReportStatus, now);
    if (!row) return notFound(requestId);
    const contents = await openReport(row.sealed, key, orgId, row.id);
    await audit(events, request, orgId, id, "desk.report.status_changed", `Marked a report ${status}`, requestId);
    return ok(
      {
        report: {
          ...summary(row, contents),
          details: contents.details,
          reporterContact: contents.reporterContact,
        },
      },
      requestId,
    );
  }

  return fail("unsupported", "Method not allowed", 405, requestId);
}
