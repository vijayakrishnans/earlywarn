import { route } from "@desk-worker/router";
import type { Env } from "@desk-worker/env";
import { createMembership, createTestDb } from "./harness";

const ORG_A = "org_11111111111111111111111111111111";
const ORG_B = "org_22222222222222222222222222222222";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const ORIGIN = "https://edge.example";

type Rows = { results: Array<Record<string, unknown>> };

function setup() {
  const { membership, policy } = createMembership({ owner: "owner", viewer: "viewer" });
  const db = createTestDb();
  const env: Env = {
    PLATFORM_DB: db,
    MEMBERSHIP_WORKER: membership,
    POLICY_WORKER: policy,
    DESK_ENCRYPTION_KEY: KEY,
    ENVIRONMENT: "test",
  };
  const authed = async (method: string, org: string, path: string, body?: unknown, actor = "owner") => {
    const res = await route(
      new Request(`https://desk.internal/v1/organizations/${org}/desk/${path}`, {
        method,
        headers: { "x-actor-subject-id": actor, "x-actor-subject-type": "user", "content-type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
      }),
      env,
    );
    return { status: res.status, json: (await res.json()) as { data: Record<string, any> } };
  };
  const pub = (path: string, init: RequestInit = {}) =>
    route(
      new Request(`https://desk.internal${path}`, {
        ...init,
        headers: { "x-public-origin": ORIGIN, ...(init.headers as Record<string, string> | undefined) },
      }),
      env,
    );
  const submit = (slug: string, fields: Record<string, string>) =>
    pub(`/disclose/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  const publish = (org = ORG_A, slug = "acme") =>
    authed("PUT", org, "settings", { publicSlug: slug, policyText: "Tell us <first>.", published: true });
  return { env, db, authed, pub, submit, publish };
}

const REPORT = { title: "Auth bypass", details: "Send header X to skip login.", product: "Router X1", contact: "r@example.com" };

async function tokenFrom(res: Response): Promise<string> {
  return (await res.text()).match(/\/receipt\/([0-9a-f]{64})/)![1]!;
}

describe("the disclosure page", () => {
  it("does not exist until published, and goes away when taken down", async () => {
    const { pub, publish, authed } = setup();
    expect((await pub("/disclose/acme")).status).toBe(404);
    await authed("PUT", ORG_A, "settings", { publicSlug: "acme", policyText: "P" });
    expect((await pub("/disclose/acme")).status).toBe(404);
    await publish();
    expect((await pub("/disclose/acme")).status).toBe(200);
    await authed("PUT", ORG_A, "settings", { published: false });
    expect((await pub("/disclose/acme")).status).toBe(404);
  });

  it("escapes the policy and locks the page down", async () => {
    const { pub, publish } = setup();
    await publish();
    const res = await pub("/disclose/acme");
    const html = await res.text();
    expect(html).toContain("Tell us &lt;first&gt;.");
    expect(html).not.toContain("<first>");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("re-renders a rejected form with the input escaped", async () => {
    const { submit, publish } = setup();
    await publish();
    const res = await submit("acme", { title: '"><script>x</script>', details: "" });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).not.toContain("<script>x");
    expect(html).toContain("Add details");
  });

  it("answers an unpublished address the same as a missing one when posted to", async () => {
    const { submit, db } = setup();
    expect((await submit("nobody", REPORT)).status).toBe(404);
    const rows = (await db.prepare("SELECT COUNT(*) AS n FROM desk_reports").all()) as unknown as Rows;
    expect(rows.results[0]!.n).toBe(0);
  });
});

describe("security.txt", () => {
  it("has the fields RFC 9116 requires, with an expiry within a year", async () => {
    const { pub, publish } = setup();
    await publish();
    const res = await pub("/disclose/acme/security.txt");
    const text = await res.text();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(text).toContain(`Contact: ${ORIGIN}/disclose/acme\n`);
    const expires = new Date(text.match(/^Expires: (.+)$/m)![1]!);
    const days = (expires.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(300);
    expect(days).toBeLessThanOrEqual(366);
  });
});

describe("a stranger's report", () => {
  it("reaches that organization's triage and no other", async () => {
    const { submit, publish, authed } = setup();
    await publish();
    await publish(ORG_B, "other");
    expect((await submit("acme", REPORT)).status).toBe(201);

    const mine = (await authed("GET", ORG_A, "reports")).json.data;
    expect(mine.reports).toHaveLength(1);
    expect(mine.reports[0].title).toBe("Auth bypass");
    expect(mine.reports[0].details).toBeUndefined();
    expect((await authed("GET", ORG_B, "reports")).json.data.reports).toEqual([]);
    expect((await authed("GET", ORG_B, `reports/${mine.reports[0].id}`)).status).toBe(404);
    expect((await authed("GET", ORG_A, "reports", undefined, "stranger")).status).toBe(404);
  });

  it("is stored as ciphertext", async () => {
    const { submit, publish, db } = setup();
    await publish();
    await submit("acme", REPORT);
    const { results } = (await db.prepare("SELECT * FROM desk_reports").all()) as unknown as Rows;
    const stored = JSON.stringify(results[0]);
    for (const secret of [REPORT.title, REPORT.details, REPORT.product, REPORT.contact]) {
      expect(stored).not.toContain(secret);
    }
    expect(String(results[0]!.sealed)).toMatch(/^v1\./);
  });

  it("will not open if the row is moved to another organization", async () => {
    const { submit, publish, authed, db } = setup();
    await publish();
    await publish(ORG_B, "other");
    await submit("acme", REPORT);
    await db
      .prepare("UPDATE desk_reports SET org_id = ?")
      .bind("22222222-2222-2222-2222-222222222222")
      .all();
    expect((await authed("GET", ORG_B, "reports")).status).toBe(500);
  });

  it("records who opened it in the audit log", async () => {
    const { submit, publish, authed, db } = setup();
    await publish();
    await submit("acme", REPORT);
    const { id } = (await authed("GET", ORG_A, "reports")).json.data.reports[0];
    const opened = await authed("GET", ORG_A, `reports/${id}`);
    expect(opened.json.data.report.details).toBe(REPORT.details);
    expect(opened.json.data.report.reporterContact).toBe(REPORT.contact);
    const { results } = (await db
      .prepare("SELECT actor_id, type FROM events_event_log WHERE type = 'desk.report.read'")
      .all()) as unknown as Rows;
    expect(results).toEqual([{ actor_id: "owner", type: "desk.report.read" }]);
  });

  it("drops a bot that fills the hidden field while looking successful", async () => {
    const { submit, publish, db } = setup();
    await publish();
    expect((await submit("acme", { ...REPORT, website: "http://spam" })).status).toBe(201);
    const rows = (await db.prepare("SELECT COUNT(*) AS n FROM desk_reports").all()) as unknown as Rows;
    expect(rows.results[0]!.n).toBe(0);
  });

  it("refuses to accept reports it could not seal", async () => {
    const { env, submit, publish } = setup();
    await publish();
    delete env.DESK_ENCRYPTION_KEY;
    expect((await submit("acme", REPORT)).status).toBe(503);
  });
});

describe("the receipt", () => {
  it("shows status only, and acknowledges when triaged", async () => {
    const { submit, publish, pub, authed } = setup();
    await publish();
    const token = await tokenFrom(await submit("acme", REPORT));

    const before = await pub(`/v1/public/receipts/${token}`);
    const beforeBody = await before.text();
    expect(JSON.parse(beforeBody).data.receipt.status).toBe("received");
    expect(beforeBody).not.toContain(REPORT.title);
    expect(beforeBody).not.toContain(REPORT.details);

    const { id } = (await authed("GET", ORG_A, "reports")).json.data.reports[0];
    await authed("PATCH", ORG_A, `reports/${id}`, { status: "triaged" });
    const after = await (await pub(`/v1/public/receipts/${token}`)).json() as { data: { receipt: { status: string; acknowledgedAt: string } } };
    expect(after.data.receipt.status).toBe("acknowledged");
    expect(after.data.receipt.acknowledgedAt).toEqual(expect.any(String));
    expect(await (await pub(`/receipt/${token}`)).text()).toContain("acknowledged your report");
  });

  it("answers not found to a guess, and the token is not stored", async () => {
    const { submit, publish, pub, db } = setup();
    await publish();
    const token = await tokenFrom(await submit("acme", REPORT));
    expect((await pub(`/v1/public/receipts/${"0".repeat(64)}`)).status).toBe(404);
    const { results } = (await db.prepare("SELECT * FROM desk_reports").all()) as unknown as Rows;
    expect(JSON.stringify(results[0])).not.toContain(token);
  });

  it("lets a viewer read reports but not change them, and refuses going back to new", async () => {
    const { submit, publish, authed } = setup();
    await publish();
    await submit("acme", REPORT);
    const { id } = (await authed("GET", ORG_A, "reports")).json.data.reports[0];
    expect((await authed("GET", ORG_A, `reports/${id}`, undefined, "viewer")).status).toBe(200);
    expect((await authed("PATCH", ORG_A, `reports/${id}`, { status: "triaged" }, "viewer")).status).toBe(404);
    expect((await authed("PATCH", ORG_A, `reports/${id}`, { status: "new" })).status).toBe(422);
  });
});
