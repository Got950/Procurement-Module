/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma, query } from "@/lib/db";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { canManageMasters } from "@/lib/rbac/policies";
import { canViewIndent, indentListWhere } from "@/lib/indent-access";
import type { CopilotContext } from "@/server/copilot/context";

/** Prisma shim returns loosely typed rows; tools narrow fields as they use them. */
export type IndentRow = Record<string, any> & {
  id: string;
  reference: string;
  requesterId: string;
  currentStatus: string;
};

const REFERENCE = /^IND-[A-Za-z0-9-]+$/;

/**
 * Resolves an indent by id or reference and applies the same visibility rule
 * the UI uses. A case the caller may not see is reported as not found, so the
 * Copilot cannot be used to probe for the existence of other people's cases.
 */
export async function loadAuthorizedIndent(
  ctx: CopilotContext,
  key: string,
  include?: Record<string, unknown>
): Promise<IndentRow> {
  const trimmed = key.trim();
  if (!trimmed) throw new NotFoundError("Indent not found");
  const indent = REFERENCE.test(trimmed.toUpperCase())
    ? await prisma.indent.findFirst({ where: { reference: trimmed.toUpperCase() } })
    : await prisma.indent.findUnique({ where: { id: trimmed } });
  if (!indent) throw new NotFoundError("Indent not found");
  if (!canViewIndent({ sub: ctx.actor.id, role: ctx.actor.role }, indent)) {
    throw new NotFoundError("Indent not found");
  }
  if (!include) return indent as IndentRow;
  const full = await prisma.indent.findUnique({ where: { id: indent.id }, include });
  return full as IndentRow;
}

/** Row filter for every list/aggregate read, derived from the session role. */
export function indentScope(ctx: CopilotContext): Record<string, unknown> {
  return indentListWhere(ctx.actor.role, ctx.actor.id);
}

export function mergeScope(
  ctx: CopilotContext,
  where: Record<string, unknown>
): Record<string, unknown> {
  return { ...where, ...indentScope(ctx) };
}

export type VendorRow = Record<string, any> & {
  id: string;
  companyName: string;
};

/**
 * Vendor master lookup for Copilot. Same least-privilege gate as GET /api/vendors
 * (PROCUREMENT | ADMIN). Unauthorized callers get Forbidden, not a vendor dump.
 */
export async function loadAuthorizedVendor(
  ctx: CopilotContext,
  key: string
): Promise<VendorRow> {
  if (!canManageMasters(ctx.actor.role)) throw new AuthorizationError();
  const trimmed = key.trim();
  if (!trimmed) throw new NotFoundError("Vendor not found");
  const byId = await prisma.vendor.findUnique({ where: { id: trimmed } });
  if (byId) return byId as VendorRow;
  const exact = await query<{ id: string }>(
    `SELECT id FROM vendors WHERE lower(company_name) = lower($1) ORDER BY company_name ASC LIMIT 1`,
    [trimmed]
  );
  const match =
    exact.rows[0] ??
    (
      await query<{ id: string }>(
        `SELECT id FROM vendors WHERE company_name ILIKE '%' || $1 || '%' ORDER BY company_name ASC LIMIT 1`,
        [trimmed]
      )
    ).rows[0];
  if (!match) throw new NotFoundError("Vendor not found");
  const vendor = await prisma.vendor.findUnique({ where: { id: match.id } });
  if (!vendor) throw new NotFoundError("Vendor not found");
  return vendor as VendorRow;
}

/**
 * Document access is gated by the parent indent's visibility — same rule as
 * GET /api/documents/[id]/file.
 */
export async function loadAuthorizedDocument(ctx: CopilotContext, documentId: string) {
  const trimmed = documentId.trim();
  if (!trimmed) throw new NotFoundError("Document not found");
  const doc = await prisma.document.findUnique({ where: { id: trimmed } });
  if (!doc) throw new NotFoundError("Document not found");
  const indent = await prisma.indent.findUnique({ where: { id: doc.indentId } });
  if (!indent || !canViewIndent({ sub: ctx.actor.id, role: ctx.actor.role }, indent)) {
    throw new NotFoundError("Document not found");
  }
  return { document: doc, indent };
}
