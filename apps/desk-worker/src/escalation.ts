import type { DeskCase, DeskRepository, EscalationStep } from "@saas/db/desk";
import { createDeskRepository } from "@saas/db/desk";
import { createSqlExecutor } from "@saas/db/d1";
import { createEventsRepository, type EventsRepository } from "@saas/db/events";
import { buildIdempotencyKey, enqueueNotification } from "@saas/notifications-client";
import { applyToCase } from "./cases.js";
import type { Env } from "./env.js";
import { casePublicId, orgPublicId, reportPublicId } from "./ids.js";

export type ReportingStage = "early_warning" | "notification" | "final";

const STAGE_LABEL: Record<ReportingStage, string> = {
  early_warning: "Early warning",
  notification: "Notification",
  final: "Final report",
};
const THRESHOLDS = [50, 75, 90, 100] as const;
const SCHEDULER_ACTOR = "system:desk-escalation";
const CASE_SCAN_LIMIT = 200;
const REPORT_SCAN_LIMIT = 100;
const MINUTE = 60_000;

export interface PlannedAlert {
  key: string;
  headline: string;
  detail: string;
  recipients: EscalationStep[];
}

/** When each step falls due: the chain's delays accumulate from the moment the case was opened. */
export function stepDueTimes(openedAt: string, chain: readonly EscalationStep[]): Array<{ step: EscalationStep; dueAt: number }> {
  let at = new Date(openedAt).getTime();
  return chain.map((step, index) => {
    if (index > 0) at += step.afterMinutes * MINUTE;
    return { step, dueAt: at };
  });
}

function stageWindow(c: DeskCase, stage: ReportingStage): { start: number; due: number } | null {
  const aware = new Date(c.awareAt).getTime();
  if (stage === "early_warning") return { start: aware, due: new Date(c.earlyWarningDueAt).getTime() };
  if (stage === "notification") return { start: aware, due: new Date(c.notificationDueAt).getTime() };
  const opener = c.kind === "vulnerability" ? c.correctiveAvailableAt : c.notificationSubmittedAt;
  if (!c.finalDueAt || !opener) return null;
  return { start: new Date(opener).getTime(), due: new Date(c.finalDueAt).getTime() };
}

/**
 * Decides what is owed right now. Pure, so every timing rule is testable:
 *  - unacknowledged: each step whose delay has passed, in order
 *  - always, until that stage is filed: the latest deadline threshold passed
 */
export function planCaseAlerts(
  c: DeskCase,
  chain: readonly EscalationStep[],
  submitted: ReadonlySet<ReportingStage>,
  sent: ReadonlySet<string>,
  now: number,
): PlannedAlert[] {
  if (c.status !== "open" || chain.length === 0) return [];
  const alerts: PlannedAlert[] = [];
  const due = stepDueTimes(c.createdAt, chain);

  if (!c.acknowledgedAt) {
    for (const [index, { step, dueAt }] of due.entries()) {
      const key = `step-${index + 1}`;
      if (dueAt <= now && !sent.has(key)) {
        alerts.push({
          key,
          headline: index === 0 ? "New case needs you" : "Unacknowledged case escalated to you",
          detail: `Early warning due ${c.earlyWarningDueAt}. Please open the case and acknowledge it.`,
          recipients: [step],
        });
      }
    }
  }

  const reached = chain.filter((_, index) => sent.has(`step-${index + 1}`) || index === 0);
  for (const stage of ["early_warning", "notification", "final"] as const) {
    if (submitted.has(stage)) continue;
    const window = stageWindow(c, stage);
    if (!window) continue;
    const passed = THRESHOLDS.filter((t) => now >= window.start + ((window.due - window.start) * t) / 100);
    const latest = passed[passed.length - 1];
    if (latest === undefined) continue;
    // A later threshold already sent covers the earlier ones.
    if (THRESHOLDS.some((t) => t >= latest && sent.has(`deadline-${stage}-${t}`))) continue;
    alerts.push({
      key: `deadline-${stage}-${latest}`,
      headline: latest === 100 ? `${STAGE_LABEL[stage]} is overdue` : `${STAGE_LABEL[stage]} deadline approaching`,
      detail: `${STAGE_LABEL[stage]} due ${new Date(window.due).toISOString()}. File it in ENISA's Single Reporting Platform, then record it here.`,
      recipients: latest === 100 ? [...chain] : reached,
    });
  }
  return alerts;
}

