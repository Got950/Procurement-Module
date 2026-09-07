import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import {
  AuthorizationError,
  UnauthorizedError,
  ValidationError,
  NotFoundError,
  ConflictError,
} from "@/lib/errors";
import { revokeSession } from "@/lib/session";
import { prisma, query } from "@/lib/db";
import { canManageUsers } from "@/lib/rbac/policies";
import { adminSetUserPassword } from "@/server/password-reset";

const setPasswordBody = z.object({
  password: z.string().min(1).max(200),
});

export const PATCH = withApiHandler({
  params: idParam,
  body: setPasswordBody,
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageUsers(session.role)) throw new AuthorizationError();
  await adminSetUserPassword(session.sub, params.id, body.password);
  return NextResponse.json({ ok: true, message: "Password updated. User must sign in again." });
});

export const DELETE = withApiHandler({
  params: idParam,
  body: false,
})(async ({ session, params }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageUsers(session.role)) throw new AuthorizationError();

  const id = params.id;
  if (!id?.trim()) throw new ValidationError("User id required");

  if (id === session.sub) {
    throw new ValidationError("You cannot delete your own account");
  }

  const target = await prisma.user.findFirst({ where: { id } });
  if (!target) throw new NotFoundError("User not found");

  const count = await query<{ n: string }>("SELECT COUNT(*)::text AS n FROM users");
  const total = Number(count.rows[0]?.n ?? 0);
  if (total <= 1) {
    throw new ValidationError("Cannot delete the last user in the system");
  }

  const indentRef = await query(
    `SELECT COUNT(*)::text AS n FROM indents WHERE requester_id = $1`,
    [id]
  );
  if (Number(indentRef.rows[0]?.n ?? 0) > 0) {
    throw new ConflictError("User has indents - clear indents first or reassign requester");
  }

  try {
    await revokeSession(null, id);
    await prisma.user.deleteMany({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    throw new ConflictError("User is linked to other records and cannot be deleted");
  }
});
