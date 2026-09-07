import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "@/lib/session";

export async function requireSession(): Promise<SessionPayload | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return session;
}

export function isSession(s: SessionPayload | NextResponse): s is SessionPayload {
  return !(s instanceof NextResponse);
}
