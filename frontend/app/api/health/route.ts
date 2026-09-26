import { handleHealth } from "../../../lib/server/handlers";
import { getRuntime } from "../../../lib/server/runtime";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleHealth(getRuntime());
}
