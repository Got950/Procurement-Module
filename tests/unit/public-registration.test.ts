import { describe, expect, it } from "vitest";
import { Role } from "@/lib/domain-types";
import {
  isPublicRegistrationRole,
  PUBLIC_REGISTRATION_ROLE_OPTIONS,
  PUBLIC_REGISTRATION_ROLES,
} from "@/lib/public-roles";
import { registerPublicUserBody } from "@/server/public-registration";

describe("public registration allowlist", () => {
  it("exposes the six business roles and never includes ADMIN", () => {
    expect([...PUBLIC_REGISTRATION_ROLES]).toEqual([
      Role.REQUESTER,
      Role.TEAM_LEADER,
      Role.PROCUREMENT,
      Role.FINANCE,
      Role.DIRECTOR,
      Role.MD,
    ]);
    expect(PUBLIC_REGISTRATION_ROLES.includes(Role.ADMIN as never)).toBe(false);
    expect(PUBLIC_REGISTRATION_ROLE_OPTIONS.every((o) => String(o.code) !== Role.ADMIN)).toBe(
      true
    );
    expect(PUBLIC_REGISTRATION_ROLE_OPTIONS).toHaveLength(6);
  });

  it("accepts only exact canonical public role codes", () => {
    for (const role of PUBLIC_REGISTRATION_ROLES) {
      expect(isPublicRegistrationRole(role)).toBe(true);
    }
    expect(isPublicRegistrationRole(Role.ADMIN)).toBe(false);
    expect(isPublicRegistrationRole("admin")).toBe(false);
    expect(isPublicRegistrationRole("ADMIN")).toBe(false);
    expect(isPublicRegistrationRole("TL")).toBe(false);
    expect(isPublicRegistrationRole("team_leader")).toBe(false);
    expect(isPublicRegistrationRole("SUPERUSER")).toBe(false);
    expect(isPublicRegistrationRole("'; DROP TABLE users; --")).toBe(false);
    expect(isPublicRegistrationRole("")).toBe(false);
    expect(isPublicRegistrationRole(null)).toBe(false);
    expect(isPublicRegistrationRole(undefined)).toBe(false);
    expect(isPublicRegistrationRole(1)).toBe(false);
  });
});

describe("registerPublicUserBody schema", () => {
  const valid = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    username: "ada.lovelace",
    password: "SecurePass123!",
    confirmPassword: "SecurePass123!",
    role: Role.REQUESTER,
  };

  it("accepts valid payloads for every public role", () => {
    for (const role of PUBLIC_REGISTRATION_ROLES) {
      const parsed = registerPublicUserBody.parse({ ...valid, role });
      expect(parsed.role).toBe(role);
    }
  });

  it("rejects ADMIN and unknown / malformed roles", () => {
    for (const role of [
      Role.ADMIN,
      "ADMIN",
      "admin",
      "TL",
      "unknown",
      "'; DROP TABLE users; --",
      "",
      42,
      null,
      undefined,
      ["REQUESTER"],
      { role: "REQUESTER" },
    ]) {
      const result = registerPublicUserBody.safeParse({ ...valid, role });
      expect(result.success).toBe(false);
    }
  });

  it("rejects missing role", () => {
    const { role: _role, ...withoutRole } = valid;
    void _role;
    expect(registerPublicUserBody.safeParse(withoutRole).success).toBe(false);
  });

  it("rejects invalid email", () => {
    expect(
      registerPublicUserBody.safeParse({ ...valid, email: "not-an-email" }).success
    ).toBe(false);
  });

  it("rejects password confirmation mismatch", () => {
    const result = registerPublicUserBody.safeParse({
      ...valid,
      confirmPassword: "DifferentPass99!",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown extra fields (strict)", () => {
    expect(
      registerPublicUserBody.safeParse({ ...valid, isAdmin: true }).success
    ).toBe(false);
  });
});
