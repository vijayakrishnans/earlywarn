import { route } from "@notifications-worker/router";
import { validateEnqueueRequest } from "@notifications-worker/services/notifications";
import type { Env } from "@notifications-worker/env";

const env: Env = { ENVIRONMENT: "test", NOTIFICATIONS_PROVIDER: "local-debug" };

// The exact shape desk-worker sends. Its own tests mock this worker, so this is the seam's check.
const ALERT = {
  orgId: "11111111-1111-1111-1111-111111111111",
  category: "security",
  templateKey: "desk.alert",
  templateData: { headline: "H", title: "T", detail: "D", url: null, chainHead: null },
  recipient: { channel: "email", address: "ana@example.com" },
  idempotencyKey: "desk.alert:11111111-1111-1111-1111-111111111111:step-1:22222222-2222-2222-2222-222222222222",
  correlationId: "tick_abc",
};

describe("desk-worker as a notifications caller", () => {
  it("passes the internal-actor gate", async () => {
    const res = await route(
      new Request("http://nf/v1/notifications", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-actor": "desk-worker",
          "x-actor-subject-id": "desk-worker",
          "x-actor-subject-type": "system",
          "x-request-id": "req_desk",
        },
        body: JSON.stringify(ALERT),
      }),
      env,
    );
    // No database in this test: getting as far as needing one proves the gate and validation passed.
    expect(res.status).toBe(503);
  });

  it("sends a body the worker accepts", () => {
    expect(validateEnqueueRequest(ALERT).ok).toBe(true);
  });
});
