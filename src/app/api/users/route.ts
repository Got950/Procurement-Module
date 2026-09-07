import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";

/** Public user list removed — use password login and /api/admin/users (admin only). */
export const GET = withApiHandler({ auth: false, body: false })(async () => {
  return NextResponse.json({ error: "Not available" }, { status: 404 });
});
