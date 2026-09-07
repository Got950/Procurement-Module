import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/db";
import { AuthorizationError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { canAccessItemCatalog, canManageMasters } from "@/lib/rbac/policies";
import { appendAudit } from "@/server/audit-service";

const createItemBody = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  uom: z.string().trim().min(1).max(32),
  specNotes: z.string().trim().max(2000).nullable().optional(),
  regulatoryTag: z.string().trim().max(100).nullable().optional(),
});

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export const GET = withApiHandler({ body: false })(async ({ session }) => {
  if (!session) throw new UnauthorizedError();
  if (!canAccessItemCatalog(session.role)) throw new AuthorizationError();
  const items = await prisma.item.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ items });
});

export const POST = withApiHandler({
  body: createItemBody,
  authorize: (session) => {
    if (!canManageMasters(session.role)) throw new AuthorizationError();
  },
})(async ({ session, body }) => {
  if (!session) throw new UnauthorizedError();
  try {
    const item = await prisma.item.create({
      data: {
        sku: body.sku,
        name: body.name,
        category: body.category,
        uom: body.uom,
        specNotes: body.specNotes ?? null,
        regulatoryTag: body.regulatoryTag ?? null,
      },
    });
    await appendAudit({
      entityType: "Item",
      entityId: item.id,
      action: "CREATE",
      actorId: session.sub,
      diff: body as object,
    });
    return NextResponse.json({ item });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError("An item with this SKU already exists.");
    }
    throw error;
  }
});
