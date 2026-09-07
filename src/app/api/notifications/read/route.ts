import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/db";
import { UnauthorizedError } from "@/lib/errors";

const readBody = z.object({
  ids: z.array(z.string().min(1)).optional(),
});

export const POST = withApiHandler({ body: readBody })(async ({ session, body }) => {
  if (!session) throw new UnauthorizedError();
  if (body.ids?.length) {
    await prisma.notification.updateMany({
      where: { userId: session.sub, id: { in: body.ids } },
      data: { readAt: new Date() },
    });
  } else {
    await prisma.notification.updateMany({
      where: { userId: session.sub, readAt: null },
      data: { readAt: new Date() },
    });
  }
  return NextResponse.json({ ok: true });
});