/** A stable UUID from stable text, so a retried alert writes the same event id and collapses. */
async function deterministicUuid(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

interface Delivery {
  orgId: string;
  subjectKind: "case" | "report";
  subjectId: string;
  subjectPublicId: string;
  eventType: string;
  key: string;
  headline: string;
  detail: string;
  title: string;
  recipients: readonly EscalationStep[];
  url: string | null;
  chainHead: string | null;
}

/** Sends every email and writes the event. False means something must be retried next tick. */
async function deliver(env: Env, events: EventsRepository, d: Delivery, requestId: string): Promise<boolean> {
  let delivered = true;
  for (const recipient of d.recipients) {
    if (!recipient.channels.includes("email")) continue;
    const result = await enqueueNotification(
      env,
      {
        internalActor: "desk-worker",
        actorSubjectType: "system",
        actorSubjectId: "desk-worker",
        requestId,
      },
      {
        orgId: d.orgId,
        category: "security",
        templateKey: "desk.alert",
        templateData: { headline: d.headline, title: d.title, detail: d.detail, url: d.url, chainHead: d.chainHead },
        recipient: { channel: "email", address: recipient.email.toLowerCase() },
        idempotencyKey: buildIdempotencyKey("desk.alert", d.subjectId, d.key, recipient.id),
        correlationId: requestId,
      },
    );
    if (!result.ok) delivered = false;
  }

  const appended = await events.appendEventWithAudit({
    event: {
      id: await deterministicUuid(`${d.subjectId}/${d.key}`),
      type: d.eventType,
      version: 1,
      source: "desk-worker",
      occurredAt: new Date(),
      actorType: "system",
      actorId: SCHEDULER_ACTOR,
      orgId: d.orgId,
      projectId: null,
      subjectKind: `desk_${d.subjectKind}`,
      subjectId: d.subjectId,
      subjectName: d.subjectPublicId,
      requestId,
      // No report contents and no recipients' addresses: this is what webhooks receive.
      payload: {
        id: d.subjectPublicId,
        orgId: orgPublicId(d.orgId),
        alert: d.key,
        headline: d.headline,
        detail: d.detail,
        url: d.url,
        chainHead: d.chainHead,
      },
    },
    audit: { id: crypto.randomUUID(), category: "desk", description: d.headline, projectId: null },
  });
  // A conflict is this same event from a retried run.
  if (!appended.ok && appended.error.kind !== "conflict") delivered = false;
  return delivered;
}

export interface TickResult {
  cases: number;
  reports: number;
  alerts: number;
  retries: number;
}

export async function runEscalationTick(env: Env, nowDate: Date): Promise<TickResult> {
  const result: TickResult = { cases: 0, reports: 0, alerts: 0, retries: 0 };
  if (!env.PLATFORM_DB) return result;
  const executor = createSqlExecutor(env.PLATFORM_DB);
  const repo = createDeskRepository(executor);
  const events = createEventsRepository(executor);
  const now = nowDate.getTime();
  const stamp = nowDate.toISOString();
  const requestId = `tick_${crypto.randomUUID().replaceAll("-", "")}`;
  const consoleUrl = env.CONSOLE_URL ?? null;

  const cases = await repo.listOpenCasesForScheduler(CASE_SCAN_LIMIT);
  for (const c of cases) {
    result.cases += 1;
    try {
      const [chain, sentKeys, timeline, submitted] = await Promise.all([
        repo.listEscalation(c.orgId),
        repo.listSentAlerts(c.id),
        repo.listCaseEvents(c.orgId, c.id),
        submittedStages(repo, c),
      ]);
      const planned = planCaseAlerts(c, chain, submitted, new Set(sentKeys), now);
      for (const alert of planned) {
        const delivered = await deliver(
          env,
          events,
          {
            orgId: c.orgId,
            subjectKind: "case",
            subjectId: c.id,
            subjectPublicId: casePublicId(c.id),
            eventType: alert.key.startsWith("step-") ? "desk.case.escalated" : "desk.case.deadline",
            key: alert.key,
            headline: alert.headline,
            detail: alert.detail,
            title: c.title,
            recipients: alert.recipients,
            url: consoleUrl,
            chainHead: timeline[timeline.length - 1]?.hash ?? null,
          },
          requestId,
        );
        if (!delivered) {
          result.retries += 1;
          continue;
        }
        if (await repo.recordAlert(c.orgId, "case", c.id, alert.key, stamp)) {
          result.alerts += 1;
          await applyToCase(repo, c.orgId, c.id, SCHEDULER_ACTOR, requestId, (current) => ({
            next: current,
            type: "case.alert_sent",
            payload: { alert: alert.key, recipients: alert.recipients.map((r) => r.name) },
          }));
        }
      }
    } catch {
      // One bad case must not stop the alerts owed on every other case.
      result.retries += 1;
    }
  }

  for (const report of await repo.listNewReportsForScheduler(REPORT_SCAN_LIMIT)) {
    result.reports += 1;
    try {
      const [chain, sentKeys] = await Promise.all([repo.listEscalation(report.orgId), repo.listSentAlerts(report.id)]);
      if (chain.length === 0) continue;
      const late = now >= new Date(report.receivedAt).getTime() + report.triageTargetMinutes * MINUTE;
      const owed: Array<{ key: string; headline: string; recipients: EscalationStep[] }> = [];
      if (!sentKeys.includes("received")) {
        owed.push({ key: "received", headline: "New vulnerability report", recipients: [chain[0]!] });
      }
      if (late && !sentKeys.includes("triage-late")) {
        owed.push({ key: "triage-late", headline: "Report past its triage target", recipients: [...chain] });
      }
      for (const alert of owed) {
        const delivered = await deliver(
          env,
          events,
          {
            orgId: report.orgId,
            subjectKind: "report",
            subjectId: report.id,
            subjectPublicId: reportPublicId(report.id),
            eventType: "desk.report.alert",
            key: alert.key,
            headline: alert.headline,
            detail: "Sign in to read it. Report contents are never sent by email or webhook.",
            title: "A report is waiting in triage",
            recipients: alert.recipients,
            url: consoleUrl,
            chainHead: null,
          },
          requestId,
        );
        if (delivered && (await repo.recordAlert(report.orgId, "report", report.id, alert.key, stamp))) result.alerts += 1;
        if (!delivered) result.retries += 1;
      }
    } catch {
      result.retries += 1;
    }
  }
  return result;
}

async function submittedStages(repo: DeskRepository, c: DeskCase): Promise<ReadonlySet<ReportingStage>> {
  return new Set((await repo.listSubmissions(c.orgId, c.id)).map((s) => s.stage));
}

export async function sendTestAlert(
  env: Env,
  repo: DeskRepository,
  events: EventsRepository,
  orgId: string,
  requestId: string,
): Promise<{ steps: number; emailsQueued: number; webhookEvent: boolean }> {
  const chain = await repo.listEscalation(orgId);
  let emailsQueued = 0;
  const key = crypto.randomUUID();
  for (const step of chain) {
    if (!step.channels.includes("email")) continue;
    const sent = await enqueueNotification(
      env,
      { internalActor: "desk-worker", actorSubjectType: "system", actorSubjectId: "desk-worker", requestId },
      {
        orgId,
        category: "security",
        templateKey: "desk.alert",
        templateData: {
          headline: "Test alert",
          title: "This is only a test",
          detail: "Your escalation chain reached you. No action is needed.",
          url: env.CONSOLE_URL ?? null,
          chainHead: null,
        },
        recipient: { channel: "email", address: step.email.toLowerCase() },
        idempotencyKey: buildIdempotencyKey("desk.alert", "test", key, step.id),
        correlationId: requestId,
      },
    );
    if (sent.ok) emailsQueued += 1;
  }
  const appended = await events.appendEventWithAudit({
    event: {
      id: crypto.randomUUID(),
      type: "desk.test_alert",
      version: 1,
      source: "desk-worker",
      occurredAt: new Date(),
      actorType: "system",
      actorId: SCHEDULER_ACTOR,
      orgId,
      projectId: null,
      subjectKind: "desk_test",
      subjectId: key,
      subjectName: "test alert",
      requestId,
      payload: { test: true, orgId: orgPublicId(orgId) },
    },
    audit: { id: crypto.randomUUID(), category: "desk", description: "Sent a test alert", projectId: null },
  });
  return { steps: chain.length, emailsQueued, webhookEvent: appended.ok };
}
