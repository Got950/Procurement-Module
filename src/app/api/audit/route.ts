import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import {
  AuthorizationError,
  UnauthorizedError,
  NotFoundError,
} from "@/lib/errors";
import { prisma } from "@/lib/db";
import { canViewIndent } from "@/lib/indent-access";
import { Role } from "@/lib/domain-types";

const auditQuery = z.object({
  indentId: z.string().min(1).optional(),
});

export const GET = withApiHandler({
  query: auditQuery,
  body: false,
})(async ({ session, query }) => {
  if (!session) throw new UnauthorizedError();
  const indentId = query.indentId;
  if (indentId) {
    const indent = await prisma.indent.findUnique({
      where: { id: indentId },
      select: { requesterId: true },
    });
    if (!indent || !canViewIndent(session, indent)) throw new NotFoundError();
  } else if (session.role !== Role.ADMIN) {
    // Org-wide audit dump is admin-only; other roles must scope by indentId.
    throw new AuthorizationError();
  }
  const logs = await prisma.auditLog.findMany({
    where: indentId ? { indentId } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { name: true, role: true } } },
  });
  return NextResponse.json({ logs });
});
