/**
 * One structured JSON line per operational event. Fields are primitives only; there are never
 * secrets, user text, or raw IPs here (an IP is shown only as a short salted hash).
 * Repeats of the same event are capped per minute so an attacker cannot flood the logs.
 */
import { createHash, randomBytes } from "node:crypto";

export type LogLevel = "info" | "warn";
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type LogSink = (level: LogLevel, line: string) => void;

const defaultSink: LogSink = (level, line) => {
  if (level === "warn") console.warn(line);
  else console.info(line);
};

let sink: LogSink = defaultSink;
/** Tests capture lines with this; pass null to restore the console. */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? defaultSink;
  windows.clear();
}

const PER_MINUTE = 20;
const windows = new Map<string, { start: number; n: number }>();

const salt = randomBytes(8).toString("hex");

/** A short, salted, non-reversible tag for correlating one client in logs. */
export function ipTag(ip: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 8);
}

function clean(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    out[k] = typeof v === "string" ? v.slice(0, 120) : v;
  }
  return out;
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}, now: number = Date.now()): void {
  const w = windows.get(event);
  if (!w || now - w.start >= 60_000) windows.set(event, { start: now, n: 1 });
  else if (++w.n > PER_MINUTE) return;
  sink(level, JSON.stringify({ svc: "worldseed-ai", ts: new Date(now).toISOString(), level, event, ...clean(fields) }));
}
