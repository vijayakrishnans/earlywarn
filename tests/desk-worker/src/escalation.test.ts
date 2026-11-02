import { route } from "@desk-worker/router";
import type { Env } from "@desk-worker/env";
import { planCaseAlerts, runEscalationTick, stepDueTimes, type ReportingStage } from "@desk-worker/escalation";
import type { DeskCase, EscalationStep } from "@saas/db/desk";
import { createMembership, createTestDb } from "./harness";

const ORG = "org_11111111111111111111111111111111";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const T0 = "2026-11-01T10:00:00.000Z";
const at = (minutes: number): number => new Date(T0).getTime() + minutes * 60_000;

const step = (id: string, afterMinutes: number, channels = ["email"]): EscalationStep => ({
  id, position: 1, name: id, email: `${id}@example.com`, afterMinutes, channels,
});
const CHAIN = [step("ana", 0), step("ben", 30), step("cai", 15)];

function makeCase(overrides: Partial<DeskCase> = {}): DeskCase {
  return {
    id: "c", orgId: "o", reportId: null, productId: "p", kind: "vulnerability", title: "T", status: "open",
    awareAt: T0, awareRecordedBy: "u", correctiveAvailableAt: null, notificationSubmittedAt: null,
    earlyWarningDueAt: new Date(at(24 * 60)).toISOString(), notificationDueAt: new Date(at(72 * 60)).toISOString(),
    finalDueAt: null, acknowledgedAt: null, acknowledgedBy: null, createdAt: T0, updatedAt: T0, ...overrides,
  };
}
const keys = (c: DeskCase, sent: string[], minutes: number, submitted: ReportingStage[] = []) =>
  planCaseAlerts(c, CHAIN, new Set(submitted), new Set(sent), at(minutes)).map((a) => a.key);

describe("the chain's timing", () => {
  it("accumulates delays from the opening, ignoring the first step's", () => {
    expect(stepDueTimes(T0, CHAIN).map((d) => d.dueAt)).toEqual([at(0), at(30), at(45)]);
  });

  it("alerts each person in turn and never the same step twice", () => {
    const c = makeCase();
    expect(keys(c, [], 0)).toEqual(["step-1"]);
    expect(keys(c, ["step-1"], 29)).toEqual([]);
    expect(keys(c, ["step-1"], 30)).toEqual(["step-2"]);
    expect(keys(c, ["step-1", "step-2"], 45)).toEqual(["step-3"]);
  });

  it("stops the chain on acknowledgement while deadlines continue", () => {
    const c = makeCase({ acknowledgedAt: new Date(at(5)).toISOString() });
    expect(keys(c, ["step-1"], 100)).toEqual([]);
    expect(keys(c, ["step-1"], 12 * 60)).toEqual(["deadline-early_warning-50"]);
  });

  it("does not start from a backdated awareness", () => {
    const opened = new Date(at(600)).toISOString();
    const c = makeCase({ createdAt: opened, acknowledgedAt: null });
    expect(keys(c, [], 600)).toContain("step-1");
    expect(keys(c, [], 600)).not.toContain("step-2");
  });

  it("sends nothing for a closed case or an empty chain", () => {
    expect(keys(makeCase({ status: "closed" }), [], 9999)).toEqual([]);
    expect(planCaseAlerts(makeCase(), [], new Set(), new Set(), at(9999))).toEqual([]);
  });
});

