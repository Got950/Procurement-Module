import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { AuthorizationError, UnauthorizedError, ValidationError, ConflictError } from "@/lib/errors";
import { prisma, query } from "@/lib/db";
import { canManageUsers } from "@/lib/rbac/policies";
import { assertPasswordPolicy, hashPassword } from "@/lib/password";

const createUserBody = z.object({
  email: z.string().trim().email().max(200),
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
  role: z.string().min(1).max(64),
  name: z.string().max(200).optional(),
});

export const GET = withApiHandler({ body: false })(async ({ session }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageUsers(session.role)) throw new AuthorizationError();
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      role: true,
      department: true,
      isActive: true,
      passwordHash: true,
    },
  });
  return NextResponse.json({
    users: users.map((u: Record<string, unknown>) => ({
      id: u.id,
      email: u.email,
      username: u.username ?? null,
      name: u.name,
      role: u.role,
      department: u.department ?? null,
      isActive: u.isActive ?? true,
      hasPassword: Boolean(u.passwordHash),
    })),
  });
});

export const POST = withApiHandler({ body: createUserBody })(async ({ session, body }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageUsers(session.role)) throw new AuthorizationError();

  const email = body.email.trim().toLowerCase();
  const username = body.username.trim().toLowerCase();
  const password = body.password;
  const role = body.role.trim().toUpperCase();
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : username || email.split("@")[0] || "User";

  if (!email || !username || !password || !role) {
    throw new ValidationError("Email, username, password, and role are required");
  }
  assertPasswordPolicy(password);

  const roleRow = await prisma.role.findFirst({ where: { code: role } });
  if (!roleRow) {
    throw new ValidationError("Invalid role - add it under User management first");
  }

  const dup = await query(
    `SELECT id FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2 LIMIT 1`,
    [email, username]
  );
  if (dup.rows.length > 0) {
    throw new ConflictError("Email or username already in use");
  }

  const user = await prisma.user.create({
    data: {
      email,
      username,
      name,
      role,
      passwordHash: await hashPassword(password),
      isActive: true,
      department: null,
    },
  });

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role,
    },
  });
});
