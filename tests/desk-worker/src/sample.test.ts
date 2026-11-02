import { route } from "@desk-worker/router";
import type { Env } from "@desk-worker/env";
import { runEscalationTick } from "@desk-worker/escalation";
import { createMembership, createTestDb } from "./harness";

const ORG = "org_11111111111111111111111111111111";

function setup() {
  const { membership, policy } = createMembership({ owner: "owner", viewer: "viewer" });
  const emails: string[] = [];
  const env: Env = {
    PLATFORM_DB: createTestDb(),
    MEMBERSHIP_WORKER: membership,
    POLICY_WORKER: policy,
    NOTIFICATIONS_WORKER: {
      fetch: async (_url: string, init: RequestInit) => {
        emails.push(JSON.parse(String(init.body)).recipient.address);
        return Response.json({ data: { notification: { id: "n" } } }, { status: 201 });
      },
    } as unknown as Fetcher,
    ENVIRONMENT: "test",
  };
  const call = async (method: string, path: string, body?: unknown, actor = "owner") => {
    const res = await route(
      new Request(`https://desk.internal/v1/organizations/${ORG}/desk/${path}`, {
        method,
        headers: { "x-actor-subject-id": actor, "x-actor-subject-type": "user", "content-type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
      }),
      env,
    );
    return { status: res.status, json: (await res.json()) as { data: Record<string, any> } };
  };
  return { env, call, emails };
}

const CHAIN = { steps: [{ name: "Ana", email: "ana@example.com", afterMinutes: 0, channels: ["email"] }] };

describe("the practice case", () => {
  it("says what it is and reuses the one already open", async () => {
    const { call } = setup();
    const first = await call("POST", "cases/sample", {});
    expect(first.status).toBe(201);
    expect(first.json.data.case.isSample).toBe(true);
    expect(first.json.data.case.title).toContain("[Sample]");
    const again = await call("POST", "cases/sample", {});
    expect(again.status).toBe(200);
    expect(again.json.data.case.id).toBe(first.json.data.case.id);
  });

  it("alerts nobody, even long past every deadline, while a real case would", async () => {
    const { env, call, emails } = setup();
    await call("PUT", "escalation", CHAIN);
    await call("POST", "cases/sample", {});
    const result = await runEscalationTick(env, new Date(Date.now() + 90 * 86_400_000));
    expect(result.cases).toBe(0);
    expect(result.alerts).toBe(0);
    expect(emails).toEqual([]);

    const { product } = (await call("POST", "products", { name: "X1", memberStates: ["DE"] })).json.data;
    await call("POST", "cases", { productId: product.id, kind: "incident", title: "Real", awareAt: new Date().toISOString() });
    await runEscalationTick(env, new Date());
    expect(emails).toEqual(["ana@example.com"]);
  });

  it("does not make the readiness checklist look done", async () => {
    const { call } = setup();
    await call("POST", "cases/sample", {});
    const { items } = (await call("GET", "readiness")).json.data.readiness;
    expect(items.find((i: { key: string }) => i.key === "products").done).toBe(false);
  });

  it("can be walked through, and its evidence says it is a sample", async () => {
    const { call } = setup();
    const { id } = (await call("POST", "cases/sample", {})).json.data.case;
    const { packet } = (await call("GET", `cases/${id}/packet/early_warning`)).json.data;
    expect(packet.fields.find((f: { id: string }) => f.id === "2").value).toContain("[Sample]");
    expect((await call("POST", `cases/${id}/acknowledge`, {})).status).toBe(200);
    expect((await call("GET", `cases/${id}/export`)).json.data.case.isSample).toBe(true);
  });

  it("needs write access", async () => {
    const { call } = setup();
    expect((await call("POST", "cases/sample", {}, "viewer")).status).toBe(404);
  });
});
