import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { AuthorizationError, UnauthorizedError } from "@/lib/errors";
import { prisma, query } from "@/lib/db";
import { canManageMasters } from "@/lib/rbac/policies";
import { appendAudit } from "@/server/audit-service";

const vendorsQuery = z.object({
  itemId: z.string().min(1).optional(),
});

const createVendorBody = z.object({
  companyName: z.string().min(1).max(200),
  contactPerson: z.string().min(1).max(200),
  email: z.string().trim().email().max(200),
  phone: z.string().max(50).optional(),
  city: z.string().max(100).optional(),
  gstNumber: z.string().max(50).optional(),
  licenseInfo: z.string().max(500).optional(),
  averageDeliveryDays: z.number().optional(),
  paymentTerms: z.string().max(200).optional(),
  rating: z.number().optional(),
  itemIds: z.array(z.string()).optional(),
});

export const GET = withApiHandler({
  query: vendorsQuery,
  body: false,
})(async ({ session, query: q }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageMasters(session.role)) throw new AuthorizationError();
  const itemId = q.itemId;
  const vendors = itemId
    ? (
        await query(
          `
          SELECT v.*
          FROM vendors v
          INNER JOIN vendor_items vi ON vi.vendor_id = v.id
          WHERE vi.item_id = $1
          ORDER BY v.company_name ASC
          `,
          [itemId]
        )
      ).rows.map((r) => ({
        id: r.id,
        companyName: r.company_name,
        contactPerson: r.contact_person,
        email: r.email,
        phone: r.phone,
        city: r.city,
        gstNumber: r.gst_number,
        licenseInfo: r.license_info,
        averageDeliveryDays: r.average_delivery_days,
        paymentTerms: r.payment_terms,
        rating: r.rating,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
    : await prisma.vendor.findMany({
        include: { vendorItems: { include: { item: true } } },
        orderBy: { companyName: "asc" },
      });
  return NextResponse.json({ vendors });
});

export const POST = withApiHandler({ body: createVendorBody })(async ({ session, body }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageMasters(session.role)) throw new AuthorizationError();
  const v = await prisma.vendor.create({
    data: {
      companyName: body.companyName,
      contactPerson: body.contactPerson,
      email: body.email,
      phone: body.phone,
      city: body.city,
      gstNumber: body.gstNumber,
      licenseInfo: body.licenseInfo,
      averageDeliveryDays: body.averageDeliveryDays ?? 14,
      paymentTerms: body.paymentTerms ?? "Net 30",
      rating: body.rating ?? 4,
      vendorItems: {
        create: (body.itemIds ?? []).map((itemId) => ({ itemId })),
      },
    },
    include: { vendorItems: true },
  });
  await appendAudit({
    entityType: "Vendor",
    entityId: v.id,
    action: "CREATE",
    actorId: session.sub,
    diff: { companyName: v.companyName },
  });
  return NextResponse.json({ vendor: v });
});
