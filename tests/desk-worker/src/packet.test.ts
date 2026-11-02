import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { route } from "@desk-worker/router";
import type { Env } from "@desk-worker/env";
import { planCaseAlerts } from "@desk-worker/escalation";
import { fieldsForStage, SRP_FIELDS, SRP_STAGES } from "@saas/contracts/srp-fields";
import { createMembership, createTestDb } from "./harness";

const ORG = "org_11111111111111111111111111111111";
const VERIFIER = resolve(process.cwd(), "../../tooling/desk/verify-evidence.mjs");

async function setup() {
  const { membership, policy } = createMembership({ owner: "owner", viewer: "viewer" });
  const env: Env = { PLATFORM_DB: createTestDb(), MEMBERSHIP_WORKER: membership, POLICY_WORKER: policy, ENVIRONMENT: "test" };
  const call = async (method: string, path: string, body?: unknown, org = ORG) => {
    const res = await route(
      new Request(`https://desk.internal/v1/organizations/${org}/desk/${path}`, {
        method,
        headers: { "x-actor-subject-id": "owner", "x-actor-subject-type": "user", "content-type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
      }),
      env,
    );
    return { status: res.status, json: (await res.json()) as { data: Record<string, any>; error: { code: string; details: { fields: Record<string, string[]> } } } };
  };
  const { product } = (await call("POST", "products", {
    name: "Router X1", memberStates: ["DE", "FR"], versionsNote: "1.0 to 1.2",
  })).json.data;
  const open = async (kind: string) =>
    (await call("POST", "cases", { productId: product.id, kind, title: "Exploited flaw", awareAt: "2026-11-01T10:00:00.000Z" })).json.data.case;
  return { call, open, env };
}

const AT = "2026-11-01T11:00:00.000Z";
const EARLY = { "3": "Summary", "4": "Acme", "7": "1.2", };

function fillRequired(kind: "vulnerability" | "incident", stage: (typeof SRP_STAGES)[number]) {
  return Object.fromEntries(fieldsForStage(kind, stage).filter((f) => f.requirement === "required").map((f) => [f.id, `value ${f.id}`]));
}

describe("the field catalogue", () => {
  it("has unique ids and a requirement for at least one stage each", () => {
    expect(new Set(SRP_FIELDS.map((f) => f.id)).size).toBe(SRP_FIELDS.length);
    for (const field of SRP_FIELDS) expect(Object.keys(field.stages).length).toBeGreaterThan(0);
  });

  it("carries the required fields the glossary lists for each stage", () => {
    const required = (kind: "vulnerability" | "incident", stage: (typeof SRP_STAGES)[number]) =>
      fieldsForStage(kind, stage).filter((f) => f.requirement === "required").map((f) => f.id);
    expect(required("vulnerability", "early_warning")).toEqual(["1", "2", "3", "4", "5", "6", "7", "v26"]);
    expect(required("incident", "early_warning")).toEqual(["1", "2", "3", "4", "5", "6", "7", "i31", "i37"]);
    expect(required("vulnerability", "notification")).toEqual(["v21"]);
    expect(required("incident", "notification")).toEqual(["i32", "i39"]);
    expect(required("vulnerability", "final")).toEqual(["16", "17", "v22", "v23", "v24", "v25"]);
    expect(required("incident", "final")).toEqual(["16", "17", "i33", "i34", "i35", "i36"]);
  });

  it("never offers an incident field on a vulnerability", () => {
    for (const stage of SRP_STAGES) {
      expect(fieldsForStage("vulnerability", stage).some((f) => f.id.startsWith("i"))).toBe(false);
      expect(fieldsForStage("incident", stage).some((f) => /^v\d/.test(f.id))).toBe(false);
    }
  });
});

describe("the packet", () => {
  it("prefills what is known and names what is missing", async () => {
    const { call, open } = await setup();
    const c = await open("vulnerability");
    const { packet } = (await call("GET", `cases/${c.id}/packet/early_warning`)).json.data;
    const field = (id: string) => packet.fields.find((f: { id: string }) => f.id === id);
    expect(field("2").value).toBe("Exploited flaw");
    expect(field("5").value).toBe("DE, FR");
    expect(field("6").value).toBe("Router X1");
    expect(field("v26").value).toBe("2026-11-01T10:00:00.000Z");
    expect(field("3").missing).toBe(true);
    expect(packet.blockedBy).toBeNull();
    expect(packet.dueAt).toBe("2026-11-02T10:00:00.000Z");
  });

  it("answers 404 for an unknown stage and another organization", async () => {
    const { call, open } = await setup();
    const c = await open("incident");
    expect((await call("GET", `cases/${c.id}/packet/nonsense`)).status).toBe(404);
    expect((await call("GET", `cases/${c.id}/packet/final`, undefined, "org_22222222222222222222222222222222")).status).toBe(404);
  });
});

describe("recording a filing", () => {
  it("refuses a missing required field, a stray field and a future time", async () => {
    const { call, open } = await setup();
    const c = await open("vulnerability");
    const missing = await call("POST", `cases/${c.id}/submissions`, { stage: "early_warning", fields: EARLY, submittedAt: AT });
    expect(missing.status).toBe(422);
    expect(missing.json.error.details.fields["fields.v26"]).toBeDefined();
    const fields = fillRequired("vulnerability", "early_warning");
    expect((await call("POST", `cases/${c.id}/submissions`, { stage: "early_warning", fields: { ...fields, i31: "x" }, submittedAt: AT })).status).toBe(422);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect((await call("POST", `cases/${c.id}/submissions`, { stage: "early_warning", fields, submittedAt: future })).status).toBe(422);
  });

  it("holds the platform's order, and records each stage once", async () => {
    const { call, open } = await setup();
    const c = await open("vulnerability");
    const final = await call("POST", `cases/${c.id}/submissions`, { stage: "final", fields: fillRequired("vulnerability", "final"), submittedAt: AT });
    expect(final.json.error.code).toBe("stage_out_of_order");
    const late = await call("POST", `cases/${c.id}/submissions`, { stage: "notification", fields: fillRequired("vulnerability", "notification"), submittedAt: AT });
    expect(late.json.error.code).toBe("stage_out_of_order");

    const body = { stage: "early_warning", fields: fillRequired("vulnerability", "early_warning"), submittedAt: AT };
    expect((await call("POST", `cases/${c.id}/submissions`, body)).status).toBe(200);
    expect((await call("POST", `cases/${c.id}/submissions`, body)).json.error.code).toBe("already_recorded");
  });

  it("starts an incident's final clock from the notification's recorded time", async () => {
    const { call, open } = await setup();
    const c = await open("incident");
    await call("POST", `cases/${c.id}/submissions`, { stage: "early_warning", fields: fillRequired("incident", "early_warning"), submittedAt: AT });
    const res = await call("POST", `cases/${c.id}/submissions`, { stage: "notification", fields: fillRequired("incident", "notification"), submittedAt: "2026-11-01T12:00:00.000Z" });
    expect(res.json.data.case.finalDueAt).toBe("2026-12-01T12:00:00.000Z");
  });

  it("stops reminders for a filed stage", () => {
    const iso = (h: number) => new Date(Date.parse("2026-11-01T10:00:00.000Z") + h * 3_600_000).toISOString();
    const c = {
      id: "c", orgId: "o", reportId: null, productId: "p", kind: "vulnerability" as const, title: "T", status: "open" as const,
      awareAt: iso(0), awareRecordedBy: "u", correctiveAvailableAt: null, notificationSubmittedAt: null,
      earlyWarningDueAt: iso(24), notificationDueAt: iso(72), finalDueAt: null, acknowledgedAt: iso(0), acknowledgedBy: "u",
      isSample: false, createdAt: iso(0), updatedAt: iso(0),
    };
    const chain = [{ id: "a", position: 1, name: "A", email: "a@example.com", afterMinutes: 0, channels: ["email"] }];
    const owed = planCaseAlerts(c, chain, new Set(["early_warning"]), new Set(), Date.parse(iso(20)));
    expect(owed.map((a) => a.key)).toEqual([]);
  });
});

describe("the evidence export", () => {
  async function exported() {
    const { call, open } = await setup();
    const c = await open("vulnerability");
    await call("POST", `cases/${c.id}/notes`, { note: "Called the supplier" });
    await call("POST", `cases/${c.id}/submissions`, { stage: "early_warning", fields: fillRequired("vulnerability", "early_warning"), submittedAt: AT });
    return (await call("GET", `cases/${c.id}/export`)).json.data as Record<string, any>;
  }

  function runVerifier(evidence: unknown): { code: number; out: string } {
    const file = join(mkdtempSync(join(tmpdir(), "evidence-")), "export.json");
    writeFileSync(file, JSON.stringify(evidence));
    try {
      return { code: 0, out: execFileSync(process.execPath, [VERIFIER, file], { encoding: "utf8", stdio: "pipe" }) };
    } catch (err) {
      const failed = err as { status: number; stderr: string };
      return { code: failed.status, out: failed.stderr };
    }
  }

  it("verifies offline with the published script", async () => {
    const result = runVerifier(await exported());
    expect(result.code).toBe(0);
    expect(result.out).toContain("VERIFIED");
  });

  it.each([
    ["a note's wording", (e: any) => { e.events[1].rawPayload = JSON.stringify({ note: "Never called" }); }],
    ["who acted", (e: any) => { e.events[0].actor = "someone-else"; }],
    ["when it happened", (e: any) => { e.events[0].occurredAt = "2026-10-01T00:00:00.000Z"; }],
    ["a removed middle event", (e: any) => { e.events.splice(1, 1); }],
    ["a removed last event", (e: any) => { e.events.pop(); }],
    ["what was filed", (e: any) => { e.submissions[0].fields["3"] = "Different summary"; }],
    ["a removed filing record", (e: any) => { e.events = e.events.filter((x: any) => x.type !== "case.submission_recorded"); }],
  ])("fails after changing %s", async (_name, tamper) => {
    const evidence = await exported();
    tamper(evidence);
    const result = runVerifier(evidence);
    expect(result.code).toBe(1);
    expect(result.out).toContain("NOT VERIFIED");
  });
});
