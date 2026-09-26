/** Route logic for /api/health and /api/closures, kept out of the route files so tests can call it. */
import {
  ClosuresRequestSchema,
  ConfirmClosureRequestSchema,
  type ClosuresResponse,
  type ConfirmClosureResponse,
} from "../agent/protocol";
import { guardPost, json, readBody, requestIp, requesterKey } from "./agentService";
import { ipTag, logEvent } from "./log";
import { ROLES } from "./models";
import type { Runtime } from "./runtime";
import { lookupClosures, redeemConfirmation } from "./tavily";

/**
 * Public health: booleans, enums and model names only. No spend, no ceiling, no counters, no
 * timestamps, no store or provider details. `protection` says which safeguard mode is active.
 */
/** The public health body is rebuilt at most once a minute per process, and never touches the store. */
const HEALTH_CACHE_MS = 60_000;
/** A store failure seen in the last two minutes makes health report protection_unavailable. */
const STORE_DOWN_MS = 120_000;

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
  // The model listing is cached by the resolver (10 minutes); the budget is the process's last observed
  // total; the store is never read here, so polling health cannot cost a store command.
  const models = live ? await agent.resolver.health() : null;
  const exhausted = live ? (agent.budget.cached()?.exhausted ?? false) : false;
  // Protection is down when a store failure was seen recently OR this process's command meter has
  // tripped (a state, not an event: it stays reported for as long as the allowance is used up).
  const meterTripped = live && rt.meter !== undefined && rt.meter.exhausted();
  const protectionDown = live && (meterTripped || (agent.signals !== undefined && agent.signals.storeDownAt > 0 && agent.now() - agent.signals.storeDownAt < STORE_DOWN_MS));
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
      tavily: { configured: rt.search !== null && rt.confirmSecret !== "" },
    },
    200,
    { "cache-control": "no-store" },
  );
}

function closuresRefusal(retryAfterS: number): Response {
  const o: ClosuresResponse = { status: "unavailable", reason: "rate_limited", message: "Too many closure searches from this connection. Try again later.", retryAfterS };
  return json(o, 429, { "cache-control": "no-store", "retry-after": String(retryAfterS) });
}

export async function handleClosures(request: Request, rt: Runtime): Promise<Response> {
  // The deadline is fixed at the start of the handler: search and extraction share it (max 45 s).
  const deadlineAt = rt.agent.now() + rt.agent.config.closuresDeadlineMs;
  const g = guardPost(request, rt.agent.config);
  if (g) return g;
  // The per-IP limit runs first, in memory, before the cache is read or any store command is sent.
  const ip = requestIp(request, rt.agent.config);
  const door = rt.agent.frontDoor.check("closures", ip);
  if (!door.ok) {
    logEvent("info", "front_door_refused", { kind: "closures", ip: ipTag(ip) });
    return closuresRefusal(door.retryAfterS);
  }
  const body = await readBody(request, ClosuresRequestSchema);
  if (!body.ok) return body.res;
  const out: ClosuresResponse = await lookupClosures(
    { config: rt.agent.config, search: rt.search, store: rt.store, limiter: rt.agent.limiter, agent: rt.agent, now: rt.agent.now, confirmSecret: rt.confirmSecret },
    ip,
    rt.closures,
    deadlineAt,
    requesterKey(request, rt.agent.config),
  );
  const status = out.status === "unavailable" && out.reason === "rate_limited" ? 429 : 200;
  return json(out, status, { "cache-control": "no-store", ...(out.status === "unavailable" && out.retryAfterS ? { "retry-after": String(out.retryAfterS) } : {}) });
}

/**
 * Redeems a single-use, requester-bound confirmation token for a closure proposal. Send it only
 * after the user has explicitly confirmed that proposal in the UI; the token is the only way to
 * obtain a mutation record for a news-sourced closure. Verification is stateless (HMAC); the store
 * is touched once, to mark the token used.
 */
export async function handleClosureConfirm(request: Request, rt: Runtime): Promise<Response> {
  const g = guardPost(request, rt.agent.config);
  if (g) return g;
  const respond = (o: ConfirmClosureResponse, status: number) => json(o, status, { "cache-control": "no-store" });
  const ip = requestIp(request, rt.agent.config);
  const door = rt.agent.frontDoor.check("confirm", ip);
  if (!door.ok) return respond({ status: "unavailable", reason: "rate_limited", message: "Too many confirmations. Try again later.", retryAfterS: door.retryAfterS }, 429);
  const body = await readBody(request, ConfirmClosureRequestSchema);
  if (!body.ok) return body.res;
  if (!rt.confirmSecret) return respond({ status: "unavailable", reason: "protection_unavailable", message: "Confirmation is unavailable right now." }, 503);
  let catalog;
  try {
    catalog = await rt.agent.loadCatalog();
  } catch {
    return respond({ status: "unavailable", reason: "protection_unavailable", message: "Confirmation is unavailable right now." }, 503);
  }
  const r = await redeemConfirmation(rt.store, rt.confirmSecret, body.value.token, requesterKey(request, rt.agent.config), rt.agent.now(), catalog);
  if (r.status === "ok") return respond({ status: "ok", record: r.record }, 200);
  if (r.status === "store_error") return respond({ status: "unavailable", reason: "protection_unavailable", message: "Confirmation is unavailable right now." }, 503);
  if (r.status === "expired") return respond({ status: "unavailable", reason: "expired", message: "This confirmation has expired. Search again." }, 410);
  if (r.status === "wrong_requester") return respond({ status: "unavailable", reason: "wrong_requester", message: "This confirmation was issued to a different connection." }, 403);
  return respond({ status: "unavailable", reason: "invalid_or_used", message: "This confirmation is invalid or already used." }, 410);
}
