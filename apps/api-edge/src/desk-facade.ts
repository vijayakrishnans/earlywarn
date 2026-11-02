import type { Env } from "./env.js";
import { errorResponse, withEdgeTimings } from "./http.js";
import { replayOrExecute } from "./idempotency.js";
import { resolveActor } from "./resolve-actor.js";
import { createTimings } from "@saas/contracts/timing";

const ORG_DESK_RE = /^\/v1\/organizations\/[^/]+\/desk\/.+$/;
const FORWARDED_HEADERS = ["content-type", "traceparent", "idempotency-key"];

const PUBLIC_DESK_RE = /^\/(?:disclose|receipt)\/[^/]+(?:\/security\.txt)?$|^\/v1\/public\/receipts\/[^/]+$/;

export function isPublicDeskRoute(pathname: string): boolean {
  return PUBLIC_DESK_RE.test(pathname);
}

/** No session: these answer strangers. Rate limited per IP before reaching the worker. */
export async function handlePublicDeskRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  return replayOrExecute(request, requestId, env, "intake", async () => {
    if (!env.DESK_WORKER) return errorResponse("internal_error", "Desk service unavailable", 503, requestId);
    const url = new URL(request.url);
    const headers = new Headers({ "x-request-id": requestId, "x-public-origin": url.origin });
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const init: RequestInit = { method: request.method, headers };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    try {
      return await env.DESK_WORKER.fetch(new URL(pathname, "https://desk.internal").toString(), init);
    } catch {
      return errorResponse("internal_error", "Desk service unavailable", 503, requestId);
    }
  });
}

export function isDeskRoute(pathname: string): boolean {
  return ORG_DESK_RE.test(pathname);
}

export async function handleDeskRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  return replayOrExecute(request, requestId, env, "desk", async () => {
    if (!env.IDENTITY_WORKER) {
      return errorResponse("internal_error", "Authentication service unavailable", 503, requestId);
    }
    if (!env.DESK_WORKER) {
      return errorResponse("internal_error", "Desk service unavailable", 503, requestId);
    }

    const timings = createTimings();
    const endTotal = timings.start("edge_total");
    const session = await timings.measure("edge_auth", () => resolveActor(request, env, requestId));
    if ("error" in session) return session.error;

    const headers = new Headers();
    headers.set("x-request-id", requestId);
    headers.set("x-actor-subject-id", session.subjectId);
    headers.set("x-actor-subject-type", session.subjectType);
    headers.set("x-actor-email", session.email);
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const url = new URL(request.url);
    const target = new URL(pathname + url.search, "https://desk.internal");
    const init: RequestInit = { method: request.method, headers };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;

    try {
      const downstream = await timings.measure("edge_downstream", () => env.DESK_WORKER!.fetch(target.toString(), init));
      const response = new Response(downstream.body, { status: downstream.status, headers: downstream.headers });
      endTotal();
      return withEdgeTimings(response, requestId, "edge.desk", timings);
    } catch {
      return errorResponse("internal_error", "Desk service unavailable", 503, requestId);
    }
  });
}
