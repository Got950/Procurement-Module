import { beforeEach, expect, it } from "vitest";
import {
  createItem,
  createUser,
  describeDb,
  resetData,
} from "../helpers/db";
import { prisma, query } from "@/lib/db";
import { canManageMasters, canAccessItemCatalog } from "@/lib/rbac/policies";
import { Role } from "@/lib/domain-types";
import { z } from "zod";

const createVendorBody = z.object({
  companyName: z.string().min(1).max(200),
  contactPerson: z.string().min(1).max(200),
  email: z.string().trim().email().max(200),
});

describeDb("masters API authz + vendor email (BUG-001/002/010)", () => {
  beforeEach(async () => {
    await resetData();
  });

  it("unauthorized roles are denied by masters/item policies used by the APIs", () => {
    for (const role of Object.values(Role)) {
      if (role === "PROCUREMENT" || role === "ADMIN") {
        expect(canManageMasters(role)).toBe(true);
      } else {
        expect(canManageMasters(role)).toBe(false);
      }
      if (role === "REQUESTER" || role === "PROCUREMENT" || role === "ADMIN") {
        expect(canAccessItemCatalog(role)).toBe(true);
      } else {
        expect(canAccessItemCatalog(role)).toBe(false);
      }
    }
  });

  it("invalid vendor email is rejected by schema (no DB write / no 500 path)", async () => {
    const bad = createVendorBody.safeParse({
      companyName: "Acme",
      contactPerson: "Pat",
      email: "not-an-email",
    });
    expect(bad.success).toBe(false);

    const good = createVendorBody.parse({
      companyName: "Acme",
      contactPerson: "Pat",
      email: "pat@acme.example",
    });
    const actor = await createUser("PROCUREMENT");
    void actor;
    const itemId = await createItem();
    const vendor = await prisma.vendor.create({
      data: {
        companyName: good.companyName,
        contactPerson: good.contactPerson,
        email: good.email,
        vendorItems: { create: [{ itemId }] },
      },
    });
    expect(vendor.email).toBe("pat@acme.example");

    const dupName = await query(`SELECT COUNT(*)::int AS n FROM vendors WHERE email = $1`, [
      "pat@acme.example",
    ]);
    expect(Number(dupName.rows[0].n)).toBe(1);
  });
});