describe("deadline reminders", () => {
  const sentAll = ["step-1", "step-2", "step-3"];

  it.each([
    [12 * 60 - 1, []],
    [12 * 60, ["deadline-early_warning-50"]],
    [18 * 60, ["deadline-early_warning-75"]],
    [21.6 * 60, ["deadline-early_warning-90"]],
    [24 * 60, ["deadline-early_warning-100"]],
  ])("at minute %s owes %j", (minute, expected) => {
    expect(keys(makeCase({ acknowledgedAt: T0 }), sentAll, minute as number)).toEqual(expected);
  });

  it("sends only the latest threshold when several have passed", () => {
    const k = keys(makeCase({ acknowledgedAt: T0 }), sentAll, 23 * 60);
    expect(k).toEqual(["deadline-early_warning-90"]);
  });

  it("does not go backwards once a later threshold was sent", () => {
    expect(keys(makeCase({ acknowledgedAt: T0 }), [...sentAll, "deadline-early_warning-90"], 23 * 60)).toEqual([]);
  });

  it("watches the notification once the early warning is filed", () => {
    const k = keys(makeCase({ acknowledgedAt: T0 }), sentAll, 36 * 60, ["early_warning"]);
    expect(k).toEqual(["deadline-notification-50"]);
  });

  it("starts the final clock's reminders only once it exists", () => {
    const fixedAt = new Date(at(0)).toISOString();
    const finalDueAt = new Date(at(14 * 24 * 60)).toISOString();
    const c = makeCase({ acknowledgedAt: T0, correctiveAvailableAt: fixedAt, finalDueAt });
    const k = keys(c, sentAll, 7 * 24 * 60, ["early_warning", "notification"]);
    expect(k).toEqual(["deadline-final-50"]);
  });

  it("tells everyone when overdue, and only those reached before that", () => {
    const c = makeCase({ acknowledgedAt: T0 });
    const before = planCaseAlerts(c, CHAIN, new Set(), new Set(["step-1"]), at(12 * 60));
    expect(before[0]!.recipients.map((r) => r.id)).toEqual(["ana"]);
    const overdue = planCaseAlerts(c, CHAIN, new Set(), new Set(["step-1"]), at(24 * 60));
    expect(overdue[0]!.recipients.map((r) => r.id)).toEqual(["ana", "ben", "cai"]);
  });
});

function worldWith(notifyOk = true) {
  const { membership, policy } = createMembership({ owner: "owner", viewer: "viewer" });
  const db = createTestDb();
  const emails: Array<{ address: string; key: string; data: Record<string, unknown> }> = [];
  const seenKeys = new Set<string>();
  const notifications = {
    fetch: async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (!notifyOk) return new Response("no", { status: 500 });
      if (!seenKeys.has(body.idempotencyKey)) {
        seenKeys.add(body.idempotencyKey);
        emails.push({ address: body.recipient.address, key: body.idempotencyKey, data: body.templateData });
      }
      return Response.json({ data: { notification: { id: "ntf_1" }, notificationId: "ntf_1", outcome: "accepted" } }, { status: 202 });
    },
  } as unknown as Fetcher;
  const env: Env = {
    PLATFORM_DB: db,
    MEMBERSHIP_WORKER: membership,
    POLICY_WORKER: policy,
    NOTIFICATIONS_WORKER: notifications,
    DESK_ENCRYPTION_KEY: KEY,
    CONSOLE_URL: "https://console.example",
    ENVIRONMENT: "test",
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await route(
      new Request(`https://desk.internal/v1/organizations/${ORG}/desk/${path}`, {
        method,
        headers: { "x-actor-subject-id": "owner", "x-actor-subject-type": "user", "content-type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
      }),
      env,
    );
    return (await res.json()) as { data: Record<string, any> };
  };
  return { env, db, emails, call };
}

async function openCase(world: ReturnType<typeof worldWith>, title = "Exploited flaw") {
  await world.call("PUT", "escalation", {
    steps: [
      { name: "Ana", email: "ana@example.com", afterMinutes: 0, channels: ["email"] },
      { name: "Ben", email: "Ben@Example.com", afterMinutes: 30, channels: ["email"] },
    ],
  });
  const { product } = (await world.call("POST", "products", { name: "X1", memberStates: ["DE"] })).data;
  const { case: c } = (await world.call("POST", "cases", {
    productId: product.id, kind: "vulnerability", title, awareAt: new Date(Date.now() - 60_000).toISOString(),
  })).data;
  return c as { id: string; createdAt: string };
}

