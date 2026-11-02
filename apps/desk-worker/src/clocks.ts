import type { DeskCaseKind } from "@saas/db/desk";

// CRA Article 14, as summarised on the Commission's reporting page:
//   early warning  within 24 hours of becoming aware
//   notification   within 72 hours of becoming aware
//   final report   vulnerability: within 14 days of a corrective measure being available
//                  severe incident: within one month of the notification

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface Deadlines {
  earlyWarningDueAt: string;
  notificationDueAt: string;
  finalDueAt: string | null;
}

export interface ClockFacts {
  kind: DeskCaseKind;
  awareAt: string;
  correctiveAvailableAt: string | null;
  notificationSubmittedAt: string | null;
}

/** A calendar month in UTC. A date with no counterpart lands on the month's last day, so 31 Jan gives 28 Feb. */
export function addCalendarMonth(iso: string): string {
  const from = new Date(iso);
  const to = new Date(from);
  to.setUTCDate(1);
  to.setUTCMonth(from.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  to.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return to.toISOString();
}

export function computeDeadlines(facts: ClockFacts): Deadlines {
  const aware = new Date(facts.awareAt).getTime();
  let finalDueAt: string | null = null;
  if (facts.kind === "vulnerability" && facts.correctiveAvailableAt) {
    finalDueAt = new Date(new Date(facts.correctiveAvailableAt).getTime() + 14 * DAY).toISOString();
  } else if (facts.kind === "incident" && facts.notificationSubmittedAt) {
    finalDueAt = addCalendarMonth(facts.notificationSubmittedAt);
  }
  return {
    earlyWarningDueAt: new Date(aware + 24 * HOUR).toISOString(),
    notificationDueAt: new Date(aware + 72 * HOUR).toISOString(),
    finalDueAt,
  };
}
