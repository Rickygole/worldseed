/** Route logic for /api/health and /api/closures, kept out of the route files so tests can call it. */
import { ClosuresRequestSchema, type ClosuresResponse } from "../agent/protocol";
import { json, readBody } from "./agentService";
import { ROLES } from "./models";
import { clientIp, utcDay } from "./ratelimit";
import type { Runtime } from "./runtime";
import { lookupClosures } from "./tavily";

export async function handleHealth(rt: Runtime): Promise<Response> {
  const { agent } = rt;
  const [models, budget, tavilyCalls] = await Promise.all([
    agent.resolver.health(),
    agent.budget.status(),
    rt.counters.get(`tavily:${utcDay(agent.now())}`),
  ]);
  const plannerUp = models.roles.planner.model !== "unavailable";
  return json(
    {
      ok: true,
      // Degraded means the UI must show "AI planner unavailable. Explore manually."
      degraded: !plannerUp || budget.exhausted,
      degradedReason: !plannerUp ? "planner_unavailable" : budget.exhausted ? "budget_exhausted" : null,
      provider: { configured: models.reason !== "no_api_key", reachable: models.reachable, checkedAt: models.checkedAt },
      roles: Object.fromEntries(ROLES.map((r) => [r, models.roles[r].model])),
      fallbacks: Object.fromEntries(ROLES.map((r) => [r, models.roles[r].chain.slice(1)])),
      budget,
      tavily: { configured: rt.search !== null, callsToday: tavilyCalls, dailyCap: agent.config.tavilyDailyCap },
    },
    200,
    { "cache-control": "no-store" },
  );
}

export async function handleClosures(request: Request, rt: Runtime): Promise<Response> {
  const body = await readBody(request, ClosuresRequestSchema);
  if (!body.ok) return body.res;
  const out: ClosuresResponse = await lookupClosures(
    { config: rt.agent.config, search: rt.search, counters: rt.counters, limiter: rt.agent.limiter, agent: rt.agent, now: rt.agent.now },
    clientIp(request.headers),
    rt.closures,
  );
  const status = out.status === "unavailable" && out.reason === "rate_limited" ? 429 : 200;
  return json(out, status, { "cache-control": "no-store", ...(out.status === "unavailable" && out.retryAfterS ? { "retry-after": String(out.retryAfterS) } : {}) });
}
