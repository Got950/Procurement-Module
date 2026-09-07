import { beforeEach, expect, it } from "vitest";
import { createUser, describeDb, resetData } from "../helpers/db";
import { query } from "@/lib/db";
import { Role } from "@/lib/domain-types";
import { hashPassword, verifyPassword } from "@/lib/password";
import { verifyUserPassword } from "@/lib/auth-users";
import { ConflictError, ValidationError } from "@/lib/errors";
import { PUBLIC_REGISTRATION_ROLES } from "@/lib/public-roles";
import { registerPublicUser, registerPublicUserBody } from "@/server/public-registration";
import { canManageUsers } from "@/lib/rbac/policies";

const STRONG = "StrongPassword12!";

function baseInput(role: string, suffix = Math.random().toString(36).slice(2, 10)) {
  return {
    name: `${role} Registrant`,
    email: `reg.${role.toLowerCase()}.${suffix}@test.local`,
    username: `reg.${role.toLowerCase()}.${suffix}`,
    password: STRONG,
    confirmPassword: STRONG,
    role,
  };
}

describeDb("public registration", () => {
  beforeEach(async () => {
    await resetData();
  });

  it("registers each public role, hashes password, and never returns the hash", async () => {
    for (const role of PUBLIC_REGISTRATION_ROLES) {
      const input = baseInput(role);
      const user = await registerPublicUser(registerPublicUserBody.parse(input));
      expect(user.role).toBe(role);
      expect(user.email).toBe(input.email);
      expect(user.username).toBe(input.username);
      expect(user).not.toHaveProperty("passwordHash");
      expect(JSON.stringify(user)).not.toMatch(/scrypt:|passwordHash/i);

      const row = await query<{ role: string; password_hash: string }>(
        `SELECT role, password_hash FROM users WHERE id = $1`,
        [user.id]
      );
      expect(row.rows[0].role).toBe(role);
      expect(row.rows[0].password_hash).toMatch(/^scrypt:/);
      expect(row.rows[0].password_hash).not.toBe(STRONG);
      expect(await verifyPassword(STRONG, row.rows[0].password_hash)).toBe(true);

      const loggedIn = await verifyUserPassword(input.email, STRONG);
      expect(loggedIn?.id).toBe(user.id);
      expect(loggedIn?.role).toBe(role);
    }
  });

  it("rejects ADMIN registration at the service layer even if forced", async () => {
    await expect(
      registerPublicUser({
        ...baseInput("REQUESTER"),
        role: Role.ADMIN,
      } as never)
    ).rejects.toBeInstanceOf(ValidationError);

    const count = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM users WHERE role = 'ADMIN'`
    );
    expect(Number(count.rows[0].n)).toBe(0);
  });

  it("rejects unknown role at the service layer", async () => {
    await expect(
      registerPublicUser({
        ...baseInput("REQUESTER"),
        role: "SUPERUSER",
      } as never)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects duplicate email/username safely", async () => {
    const first = registerPublicUserBody.parse(baseInput(Role.REQUESTER, "dup"));
    await registerPublicUser(first);
    await expect(registerPublicUser(first)).rejects.toBeInstanceOf(ConflictError);
    await expect(
      registerPublicUser(
        registerPublicUserBody.parse({
          ...baseInput(Role.FINANCE, "other"),
          email: first.email,
        })
      )
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects weak password and mismatched confirmation", async () => {
    await expect(
      registerPublicUser({
        ...baseInput(Role.REQUESTER),
        password: "short",
        confirmPassword: "short",
      } as never)
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      registerPublicUser({
        ...baseInput(Role.REQUESTER),
        password: STRONG,
        confirmPassword: "DifferentPass99!",
      } as never)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("existing users still login and ADMIN RBAC remains intact", async () => {
    const existingId = await createUser(Role.REQUESTER, "Existing User");
    await query(`UPDATE users SET password_hash = $2, email = $3, username = $4 WHERE id = $1`, [
      existingId,
      await hashPassword(STRONG),
      "existing.user@test.local",
      "existing.user",
    ]);

    const adminId = await createUser(Role.ADMIN, "Admin User");
    expect(canManageUsers(Role.ADMIN)).toBe(true);
    expect(canManageUsers(Role.REQUESTER)).toBe(false);
    expect(canManageUsers(Role.MD)).toBe(false);

    const existingLogin = await verifyUserPassword("existing.user@test.local", STRONG);
    expect(existingLogin?.id).toBe(existingId);
    expect(existingLogin?.role).toBe(Role.REQUESTER);

    const registered = await registerPublicUser(
      registerPublicUserBody.parse(baseInput(Role.DIRECTOR, "keep"))
    );
    const newLogin = await verifyUserPassword(registered.email, STRONG);
    expect(newLogin?.role).toBe(Role.DIRECTOR);

    const adminStill = await query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [
      adminId,
    ]);
    expect(adminStill.rows[0].role).toBe(Role.ADMIN);
  });
});
