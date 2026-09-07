import { z } from "zod";
import { prisma, query } from "@/lib/db";
import { Role } from "@/lib/domain-types";
import { isPublicRegistrationRole, type PublicRegistrationRole } from "@/lib/public-roles";
import { assertPasswordPolicy, hashPassword } from "@/lib/password";
import { ConflictError, ValidationError } from "@/lib/errors";
import { appendAudit } from "@/server/audit-service";

export const registerPublicUserBody = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    email: z.string().trim().email().max(200),
    username: z.string().trim().min(1, "Username is required").max(100),
    password: z.string().min(1).max(200),
    confirmPassword: z.string().min(1).max(200),
    role: z.enum([
      Role.REQUESTER,
      Role.TEAM_LEADER,
      Role.PROCUREMENT,
      Role.FINANCE,
      Role.DIRECTOR,
      Role.MD,
    ]),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match",
        path: ["confirmPassword"],
      });
    }
  });

export type RegisterPublicUserInput = z.infer<typeof registerPublicUserBody>;

export type RegisteredPublicUser = {
  id: string;
  email: string;
  username: string | null;
  name: string;
  role: PublicRegistrationRole;
};

/**
 * Create a user via public registration. Role must already be on the allowlist
 * (Zod + runtime guard). ADMIN and any unknown role are rejected.
 */
export async function registerPublicUser(
  input: RegisterPublicUserInput
): Promise<RegisteredPublicUser> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();
  const role = input.role;

  if (!name) throw new ValidationError("Name is required");
  if (!email || !username) {
    throw new ValidationError("Email and username are required");
  }
  // Defense in depth: never trust role beyond the explicit public allowlist.
  if (!isPublicRegistrationRole(role) || String(role) === Role.ADMIN) {
    throw new ValidationError("Invalid role");
  }
  if (input.password !== input.confirmPassword) {
    throw new ValidationError("Passwords do not match");
  }
  assertPasswordPolicy(input.password);

  const dup = await query(
    `SELECT id FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2 LIMIT 1`,
    [email, username]
  );
  if (dup.rows.length > 0) {
    throw new ConflictError("Email or username already in use");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email,
      username,
      name,
      role,
      passwordHash,
      isActive: true,
      department: null,
    },
  });

  await appendAudit({
    entityType: "User",
    entityId: String(user.id),
    action: "PUBLIC_REGISTER",
    actorId: String(user.id),
    diff: { role, email },
  });

  return {
    id: String(user.id),
    email: String(user.email),
    username: user.username != null ? String(user.username) : null,
    name: String(user.name),
    role: user.role as PublicRegistrationRole,
  };
}
