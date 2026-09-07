import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { AuthorizationError, UnauthorizedError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { canManageMasters } from "@/lib/rbac/policies";
import { appendAudit } from "@/server/audit-service";

const patchVendorBody = z.object({
  companyName: z.string().min(1).max(200).optional(),
  contactPerson: z.string().min(1).max(200).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().max(50).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  gstNumber: z.string().max(50).nullable().optional(),
  licenseInfo: z.string().max(500).nullable().optional(),
  averageDeliveryDays: z.number().optional(),
  paymentTerms: z.string().max(200).optional(),
  rating: z.number().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "PENDING"]).optional(),
  itemIds: z.array(z.string()).optional(),
});

export const GET = withApiHandler({
  params: idParam,
  body: false,
})(async ({ session, params }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageMasters(session.role)) throw new AuthorizationError();
  const vendor = await prisma.vendor.findUnique({
    where: { id: params.id },
    include: { vendorItems: { include: { item: true } } },
  });
  if (!vendor) throw new NotFoundError();
  return NextResponse.json({ vendor });
});

export const PATCH = withApiHandler({
  params: idParam,
  body: patchVendorBody,
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageMasters(session.role)) throw new AuthorizationError();
  const vendor = await prisma.vendor.update({
    where: { id: params.id },
    data: {
      companyName: body.companyName,
      contactPerson: body.contactPerson,
      email: body.email,
      phone: body.phone,
      city: body.city,
      gstNumber: body.gstNumber,
      licenseInfo: body.licenseInfo,
      averageDeliveryDays: body.averageDeliveryDays,
      paymentTerms: body.paymentTerms,
      rating: body.rating,
      status: body.status,
    },
  });
  if (!vendor) throw new NotFoundError();
  if (body.itemIds) {
    await prisma.vendorItem.deleteMany({ where: { vendorId: params.id } });
    if (body.itemIds.length) {
      await prisma.vendorItem.createMany({
        data: body.itemIds.map((itemId) => ({ vendorId: params.id, itemId })),
      });
    }
  }
  await appendAudit({
    entityType: "Vendor",
    entityId: params.id,
    action: "UPDATE",
    actorId: session.sub,
    diff: body as object,
  });
  return NextResponse.json({ vendor });
});
