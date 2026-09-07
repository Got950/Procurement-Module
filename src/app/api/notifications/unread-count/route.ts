import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/db";
import { UnauthorizedError } from "@/lib/errors";

export const GET = withApiHandler({ body: false })(async ({ session }) => {
  if (!session) throw new UnauthorizedError();
  const count = await prisma.notification.count({
    where: { userId: session.sub, readAt: null },
  });
  return NextResponse.json({ count });
});
