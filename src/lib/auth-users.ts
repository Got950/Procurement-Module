import { query } from "@/lib/db";
import { isRole, type Role } from "@/lib/domain-types";
import { hashPassword, verifyPassword } from "@/lib/password";

export type AuthUserRow = {
  id: string;
  email: string;
  username: string | null;
  name: string;
  role: Role;
  passwordHash: string | null;
  isActive: boolean;
};

export async function findUserByLogin(identifier: string): Promise<AuthUserRow | null> {
  const login = identifier.trim().toLowerCase();
  if (!login) return null;
  const r = await query(
    `SELECT id, email, username, name, role, password_hash, is_active
     FROM users
     WHERE is_active = TRUE
       AND (LOWER(email) = $1 OR LOWER(username) = $1)
     LIMIT 1`,
    [login]
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  // A stored role outside the known set has no policy, so deny rather than
  // issue a session carrying it.
  if (!isRole(row.role)) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    username: row.username != null ? String(row.username) : null,
    name: String(row.name),
    role: row.role,
    passwordHash: row.password_hash != null ? String(row.password_hash) : null,
    isActive: Boolean(row.is_active),
  };
}

export async function verifyUserPassword(identifier: string, password: string) {
  const user = await findUserByLogin(identifier);
  if (!user?.passwordHash) return null;
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  return user;
}

export { hashPassword };
