import type { Env } from "./env.js";
import { route } from "./router.js";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
  },
} satisfies ExportedHandler<Env>;
