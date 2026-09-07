import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { query } from "@/lib/db";
import { getSessionSecret } from "@/lib/session-secret";

export const dynamic = "force-dynamic";

/** Readiness: this task can serve traffic. Fails while configuration is invalid
 *  or the database is unreachable, so a misconfigured deploy never receives
 *  requests instead of 500-ing every one of them. */
export const GET = withApiHandler({ auth: false, body: false, rateLimit: false })(async () => {
  const checks: Record<string, "ok" | "fail"> = {};
  try {
    getSessionSecret();
    checks.config = "ok";
  } catch {
    checks.config = "fail";
  }
  try {
    await query("SELECT 1");
    checks.database = "ok";
  } catch {
    checks.database = "fail";
  }

  const ready = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    { status: ready ? "ready" : "not_ready", checks },
    { status: ready ? 200 : 503 }
  );
});
