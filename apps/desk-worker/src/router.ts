import type { PublicDeskProduct, PublicDeskSettings, PublicEscalationStep } from "@saas/contracts/desk";
import { createSqlExecutor } from "@saas/db/d1";
import { createDeskRepository, type DeskProduct, type DeskRepository, type DeskSettings } from "@saas/db/desk";
import type { Env } from "./env.js";
import { fail, invalid, notFound, ok } from "./http.js";
import { orgPublicId, parseOrgId, parseProductId, productPublicId, stepPublicId } from "./ids.js";
import { fetchAuthorizationContext } from "./membership-client.js";
import { authorizeViaPolicy } from "./policy-client.js";
import { computeReadiness } from "./readiness.js";
import { parseEscalation, parseProduct, parseSettings } from "./validate.js";

const REQUEST_ID_RE = /^[\w-]{1,128}$/;
const ORG_ROUTE_RE = /^\/v1\/organizations\/([^/]+)\/desk\/(.+)$/;

function toProduct(p: DeskProduct): PublicDeskProduct {
  return { ...p, id: productPublicId(p.id), orgId: orgPublicId(p.orgId) };
}

function toSettings(s: DeskSettings): PublicDeskSettings {
  return { ...s, orgId: orgPublicId(s.orgId) };
}

async function authorized(
  request: Request,
  env: Env,
  orgId: string,
  action: "desk.read" | "desk.write",
  requestId: string,
): Promise<boolean> {
  const subjectId = request.headers.get("x-actor-subject-id");
  const subjectType = request.headers.get("x-actor-subject-type");
  if (!subjectId || !subjectType) return false;
  const context = await fetchAuthorizationContext(env.MEMBERSHIP_WORKER!, subjectId, subjectType, orgId, requestId);
  if (!context.ok) return false;
  const decision = await authorizeViaPolicy(
    env.POLICY_WORKER!,
    subjectId,
    subjectType,
    action,
    { kind: "organization", orgId },
    context.memberships,
    requestId,
  );
  return decision.allow;
}

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

async function handleOrgRoute(
  request: Request,
  env: Env,
  repo: DeskRepository,
  orgId: string,
  path: string,
  requestId: string,
): Promise<Response> {
  const method = request.method;
  const isRead = method === "GET";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return fail("unsupported", "Method not allowed", 405, requestId);
  }
  // A missing org and a forbidden one read the same, so ids reveal nothing.
  if (!(await authorized(request, env, orgId, isRead ? "desk.read" : "desk.write", requestId))) {
    return notFound(requestId);
  }

  const now = new Date().toISOString();
  let body: unknown;
  if (!isRead && method !== "DELETE") {
    const parsed = await readJson(request);
    if (!parsed.ok) return invalid(requestId, { body: ["Invalid JSON"] });
    body = parsed.body;
  }

  if (path === "readiness" && isRead) {
    const [products, settings, chain] = await Promise.all([
      repo.listProducts(orgId),
      repo.getSettings(orgId),
      repo.listEscalation(orgId),
    ]);
    return ok({ readiness: computeReadiness(products, settings, chain) }, requestId);
  }

  if (path === "products") {
    if (isRead) return ok({ products: (await repo.listProducts(orgId)).map(toProduct) }, requestId);
    if (method === "POST") {
      const input = parseProduct(body);
      if (!input.ok) return invalid(requestId, input.fields);
      const product = await repo.createProduct(orgId, crypto.randomUUID(), input.value, now);
      return ok({ product: toProduct(product) }, requestId, 201);
    }
    return fail("unsupported", "Method not allowed", 405, requestId);
  }

  if (path.startsWith("products/")) {
    const id = parseProductId(path.slice("products/".length));
    if (!id) return notFound(requestId);
    if (isRead) {
      const product = await repo.getProduct(orgId, id);
      return product ? ok({ product: toProduct(product) }, requestId) : notFound(requestId);
    }
    if (method === "PATCH") {
      const input = parseProduct(body);
      if (!input.ok) return invalid(requestId, input.fields);
      const product = await repo.updateProduct(orgId, id, input.value, now);
      return product ? ok({ product: toProduct(product) }, requestId) : notFound(requestId);
    }
    if (method === "DELETE") {
      return (await repo.deleteProduct(orgId, id, now)) ? ok({ deleted: true }, requestId) : notFound(requestId);
    }
    return fail("unsupported", "Method not allowed", 405, requestId);
  }

  if (path === "settings") {
    if (isRead) return ok({ settings: toSettings(await repo.getSettings(orgId)) }, requestId);
    if (method !== "PUT") return fail("unsupported", "Method not allowed", 405, requestId);
    const input = parseSettings(body);
    if (!input.ok) return invalid(requestId, input.fields);
    const current = await repo.getSettings(orgId);
    const { published, ...changes } = input.value;
    const next: DeskSettings = { ...current, ...changes };
    if (published === true) {
      if (!next.publicSlug || !next.policyText) {
        return invalid(requestId, { published: ["A public address and a policy are required before publishing"] });
      }
      next.disclosurePublishedAt = current.disclosurePublishedAt ?? now;
    } else if (published === false) {
      next.disclosurePublishedAt = null;
    } else if (next.disclosurePublishedAt && (!next.publicSlug || !next.policyText)) {
      return invalid(requestId, { published: ["Take the page down before removing its address or policy"] });
    }
    const saved = await repo.saveSettings(next, now);
    if (!saved.ok) return fail("conflict", "That public address is already taken", 409, requestId);
    return ok({ settings: toSettings(saved.settings) }, requestId);
  }

  if (path === "escalation") {
    if (isRead) {
      return ok({ steps: (await repo.listEscalation(orgId)).map(toStep) }, requestId);
    }
    if (method !== "PUT") return fail("unsupported", "Method not allowed", 405, requestId);
    const input = parseEscalation(body);
    if (!input.ok) return invalid(requestId, input.fields);
    const steps = await repo.replaceEscalation(
      orgId,
      input.value.map((step) => ({ ...step, id: crypto.randomUUID() })),
      now,
    );
    return ok({ steps: steps.map(toStep) }, requestId);
  }

  return notFound(requestId);
}

function toStep(step: {
  id: string;
  position: number;
  name: string;
  email: string;
  afterMinutes: number;
  channels: string[];
}): PublicEscalationStep {
  return { ...step, id: stepPublicId(step.id), channels: step.channels as PublicEscalationStep["channels"] };
}

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const header = request.headers.get("x-request-id");
  const requestId = header && REQUEST_ID_RE.test(header) ? header : `req_${crypto.randomUUID().replaceAll("-", "")}`;

  if (url.pathname === "/health" && request.method === "GET") {
    return ok(
      {
        status: "ok",
        service: "desk-worker",
        environment: env.ENVIRONMENT ?? "local",
        timestamp: new Date().toISOString(),
        checks: {
          database: { configured: !!env.PLATFORM_DB },
          membership: { configured: !!env.MEMBERSHIP_WORKER },
          policy: { configured: !!env.POLICY_WORKER },
        },
      },
      requestId,
    );
  }

  if (!env.PLATFORM_DB || !env.MEMBERSHIP_WORKER || !env.POLICY_WORKER) {
    return fail("internal_error", "Service unavailable", 503, requestId);
  }

  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const repo = createDeskRepository(executor);
    const match = url.pathname.match(ORG_ROUTE_RE);
    if (!match) return notFound(requestId);
    const orgId = parseOrgId(match[1]!);
    if (!orgId) return notFound(requestId);
    return await handleOrgRoute(request, env, repo, orgId, match[2]!, requestId);
  } catch {
    return fail("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
