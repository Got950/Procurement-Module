import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { AuthorizationError, UnauthorizedError, ValidationError, ConflictError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { canManageUsers } from "@/lib/rbac/policies";
import { roleCodeFromLabel } from "@/lib/role-code";

const createRoleBody = z.object({
  label: z.string().min(1),
});

export const GET = withApiHandler({ body: false })(async ({ session }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageUsers(session.role)) throw new AuthorizationError();
  const roles = await prisma.role.findMany({ orderBy: { label: "asc" } });
  return NextResponse.json({ roles });
});

export const POST = withApiHandler({ body: createRoleBody })(async ({ session, body }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageUsers(session.role)) throw new AuthorizationError();
  const label = body.label.trim();
  if (!label) throw new ValidationError("Role name required");

  const code = roleCodeFromLabel(label);
  const existing = await prisma.role.findFirst({ where: { code } });
  if (existing) {
    throw new ConflictError(`Role code ${code} already exists`);
  }

  const role = await prisma.role.create({ data: { code, label } });
  return NextResponse.json({ role });
});
