import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Role } from "@/lib/domain-types";
import {
  canAccessItemCatalog,
  canFinance,
  canManageMasters,
  canProcurement,
} from "@/lib/rbac/policies";
import { AuthorizationError } from "@/lib/errors";

/** Mirrors the Zod schemas used by vendor create/patch routes. */
const createVendorEmail = z.string().trim().email().max(200);
const patchVendorEmail = z.string().trim().email().max(200).optional();

describe("BUG-001 / BUG-002 / BUG-003 least-privilege policies", () => {
  const roles = Object.values(Role);

  it("vendors and Gmail status require procurement/admin", () => {
    for (const role of roles) {
      const allowed = role === "PROCUREMENT" || role === "ADMIN";
      expect(canManageMasters(role), `vendors:${role}`).toBe(allowed);
      expect(canProcurement(role), `gmail:${role}`).toBe(allowed);
    }
  });

  it("item catalog allows requester + procurement + admin only", () => {
    for (const role of roles) {
      const allowed = role === "REQUESTER" || role === "PROCUREMENT" || role === "ADMIN";
      expect(canAccessItemCatalog(role), role).toBe(allowed);
    }
  });
});

describe("BUG-010 vendor email validation", () => {
  it("accepts valid emails", () => {
    expect(createVendorEmail.parse("vendor@example.com")).toBe("vendor@example.com");
    expect(createVendorEmail.parse("  buyer@must.co.in  ")).toBe("buyer@must.co.in");
  });

  it("rejects invalid / empty / malformed emails without throwing non-Zod errors", () => {
    for (const bad of ["not-an-email", "", " ", "a@", "@b.com", "a@b", "x".repeat(250) + "@e.com"]) {
      const r = createVendorEmail.safeParse(bad);
      expect(r.success, String(bad)).toBe(false);
    }
  });

  it("optional patch email rejects invalid when provided", () => {
    expect(patchVendorEmail.safeParse(undefined).success).toBe(true);
    expect(patchVendorEmail.safeParse("ok@example.com").success).toBe(true);
    expect(patchVendorEmail.safeParse("nope").success).toBe(false);
  });
});

describe("BUG-011 authorize-before-validation contract", () => {
  it("finance authorize helper denies non-finance before schema details matter", () => {
    const authorize = (role: Role) => {
      if (!canFinance(role)) throw new AuthorizationError();
    };
    expect(() => authorize("REQUESTER")).toThrow(AuthorizationError);
    expect(() => authorize("TEAM_LEADER")).toThrow(AuthorizationError);
    expect(() => authorize("FINANCE")).not.toThrow();
    expect(() => authorize("ADMIN")).not.toThrow();
  });
});