describe("the scheduler", () => {
  it("reaches the backup with no human action, once, and puts it on the timeline", async () => {
    const world = worldWith();
    const c = await openCase(world);
    const opened = new Date(c.createdAt).getTime();

    await runEscalationTick(world.env, new Date(opened));
    expect(world.emails.map((e) => e.address)).toEqual(["ana@example.com"]);

    await runEscalationTick(world.env, new Date(opened + 29 * 60_000));
    expect(world.emails).toHaveLength(1);

    await runEscalationTick(world.env, new Date(opened + 30 * 60_000));
    expect(world.emails.map((e) => e.address)).toEqual(["ana@example.com", "ben@example.com"]);

    const again = await runEscalationTick(world.env, new Date(opened + 30 * 60_000));
    expect(again.alerts).toBe(0);
    expect(world.emails).toHaveLength(2);

    const { events, chainValid } = (await world.call("GET", `cases/${c.id}`)).data;
    expect(events.filter((e: { type: string }) => e.type === "case.alert_sent").map((e: { payload: { alert: string } }) => e.payload.alert))
      .toEqual(["step-1", "step-2"]);
    expect(chainValid).toBe(true);
  });

  it("stops at acknowledgement", async () => {
    const world = worldWith();
    const c = await openCase(world);
    const opened = new Date(c.createdAt).getTime();
    await runEscalationTick(world.env, new Date(opened));
    await world.call("POST", `cases/${c.id}/acknowledge`, {});
    await runEscalationTick(world.env, new Date(opened + 60 * 60_000));
    expect(world.emails.map((e) => e.address)).toEqual(["ana@example.com"]);
  });

  it("retries next tick when email cannot be queued, instead of forgetting", async () => {
    const world = worldWith(false);
    const c = await openCase(world);
    const opened = new Date(c.createdAt).getTime();
    const failed = await runEscalationTick(world.env, new Date(opened));
    expect(failed).toMatchObject({ alerts: 0, retries: 1 });
    const healthy = worldWith();
    world.env.NOTIFICATIONS_WORKER = healthy.env.NOTIFICATIONS_WORKER!;
    expect((await runEscalationTick(world.env, new Date(opened + 60_000))).alerts).toBe(1);
    expect(healthy.emails).toHaveLength(1);
  });

  it("writes one webhook event per alert, with no recipients' addresses", async () => {
    const world = worldWith();
    const c = await openCase(world, "Router flaw");
    await runEscalationTick(world.env, new Date(c.createdAt));
    await runEscalationTick(world.env, new Date(c.createdAt));
    const { results } = (await world.env.PLATFORM_DB!.prepare(
      "SELECT type, payload FROM events_event_log WHERE type LIKE 'desk.case.%'",
    ).all()) as unknown as { results: Array<{ type: string; payload: string }> };
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe("desk.case.escalated");
    expect(results[0]!.payload).not.toContain("example.com");
    expect(JSON.parse(results[0]!.payload).chainHead).toMatch(/^[0-9a-f]{64}$/);
  });

  it("alerts on a new report without its contents, and again when past target", async () => {
    const world = worldWith();
    await world.call("PUT", "escalation", {
      steps: [
        { name: "Ana", email: "ana@example.com", afterMinutes: 0, channels: ["email"] },
        { name: "Ben", email: "ben@example.com", afterMinutes: 30, channels: ["email"] },
      ],
    });
    await world.call("PUT", "settings", { publicSlug: "acme", policyText: "P", published: true, triageTargetMinutes: 60 });
    const res = await route(
      new Request("https://desk.internal/disclose/acme", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ title: "SECRET-TITLE", details: "SECRET-DETAILS" }).toString(),
      }),
      world.env,
    );
    expect(res.status).toBe(201);
    const start = Date.now();
    await runEscalationTick(world.env, new Date(start));
    await runEscalationTick(world.env, new Date(start));
    expect(world.emails.map((e) => e.address)).toEqual(["ana@example.com"]);
    expect(JSON.stringify(world.emails)).not.toContain("SECRET");

    await runEscalationTick(world.env, new Date(start + 61 * 60_000));
    expect(world.emails.map((e) => e.address)).toEqual(["ana@example.com", "ana@example.com", "ben@example.com"]);
    await runEscalationTick(world.env, new Date(start + 120 * 60_000));
    expect(world.emails).toHaveLength(3);
  });

  it("keeps organizations' alerts apart: a chain only hears its own cases", async () => {
    const world = worldWith();
    const c = await openCase(world);
    await world.env.PLATFORM_DB!.prepare(
      "INSERT INTO desk_escalation_steps (id, org_id, position, name, email, after_minutes, channels, created_at) VALUES ('x','other',1,'Eve','eve@other.example',0,'[\"email\"]',?)",
    ).bind(c.createdAt).all();
    await runEscalationTick(world.env, new Date(c.createdAt));
    expect(world.emails.map((e) => e.address)).toEqual(["ana@example.com"]);
  });

  it("sends a test alert to every step", async () => {
    const world = worldWith();
    await openCase(world);
    const { emailsQueued, steps, webhookEvent } = (await world.call("POST", "escalation/test", {})).data;
    expect({ emailsQueued, steps, webhookEvent }).toEqual({ emailsQueued: 2, steps: 2, webhookEvent: true });
  });
});
