import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { prisma, query } from "@/lib/db";
import {
  AuthorizationError,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { canManageMasters } from "@/lib/rbac/policies";
import { appendAudit } from "@/server/audit-service";

const patchItemBody = z.object({
  sku: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  uom: z.string().trim().min(1).max(32).optional(),
  specNotes: z.string().trim().max(2000).nullable().optional(),
  regulatoryTag: z.string().trim().max(100).nullable().optional(),
});

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export const GET = withApiHandler({
  params: idParam,
  body: false,
})(async ({ session, params }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageMasters(session.role)) throw new AuthorizationError();
  const item = await prisma.item.findUnique({ where: { id: params.id } });
  if (!item) throw new NotFoundError();
  return NextResponse.json({ item });
});

export const PATCH = withApiHandler({
  params: idParam,
  body: patchItemBody,
  authorize: (session) => {
    if (!canManageMasters(session.role)) throw new AuthorizationError();
  },
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  const existing = await prisma.item.findUnique({ where: { id: params.id } });
  if (!existing) throw new NotFoundError();
  try {
    const item = await prisma.item.update({
      where: { id: params.id },
      data: {
        sku: body.sku,
        name: body.name,
        category: body.category,
        uom: body.uom,
        specNotes: body.specNotes,
        regulatoryTag: body.regulatoryTag,
      },
    });
    if (!item) throw new NotFoundError();
    await appendAudit({
      entityType: "Item",
      entityId: params.id,
      action: "UPDATE",
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

export const DELETE = withApiHandler({
  params: idParam,
  body: false,
  authorize: (session) => {
    if (!canManageMasters(session.role)) throw new AuthorizationError();
  },
})(async ({ session, params }) => {
  if (!session) throw new UnauthorizedError();
  const existing = await prisma.item.findUnique({ where: { id: params.id } });
  if (!existing) throw new NotFoundError();

  const inUse = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM indents WHERE item_id = $1`,
    [params.id]
  );
  if (Number(inUse.rows[0]?.c ?? 0) > 0) {
    throw new ValidationError("Cannot delete an item that is used on existing indents.");
  }

  await query(`DELETE FROM vendor_items WHERE item_id = $1`, [params.id]);
  await prisma.item.delete({ where: { id: params.id } });
  await appendAudit({
    entityType: "Item",
    entityId: params.id,
    action: "DELETE",
    actorId: session.sub,
    diff: { sku: existing.sku, name: existing.name },
  });
  return NextResponse.json({ ok: true });
});
