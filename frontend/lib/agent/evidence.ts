/** Browser side of POST /api/evidence: news sources about what happened after the Key Bridge collapse. Sources only; nothing here is a result. */
import type { EvidenceResponse, EvidenceTopic } from "./protocol";

export async function fetchEvidence(topic: EvidenceTopic, opts: { fetchImpl?: typeof fetch; baseUrl?: string; signal?: AbortSignal } = {}): Promise<EvidenceResponse> {
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let res: Response;
  try {
    res = await f(`${opts.baseUrl ?? ""}/api/evidence`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic }), signal: opts.signal });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return { status: "unavailable", reason: "upstream_error", message: "The evidence service could not be reached." };
  }
  try {
    const body = (await res.json()) as EvidenceResponse;
    if (body && typeof body === "object" && (body.status === "ok" || body.status === "unavailable")) return body;
  } catch {
    /* fall through */
  }
  return { status: "unavailable", reason: "upstream_error", message: `The evidence service answered with status ${res.status}.` };
}
