import { handlePlan } from "../../../../lib/server/agentService";
import { getRuntime } from "../../../../lib/server/runtime";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handlePlan(request, getRuntime().agent);
}
