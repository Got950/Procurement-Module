import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

/** Liveness: the process is running. Deliberately checks no dependency, so a
 *  database outage does not cause the orchestrator to kill healthy tasks. */
export const GET = withApiHandler({ auth: false, body: false, rateLimit: false })(async () => {
  return NextResponse.json({ status: "ok" });
});
