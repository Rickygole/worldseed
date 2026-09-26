/**
 * Optional Cloudflare Turnstile check for new missions (server side).
 *
 * Enforced only when WS_TURNSTILE_SECRET is set. The browser obtains a token from the Turnstile
 * widget and sends it as `turnstileToken` in the /api/agent/parse body (the mission start); the
 * server verifies it with one call to the siteverify endpoint. Tokens are single use, so the check
 * runs once per new mission, after the in-memory caps, so it cannot be turned into a flood of
 * outbound calls. A verification service that cannot be reached counts as a failure (fail closed).
 * The token and the secret are never logged.
 */
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type HumanCheck = (token: string | undefined, clientIp: string) => Promise<"ok" | "failed" | "unavailable">;

export function createTurnstileVerifier(opts: { secret: string; fetchImpl?: typeof fetch; timeoutMs?: number }): HumanCheck {
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return async (token, clientIp) => {
    if (!token || token.length > 2048) return "failed";
    const form = new URLSearchParams({ secret: opts.secret, response: token });
    // Only a real address is forwarded; the shared "local" and "unknown" buckets are not addresses.
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(clientIp)) form.set("remoteip", clientIp);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 3_000);
    try {
      const res = await f(SITEVERIFY_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString(), signal: ctl.signal });
      if (!res.ok) return "unavailable";
      const body = (await res.json()) as { success?: unknown };
      return body && body.success === true ? "ok" : "failed";
    } catch {
      return "unavailable";
    } finally {
      clearTimeout(timer);
    }
  };
}
