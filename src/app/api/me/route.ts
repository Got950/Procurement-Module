import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/db";

/** Auth optional: unauthenticated clients get `{ user: null }` with 401. */
export const GET = withApiHandler({ auth: false, body: false })(async ({ session }) => {
  if (!session) return NextResponse.json({ user: null }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, name: true, email: true, role: true, department: true },
  });
  return NextResponse.json({ user });
});
