import { route } from "@desk-worker/router";
import type { Env } from "@desk-worker/env";
import { computeReadiness } from "@desk-worker/readiness";
import { emptyDeskSettings } from "@saas/db/desk";
import { createMembership, createTestDb } from "./harness";

const ORG_A = "org_11111111111111111111111111111111";
const ORG_B = "org_22222222222222222222222222222222";

type Json = { data: Record<string, any>; error: { code: string; details: { fields: Record<string, string[]> } } };

function setup() {
  const { membership, policy } = createMembership({ owner: "owner", viewer: "viewer" });
  const env: Env = {
    PLATFORM_DB: createTestDb(),
    MEMBERSHIP_WORKER: membership,
    POLICY_WORKER: policy,
    ENVIRONMENT: "test",
  };
  const call = async (method: string, org: string, path: string, body?: unknown, actor = "owner") => {
    const res = await route(
      new Request(`https://desk.internal/v1/organizations/${org}/desk/${path}`, {
        method,
        headers: { "x-actor-subject-id": actor, "x-actor-subject-type": "user", "content-type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
      }),
      env,
    );
    return { status: res.status, json: (await res.json()) as Json };
  };
  return { call };
}

const PRODUCT = { name: "Router X1", memberStates: ["DE", "FR", "DE"] };
const STEP = { name: "Ana", email: "ana@example.com", afterMinutes: 30, channels: ["email"] };

describe("products", () => {
  it("creates, de-duplicates markets, reads, updates and deletes", async () => {
    const { call } = setup();
    const created = await call("POST", ORG_A, "products", PRODUCT);
    expect(created.status).toBe(201);
    const { id, memberStates } = created.json.data.product;
    expect(id).toMatch(/^prd_[0-9a-f]{32}$/);
    expect(memberStates).toEqual(["DE", "FR"]);

    const updated = await call("PATCH", ORG_A, `products/${id}`, { ...PRODUCT, name: "Router X2" });
    expect(updated.json.data.product.name).toBe("Router X2");

    expect((await call("DELETE", ORG_A, `products/${id}`)).status).toBe(200);
    expect((await call("GET", ORG_A, `products/${id}`)).status).toBe(404);
    expect((await call("GET", ORG_A, "products")).json.data.products).toEqual([]);
  });

  it("refuses a market outside the EU", async () => {
    const { call } = setup();
    const res = await call("POST", ORG_A, "products", { name: "X", memberStates: ["US"] });
    expect(res.status).toBe(422);
    expect(res.json.error.details.fields.memberStates).toBeDefined();
  });

  it("never shows one organization another's product", async () => {
    const { call } = setup();
    const { id } = (await call("POST", ORG_A, "products", PRODUCT)).json.data.product;
    expect((await call("GET", ORG_B, `products/${id}`)).status).toBe(404);
    expect((await call("PATCH", ORG_B, `products/${id}`, PRODUCT)).status).toBe(404);
    expect((await call("DELETE", ORG_B, `products/${id}`)).status).toBe(404);
    expect((await call("GET", ORG_B, "products")).json.data.products).toEqual([]);
  });
});

describe("authorization", () => {
  it("answers not_found to a non-member on every route", async () => {
    const { call } = setup();
    for (const path of ["products", "settings", "escalation", "readiness"]) {
      expect((await call("GET", ORG_A, path, undefined, "stranger")).status).toBe(404);
    }
  });

  it("lets a viewer read and not write", async () => {
    const { call } = setup();
    expect((await call("GET", ORG_A, "products", undefined, "viewer")).status).toBe(200);
    expect((await call("POST", ORG_A, "products", PRODUCT, "viewer")).status).toBe(404);
  });

  it("answers not_found to a malformed organization id", async () => {
    const { call } = setup();
    expect((await call("GET", "nonsense", "products")).status).toBe(404);
  });
});

describe("settings", () => {
  it("defaults before anything is saved", async () => {
    const { call } = setup();
    const { settings } = (await call("GET", ORG_A, "settings")).json.data;
    expect(settings.triageTargetMinutes).toBe(240);
    expect(settings.disclosurePublishedAt).toBeNull();
  });

  it("will not publish without an address and a policy", async () => {
    const { call } = setup();
    expect((await call("PUT", ORG_A, "settings", { published: true })).status).toBe(422);
    const res = await call("PUT", ORG_A, "settings", { publicSlug: "acme", policyText: "Report here.", published: true });
    expect(res.status).toBe(200);
    expect(res.json.data.settings.disclosurePublishedAt).toEqual(expect.any(String));
    expect((await call("PUT", ORG_A, "settings", { policyText: null })).status).toBe(422);
  });

  it("keeps the first published time when republished, clears it when taken down", async () => {
    const { call } = setup();
    const first = (await call("PUT", ORG_A, "settings", { publicSlug: "acme", policyText: "P", published: true })).json.data.settings;
    const again = (await call("PUT", ORG_A, "settings", { published: true })).json.data.settings;
    expect(again.disclosurePublishedAt).toBe(first.disclosurePublishedAt);
    const down = (await call("PUT", ORG_A, "settings", { published: false })).json.data.settings;
    expect(down.disclosurePublishedAt).toBeNull();
  });

  it("gives a public address to one organization only", async () => {
    const { call } = setup();
    expect((await call("PUT", ORG_A, "settings", { publicSlug: "acme" })).status).toBe(200);
    const taken = await call("PUT", ORG_B, "settings", { publicSlug: "acme" });
    expect(taken.status).toBe(409);
    expect(taken.json.error.code).toBe("conflict");
  });

  it("allows many organizations with no address", async () => {
    const { call } = setup();
    expect((await call("PUT", ORG_A, "settings", { triageTargetMinutes: 60 })).status).toBe(200);
    expect((await call("PUT", ORG_B, "settings", { triageTargetMinutes: 60 })).status).toBe(200);
  });
});

describe("escalation", () => {
  it("replaces the chain in order and alerts the first step at once", async () => {
    const { call } = setup();
    await call("PUT", ORG_A, "escalation", { steps: [STEP] });
    const res = await call("PUT", ORG_A, "escalation", { steps: [STEP, { ...STEP, name: "Ben" }] });
    expect(res.status).toBe(200);
    const { steps } = (await call("GET", ORG_A, "escalation")).json.data;
    expect(steps.map((s: { name: string }) => s.name)).toEqual(["Ana", "Ben"]);
    expect(steps.map((s: { position: number }) => s.position)).toEqual([1, 2]);
    expect(steps[0].afterMinutes).toBe(0);
    expect(steps[1].afterMinutes).toBe(30);
  });

  it("names the bad step", async () => {
    const { call } = setup();
    const res = await call("PUT", ORG_A, "escalation", { steps: [STEP, { ...STEP, email: "nope" }] });
    expect(res.status).toBe(422);
    expect(res.json.error.details.fields["steps.1"]).toEqual(["email must be valid"]);
  });
});

describe("readiness", () => {
  it("turns green only when every item is in place", async () => {
    const { call } = setup();
    const before = (await call("GET", ORG_A, "readiness")).json.data.readiness;
    expect(before.ready).toBe(false);
    expect(before.items.every((i: { done: boolean }) => !i.done)).toBe(true);

    await call("POST", ORG_A, "products", PRODUCT);
    await call("PUT", ORG_A, "settings", {
      mainEstablishmentState: "DE",
      coordinatingCsirt: "BSI",
      publicSlug: "acme",
      policyText: "Report here.",
      published: true,
    });
    await call("PUT", ORG_A, "escalation", { steps: [STEP, { ...STEP, name: "Ben" }] });
    expect((await call("GET", ORG_A, "readiness")).json.data.readiness.ready).toBe(true);
  });

  it("flags a product with no market", () => {
    const product = {
      id: "p", orgId: "o", name: "X", productType: null, versionsNote: null, supportEndsOn: null,
      memberStates: [], createdAt: "", updatedAt: "",
    };
    const { items } = computeReadiness([product], emptyDeskSettings("o"), []);
    expect(items.find((i) => i.key === "products")!.done).toBe(true);
    expect(items.find((i) => i.key === "markets")!.done).toBe(false);
  });
});
