import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/db";
import { UnauthorizedError } from "@/lib/errors";

export const GET = withApiHandler({ body: false })(async ({ session }) => {
  if (!session) throw new UnauthorizedError();
  const items = await prisma.notification.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ notifications: items });
});
