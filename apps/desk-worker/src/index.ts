import type { Env } from "./env.js";
import { route } from "./router.js";
import { runEscalationTick } from "./escalation.js";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const result = await runEscalationTick(env, new Date());
    // Counts only: a log line never names a case or a person.
    // eslint-disable-next-line no-console -- structured scheduler line
    console.log(JSON.stringify({ level: "info", msg: "desk.tick", ...result }));
  },
} satisfies ExportedHandler<Env>;
