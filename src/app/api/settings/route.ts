import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { UnauthorizedError } from "@/lib/errors";
import { changeOwnPassword } from "@/server/password-reset";
import { prisma } from "@/lib/db";

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

export const GET = withApiHandler({ body: false })(async ({ session }) => {
  if (!session) throw new UnauthorizedError();
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) throw new UnauthorizedError();
  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username ?? null,
      role: user.role,
      department: user.department ?? null,
    },
  });
});

export const PATCH = withApiHandler({ body: changePasswordBody })(async ({ session, body }) => {
  if (!session) throw new UnauthorizedError();
  await changeOwnPassword(session.sub, body.currentPassword, body.newPassword, session.jti);
  return NextResponse.json({ ok: true, message: "Password updated." });
});
