/** Route logic for /api/health and /api/closures, kept out of the route files so tests can call it. */
import {
  ClosuresRequestSchema,
  ConfirmClosureRequestSchema,
  type ClosuresResponse,
  type ConfirmClosureResponse,
} from "../agent/protocol";
import { guardPost, json, readBody } from "./agentService";
import { ROLES } from "./models";
import { clientIp, HOUR_MS, ipKey } from "./ratelimit";
import type { Runtime } from "./runtime";
import { StoreError } from "./store";
import { lookupClosures, redeemConfirmation } from "./tavily";

/**
 * Public health: booleans, enums and model names only. No spend, no ceiling, no counters, no
 * timestamps, no store or provider details. `protection` says which safeguard mode is active.
 */
const HEALTH_CACHE_MS = 10_000;

export async function handleHealth(rt: Runtime): Promise<Response> {
  const t = rt.agent.now();
  if (rt.healthCache && t - rt.healthCache.at < HEALTH_CACHE_MS) {
    return new Response(rt.healthCache.body, { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const res = await computeHealth(rt);
  rt.healthCache = { at: t, body: await res.clone().text() };
  return res;
}

async function computeHealth(rt: Runtime): Promise<Response> {
  const { agent } = rt;
  const live = agent.config.liveAi;
  const models = live ? await agent.resolver.health() : null;
  let exhausted = false;
  let protectionDown = false;
  if (live) {
    try {
      exhausted = (await agent.budget.status()).exhausted;
    } catch (e) {
      if (!(e instanceof StoreError)) throw e;
      protectionDown = true;
    }
  }
  const plannerUp = models !== null && models.roles.planner.model !== "unavailable";
  const reason = !plannerUp ? "planner_unavailable" : protectionDown ? "protection_unavailable" : exhausted ? "budget_exhausted" : null;
  return json(
    {
      ok: true,
      // Degraded means the UI must show "AI planner unavailable. Explore manually."
      degraded: reason !== null,
      degradedReason: reason,
      planner: { available: reason === null },
      provider: { configured: models ? models.reason !== "no_api_key" : agent.provider !== null, reachable: models?.reachable ?? false },
      protection: agent.config.protection,
      roles: Object.fromEntries(ROLES.map((r) => [r, models ? models.roles[r].model : "unavailable"])),
      fallbacks: Object.fromEntries(ROLES.map((r) => [r, models ? models.roles[r].chain.slice(1) : []])),
      tavily: { configured: rt.search !== null },
    },
    200,
    { "cache-control": "no-store" },
  );
}

export async function handleClosures(request: Request, rt: Runtime): Promise<Response> {
  // The deadline is fixed at the start of the handler: search and extraction share it (max 45 s).
  const deadlineAt = rt.agent.now() + rt.agent.config.closuresDeadlineMs;
  const g = guardPost(request, rt.agent.config);
  if (g) return g;
  const body = await readBody(request, ClosuresRequestSchema);
  if (!body.ok) return body.res;
  const out: ClosuresResponse = await lookupClosures(
    { config: rt.agent.config, search: rt.search, store: rt.store, limiter: rt.agent.limiter, agent: rt.agent, now: rt.agent.now },
    clientIp(request.headers, { trustedHops: rt.agent.config.trustedProxyHops }),
    rt.closures,
    deadlineAt,
  );
  const status = out.status === "unavailable" && out.reason === "rate_limited" ? 429 : 200;
  return json(out, status, { "cache-control": "no-store", ...(out.status === "unavailable" && out.retryAfterS ? { "retry-after": String(out.retryAfterS) } : {}) });
}

/**
 * Redeems a single-use confirmation token for a closure proposal. Send it only after the user has
 * explicitly confirmed that proposal in the UI; the token is the only way to obtain a mutation
 * record for a news-sourced closure.
 */
export async function handleClosureConfirm(request: Request, rt: Runtime): Promise<Response> {
  const g = guardPost(request, rt.agent.config);
  if (g) return g;
  const body = await readBody(request, ConfirmClosureRequestSchema);
  if (!body.ok) return body.res;
  const respond = (o: ConfirmClosureResponse, status: number) => json(o, status, { "cache-control": "no-store" });
  const ip = clientIp(request.headers, { trustedHops: rt.agent.config.trustedProxyHops });
  const rl = await rt.agent.limiter.consume(`confirm:${ipKey(ip)}`, [{ name: "confirm_per_hour", limit: 60, windowMs: HOUR_MS }]);
  if (rl.error) return respond({ status: "unavailable", reason: "protection_unavailable", message: "Confirmation is unavailable right now." }, 503);
  if (!rl.allowed) return respond({ status: "unavailable", reason: "rate_limited", message: "Too many confirmations. Try again later.", retryAfterS: rl.retryAfterS }, 429);
  const r = await redeemConfirmation(rt.store, body.value.token, rt.agent.now());
  if (r.status === "ok") return respond({ status: "ok", record: r.record }, 200);
  if (r.status === "store_error") return respond({ status: "unavailable", reason: "protection_unavailable", message: "Confirmation is unavailable right now." }, 503);
  return respond({ status: "unavailable", reason: "invalid_or_used", message: "This confirmation is invalid, expired, or already used." }, 410);
}
