import { route } from "@desk-worker/router";
import type { Env } from "@desk-worker/env";
import { addCalendarMonth, computeDeadlines } from "@desk-worker/clocks";
import { verifyChain } from "@desk-worker/chain";
import { createDeskRepository } from "@saas/db/desk";
import { createSqlExecutor } from "@saas/db/d1";
import { D1ApiAdapter } from "@saas/db/runner";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMembership, createTestDb } from "./harness";

const ORG_A = "org_11111111111111111111111111111111";
const ORG_B = "org_22222222222222222222222222222222";
const ORG_A_UUID = "11111111-1111-1111-1111-111111111111";
const AWARE = "2026-11-01T10:00:00.000Z";

async function setup() {
  const { membership, policy } = createMembership({ owner: "owner", viewer: "viewer" });
  const db = createTestDb();
  const env: Env = { PLATFORM_DB: db, MEMBERSHIP_WORKER: membership, POLICY_WORKER: policy, ENVIRONMENT: "test" };
  const call = async (method: string, org: string, path: string, body?: unknown, actor = "owner") => {
    const res = await route(
      new Request(`https://desk.internal/v1/organizations/${org}/desk/${path}`, {
        method,
        headers: { "x-actor-subject-id": actor, "x-actor-subject-type": "user", "content-type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
      }),
      env,
    );
    return { status: res.status, json: (await res.json()) as { data: Record<string, any>; error: { code: string } } };
  };
  const productId: string = (await call("POST", ORG_A, "products", { name: "X1", memberStates: ["DE"] })).json.data.product.id;
  const open = async (kind = "vulnerability", awareAt = AWARE) =>
    (await call("POST", ORG_A, "cases", { productId, kind, title: "Exploited flaw", awareAt })).json.data.case;
  return { db, call, open, productId };
}

describe("the deadline table", () => {
  const base = { correctiveAvailableAt: null, notificationSubmittedAt: null, awareAt: AWARE };

  it.each(["vulnerability", "incident"] as const)("%s: 24 and 72 hours from awareness", (kind) => {
    const d = computeDeadlines({ ...base, kind });
    expect(d.earlyWarningDueAt).toBe("2026-11-02T10:00:00.000Z");
    expect(d.notificationDueAt).toBe("2026-11-04T10:00:00.000Z");
    expect(d.finalDueAt).toBeNull();
  });

  it("vulnerability: final is 14 days after the fix, however late the fix arrives", () => {
    expect(computeDeadlines({ ...base, kind: "vulnerability", correctiveAvailableAt: "2026-12-20T08:30:00.000Z" }).finalDueAt)
      .toBe("2027-01-03T08:30:00.000Z");
  });

  it("incident: final is a month after the notification, and ignores corrective measures", () => {
    expect(computeDeadlines({ ...base, kind: "incident", notificationSubmittedAt: "2026-11-03T09:00:00.000Z" }).finalDueAt)
      .toBe("2026-12-03T09:00:00.000Z");
    expect(computeDeadlines({ ...base, kind: "incident", correctiveAvailableAt: "2026-11-03T09:00:00.000Z" }).finalDueAt)
      .toBeNull();
  });

  it("vulnerability: a notification alone does not start the final clock", () => {
    expect(computeDeadlines({ ...base, kind: "vulnerability", notificationSubmittedAt: "2026-11-03T09:00:00.000Z" }).finalDueAt)
      .toBeNull();
  });

  it.each([
    ["2027-01-31T12:00:00.000Z", "2027-02-28T12:00:00.000Z"],
    ["2028-01-31T12:00:00.000Z", "2028-02-29T12:00:00.000Z"],
    ["2026-12-15T12:00:00.000Z", "2027-01-15T12:00:00.000Z"],
    ["2026-03-31T00:00:00.000Z", "2026-04-30T00:00:00.000Z"],
  ])("a calendar month from %s is %s", (from, to) => {
    expect(addCalendarMonth(from)).toBe(to);
  });
});

describe("opening a case", () => {
  it("fixes deadlines from a backdated awareness and names who recorded it", async () => {
    const { open } = await setup();
    const c = await open();
    expect(c.earlyWarningDueAt).toBe("2026-11-02T10:00:00.000Z");
    expect(c.awareRecordedBy).toBe("owner");
    expect(c.id).toMatch(/^cas_/);
  });

  it("normalises a zone offset to the same instant", async () => {
    const { open } = await setup();
    const c = await open("incident", "2026-11-01T12:00:00+02:00");
    expect(c.awareAt).toBe(AWARE);
  });

  it("refuses a future time, a time with no zone, and another organization's product", async () => {
    const { call, productId } = await setup();
    const base = { productId, kind: "incident", title: "T" };
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect((await call("POST", ORG_A, "cases", { ...base, awareAt: future })).status).toBe(422);
    expect((await call("POST", ORG_A, "cases", { ...base, awareAt: "2026-11-01T10:00" })).status).toBe(422);
    expect((await call("POST", ORG_B, "cases", { ...base, awareAt: AWARE })).status).toBe(422);
  });

  it("is invisible to other organizations and read-only to viewers", async () => {
    const { call, open } = await setup();
    const c = await open();
    expect((await call("GET", ORG_B, `cases/${c.id}`)).status).toBe(404);
    expect((await call("POST", ORG_B, `cases/${c.id}/acknowledge`, {})).status).toBe(404);
    expect((await call("GET", ORG_A, `cases/${c.id}`, undefined, "viewer")).status).toBe(200);
    expect((await call("POST", ORG_A, `cases/${c.id}/acknowledge`, {}, "viewer")).status).toBe(404);
  });
});

describe("changing a case", () => {
  it("keeps the original awareness on the timeline when it is corrected", async () => {
    const { call, open } = await setup();
    const c = await open();
    const res = await call("PUT", ORG_A, `cases/${c.id}/awareness`, { awareAt: "2026-11-01T08:00:00Z", reason: "Log shows earlier alert" });
    expect(res.json.data.case.earlyWarningDueAt).toBe("2026-11-02T08:00:00.000Z");
    const { events } = (await call("GET", ORG_A, `cases/${c.id}`)).json.data;
    expect(events[1].type).toBe("case.awareness_corrected");
    expect(events[1].payload).toEqual({ from: AWARE, to: "2026-11-01T08:00:00.000Z", reason: "Log shows earlier alert" });
    expect((await call("PUT", ORG_A, `cases/${c.id}/awareness`, { awareAt: AWARE })).status).toBe(422);
  });

  it("starts the final clock on a corrective measure, for vulnerabilities only", async () => {
    const { call, open } = await setup();
    const v = await open();
    const fixed = await call("PUT", ORG_A, `cases/${v.id}/corrective-measure`, { availableAt: "2026-11-01T12:00:00Z", description: "v1.2.1" });
    expect(fixed.json.data.case.finalDueAt).toBe("2026-11-15T12:00:00.000Z");
    const i = await open("incident");
    expect((await call("PUT", ORG_A, `cases/${i.id}/corrective-measure`, { availableAt: "2026-11-01T12:00:00Z", description: "x" })).status).toBe(422);
  });

  it("keeps the first acknowledgement", async () => {
    const { call, open } = await setup();
    const c = await open();
    const first = (await call("POST", ORG_A, `cases/${c.id}/acknowledge`, {})).json.data.case;
    const second = (await call("POST", ORG_A, `cases/${c.id}/acknowledge`, {})).json.data.case;
    expect(second.acknowledgedAt).toBe(first.acknowledgedAt);
    expect(second.acknowledgedBy).toBe("owner");
  });

  it("freezes the clocks once closed but still takes notes", async () => {
    const { call, open } = await setup();
    const c = await open();
    expect((await call("POST", ORG_A, `cases/${c.id}/close`, { reason: "Not exploited after all" })).json.data.case.status).toBe("closed");
    expect((await call("PUT", ORG_A, `cases/${c.id}/awareness`, { awareAt: AWARE, reason: "x" })).json.error.code).toBe("case_closed");
    expect((await call("POST", ORG_A, `cases/${c.id}/close`, { reason: "again" })).status).toBe(409);
    expect((await call("POST", ORG_A, `cases/${c.id}/notes`, { note: "Post-mortem done" })).status).toBe(200);
  });
});

describe("the hash chain", () => {
  it("verifies, and links every event to the one before", async () => {
    const { call, open } = await setup();
    const c = await open();
    await call("POST", ORG_A, `cases/${c.id}/notes`, { note: "one" });
    await call("POST", ORG_A, `cases/${c.id}/notes`, { note: "two" });
    const { events, chainValid } = (await call("GET", ORG_A, `cases/${c.id}`)).json.data;
    expect(chainValid).toBe(true);
    expect(events.map((e: { seq: number }) => e.seq)).toEqual([1, 2, 3]);
    expect(events[1].prevHash).toBe(events[0].hash);
  });

  it("gives concurrent writers one position each, with no fork", async () => {
    const { call, open } = await setup();
    const c = await open();
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => call("POST", ORG_A, `cases/${c.id}/notes`, { note: `n${n}` })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const { events, chainValid } = (await call("GET", ORG_A, `cases/${c.id}`)).json.data;
    expect(chainValid).toBe(true);
    expect(events.map((e: { seq: number }) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(events.map((e: { payload: { note?: string } }) => e.payload.note)).size).toBe(5);
  });

  it.each(["actor", "payload", "occurredAt", "type"] as const)("fails verification when %s is edited", async (field) => {
    const { db, open } = await setup();
    const c = await open();
    const repo = createDeskRepository(createSqlExecutor(db));
    const id = c.id.slice(4).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
    const stored = await repo.listCaseEvents(ORG_A_UUID, id);
    expect(await verifyChain(stored)).toBe(true);
    expect(await verifyChain([{ ...stored[0]!, [field]: "tampered" }])).toBe(false);
  });

  it("fails verification when an event is removed or reordered", async () => {
    const { call, db, open } = await setup();
    const c = await open();
    await call("POST", ORG_A, `cases/${c.id}/notes`, { note: "one" });
    await call("POST", ORG_A, `cases/${c.id}/notes`, { note: "two" });
    const repo = createDeskRepository(createSqlExecutor(db));
    const id = c.id.slice(4).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
    const [a, b, d] = await repo.listCaseEvents(ORG_A_UUID, id);
    expect(await verifyChain([a!, d!])).toBe(false);
    expect(await verifyChain([a!, d!, b!])).toBe(false);
  });
});

describe("the migration", () => {
  it("survives the runner's statement splitter whole", () => {
    const sql = readFileSync(resolve(process.cwd(), "../../packages/db/src/migrations/220_desk_cases/up.sql"), "utf-8");
    const statements = D1ApiAdapter.splitStatements(sql);
    expect(statements.filter((s) => /CREATE TABLE/.test(s))).toHaveLength(2);
    expect(statements.some((s) => /BEGIN/.test(s))).toBe(false);
  });
});
