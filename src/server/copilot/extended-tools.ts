/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Additional Copilot tools that extend the control plane onto real application
 * capabilities (downloads, draft edits, vendor/item reads, navigation, docs).
 * All mutations reuse shared services / the same rules as the HTTP API.
 */
import { z } from "zod";
import { prisma, query } from "@/lib/db";
import { IndentStatus, Role } from "@/lib/domain-types";
import {
  canCreateIndent,
  canManageMasters,
  getNavForRole,
} from "@/lib/rbac/policies";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { appendAudit } from "@/server/audit-service";
import { createDraftIndent, updateDraftIndent } from "@/server/indent-create";
import { buildIndentPdf } from "@/server/indent-pdf";
import { buildVendorPdf } from "@/server/vendor-pdf";
import { indentUseCases } from "@/server/application/indent-use-cases";
import { defineTool, objectSchema, type CopilotTool } from "@/server/copilot/tool-registry";
import {
  loadAuthorizedDocument,
  loadAuthorizedIndent,
  loadAuthorizedVendor,
} from "@/server/copilot/access";
import { wrapUntrusted } from "@/server/copilot/untrusted";
import type { CopilotClientAction, CopilotContext, ResourceRef } from "@/server/copilot/context";

const ALL_ROLES = Object.values(Role);
const indentKey = z.string().min(1).max(64);
const indentKeyProperty = {
  indent: { type: "string", description: "Indent id or reference such as IND-2025-14." },
};

function actor(ctx: CopilotContext) {
  return { id: ctx.actor.id, role: ctx.actor.role, source: "COPILOT" as const };
}

async function loadItemRow(itemId: string) {
  const { rows } = await query<{ id: string; sku: string; name: string; uom: string }>(
    `SELECT id, sku, name, uom FROM items WHERE id = $1 LIMIT 1`,
    [itemId]
  );
  return rows[0] ?? null;
}

function numberOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function withClientAction<T extends Record<string, unknown>>(
  result: T,
  clientAction: CopilotClientAction
) {
  return { ...result, clientAction };
}

/** Allowlisted same-origin paths the navigate tool may return for a role. */
function authorizedRoutesForRole(role: Role): Map<string, string> {
  const map = new Map<string, string>();
  for (const link of getNavForRole(role)) {
    map.set(link.href.split("?")[0], link.label);
  }
  return map;
}

const downloadIndentPdf = defineTool({
  name: "download_indent_pdf",
  description:
    "Prepare a real printable PDF for an authorized indent and trigger a browser download of that PDF. Use when the user asks to download or export an indent.",
  kind: "read",
  requiresConfirmation: false,
  allowedRoles: ALL_ROLES,
  timeoutMs: 25_000,
  parameters: objectSchema(indentKeyProperty, ["indent"]),
  input: z.object({ indent: indentKey }),
  target: (input) => ({ type: "indent", id: input.indent }),
  references: (result: any): ResourceRef[] =>
    result?.indentId
      ? [{ type: "indent", id: String(result.indentId), label: String(result.reference) }]
      : [],
  execute: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    // Verify generation against live data before telling the UI to download.
    const pdf = await buildIndentPdf(indent.id);
    await appendAudit({
      entityType: "Indent",
      entityId: pdf.indentId,
      action: "DOWNLOAD_INDENT_PDF",
      actorId: ctx.actor.id,
      indentId: pdf.indentId,
      source: "COPILOT",
      diff: { filename: pdf.filename, via: "copilot" },
    });
    return withClientAction(
      {
        status: "READY",
        indentId: pdf.indentId,
        reference: pdf.reference,
        filename: pdf.filename,
        message: `PDF ready for ${pdf.reference}. The download will start in the browser.`,
      },
      {
        type: "download",
        url: `/api/indents/${encodeURIComponent(pdf.indentId)}/pdf`,
        filename: pdf.filename,
      }
    );
  },
});

const downloadVendorPdf = defineTool({
  name: "download_vendor_pdf",
  description:
    "Prepare a real printable vendor profile PDF and trigger a browser download. Resolve the vendor by id or company name first. Procurement and Admin only.",
  kind: "read",
  requiresConfirmation: false,
  allowedRoles: [Role.PROCUREMENT, Role.ADMIN],
  timeoutMs: 25_000,
  parameters: objectSchema(
    {
      vendor: {
        type: "string",
        description: "Vendor id or company name such as Apex Pharma Chemicals.",
      },
    },
    ["vendor"]
  ),
  input: z.object({ vendor: z.string().min(1).max(120) }),
  target: (input) => ({ type: "vendor", id: input.vendor }),
  references: (result: any): ResourceRef[] =>
    result?.vendorId
      ? [{ type: "vendor", id: String(result.vendorId), label: String(result.companyName) }]
      : [],
  execute: async (input, ctx) => {
    const vendor = await loadAuthorizedVendor(ctx, input.vendor);
    const pdf = await buildVendorPdf(vendor.id);
    await appendAudit({
      entityType: "Vendor",
      entityId: pdf.vendorId,
      action: "DOWNLOAD_VENDOR_PDF",
      actorId: ctx.actor.id,
      source: "COPILOT",
      diff: { filename: pdf.filename, via: "copilot" },
    });
    return withClientAction(
      {
        status: "READY",
        vendorId: pdf.vendorId,
        companyName: pdf.companyName,
        filename: pdf.filename,
        message: `PDF ready for ${pdf.companyName}. The download will start in the browser.`,
      },
      {
        type: "download",
        url: `/api/vendors/${encodeURIComponent(pdf.vendorId)}/pdf`,
        filename: pdf.filename,
      }
    );
  },
});

const downloadDocument = defineTool({
  name: "download_document",
  description:
    "Download an attachment that belongs to an indent the caller can access. Requires the document id from get_documents.",
  kind: "read",
  requiresConfirmation: false,
  allowedRoles: ALL_ROLES,
  timeoutMs: 15_000,
  parameters: objectSchema(
    { documentId: { type: "string", description: "Document id from get_documents." } },
    ["documentId"]
  ),
  input: z.object({ documentId: z.string().min(1).max(64) }),
  target: (input) => ({ type: "document", id: input.documentId }),
  execute: async (input, ctx) => {
    const { document, indent } = await loadAuthorizedDocument(ctx, input.documentId);
    return withClientAction(
      {
        status: "READY",
        documentId: document.id,
        filename: document.filename,
        indentReference: indent.reference,
        message: `Attachment ${document.filename} is ready to download.`,
      },
      {
        type: "download",
        url: `/api/documents/${encodeURIComponent(document.id)}/file`,
        filename: document.filename,
      }
    );
  },
});

const navigateTo = defineTool({
  name: "navigate_to",
  description:
    "Navigate the user to an authorized application page or resource. Prefer this when the user says open / take me to / show me the page for an indent, vendor list, approvals, payments, etc.",
  kind: "read",
  requiresConfirmation: false,
  allowedRoles: ALL_ROLES,
  timeoutMs: 8000,
  parameters: objectSchema(
    {
      target: {
        type: "string",
        description:
          "Route key (dashboard, indents, approvals, vendors, items, documents, payments, notifications, users, queue, copilot) or an indent/vendor resource key.",
      },
      indent: {
        type: "string",
        description: "Optional indent id/reference when opening a specific indent.",
      },
      vendor: {
        type: "string",
        description: "Optional vendor id/name when opening the vendors page for that vendor.",
      },
    },
    ["target"]
  ),
  input: z.object({
    target: z.string().min(1).max(64),
    indent: indentKey.optional(),
    vendor: z.string().min(1).max(120).optional(),
  }),
  execute: async (input, ctx) => {
    const routes = authorizedRoutesForRole(ctx.actor.role);
    const key = input.target.trim().toLowerCase();

    if (key === "indent" || input.indent) {
      const indent = await loadAuthorizedIndent(ctx, input.indent ?? input.target);
      const href = `/indents/${indent.id}`;
      return withClientAction(
        {
          status: "READY",
          href,
          label: indent.reference,
          message: `Opening ${indent.reference}.`,
        },
        { type: "navigate", href }
      );
    }

    if (key === "vendor" || input.vendor) {
      if (!routes.has("/vendors")) {
        throw new AuthorizationError("You do not have access to the vendors page.");
      }
      const vendor = await loadAuthorizedVendor(ctx, input.vendor ?? input.target);
      const href = `/vendors`;
      return withClientAction(
        {
          status: "READY",
          href,
          label: vendor.companyName,
          vendorId: vendor.id,
          message: `Opening vendors. Focus: ${vendor.companyName}.`,
        },
        { type: "navigate", href }
      );
    }

    const ROUTE_ALIASES: Record<string, string> = {
      dashboard: "/dashboard",
      overview: "/dashboard",
      home: "/dashboard",
      indents: "/indents",
      approvals: "/approvals",
      vendors: "/vendors",
      items: "/items",
      documents: "/documents",
      payments: "/finance/payments",
      finance: "/finance/payments",
      notifications: "/notifications",
      users: "/admin/users",
      "user management": "/admin/users",
      queue: "/procurement/queue",
      procurement: "/procurement/queue",
      copilot: "/copilot",
    };

    const href = ROUTE_ALIASES[key] ?? (key.startsWith("/") ? key.split("?")[0] : null);
    if (!href || !routes.has(href)) {
      // Indent-looking targets
      if (REFERENCE_LIKE.test(input.target)) {
        const indent = await loadAuthorizedIndent(ctx, input.target);
        const indentHref = `/indents/${indent.id}`;
        return withClientAction(
          {
            status: "READY",
            href: indentHref,
            label: indent.reference,
            message: `Opening ${indent.reference}.`,
          },
          { type: "navigate", href: indentHref }
        );
      }
      throw new AuthorizationError("That page is not available for your role.");
    }

    return withClientAction(
      {
        status: "READY",
        href,
        label: routes.get(href) ?? href,
        message: `Opening ${routes.get(href) ?? href}.`,
      },
      { type: "navigate", href }
    );
  },
});

const REFERENCE_LIKE = /^IND-[A-Za-z0-9-]+$/i;

const getVendor = defineTool({
  name: "get_vendor",
  description:
    "Full vendor master record by id or company name: contact, city, payment terms, rating, status and mapped items. Procurement and Admin only.",
  kind: "read",
  requiresConfirmation: false,
  allowedRoles: [Role.PROCUREMENT, Role.ADMIN],
  timeoutMs: 8000,
  parameters: objectSchema(
    { vendor: { type: "string", description: "Vendor id or company name." } },
    ["vendor"]
  ),
  input: z.object({ vendor: z.string().min(1).max(120) }),
  target: (input) => ({ type: "vendor", id: input.vendor }),
  references: (result: any): ResourceRef[] =>
    result?.vendor?.vendorId
      ? [
          {
            type: "vendor",
            id: String(result.vendor.vendorId),
            label: String(result.vendor.companyName),
          },
        ]
      : [],
  execute: async (input, ctx) => {
    const vendor = await loadAuthorizedVendor(ctx, input.vendor);
    const mapped = await query<{
      item_id: string;
      name: string;
      sku: string;
      category: string;
      uom: string;
    }>(
      `SELECT i.id AS item_id, i.name, i.sku, i.category, i.uom
         FROM vendor_items vi
         INNER JOIN items i ON i.id = vi.item_id
        WHERE vi.vendor_id = $1
        ORDER BY i.name ASC
        LIMIT 50`,
      [vendor.id]
    );
    return {
      vendor: {
        vendorId: vendor.id,
        companyName: vendor.companyName,
        contactPerson: vendor.contactPerson,
        email: vendor.email,
        phone: vendor.phone ?? null,
        city: vendor.city ?? null,
        gstNumber: vendor.gstNumber ?? null,
        licenseInfo: vendor.licenseInfo
          ? wrapUntrusted(`vendor:${vendor.companyName}:license`, String(vendor.licenseInfo), 600)
          : null,
        paymentTerms: vendor.paymentTerms,
        averageDeliveryDays: vendor.averageDeliveryDays,
        rating: vendor.rating,
        status: vendor.status,
        items: mapped.rows.map((vi) => ({
          itemId: vi.item_id,
          name: vi.name,
          sku: vi.sku,
          category: vi.category,
          uom: vi.uom,
        })),
      },
    };
  },
});

const listItems = defineTool({
  name: "list_items",
  description:
    "List catalog items (SKU, name, category, UOM). Optional name/SKU search. Available to requesters (indent create) and procurement/admin.",
  kind: "read",
  requiresConfirmation: false,
  allowedRoles: [Role.REQUESTER, Role.PROCUREMENT, Role.ADMIN],
  timeoutMs: 8000,
  parameters: objectSchema({
    search: { type: "string", description: "Name or SKU fragment." },
    limit: { type: "integer", minimum: 1, maximum: 25 },
  }),
  input: z.object({
    search: z.string().max(120).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  execute: async (input) => {
    const term = input.search?.trim();
    const { rows } = await query<{
      id: string;
      sku: string;
      name: string;
      category: string;
      uom: string;
      regulatory_tag: string | null;
    }>(
      `SELECT id, sku, name, category, uom, regulatory_tag
         FROM items
        WHERE ($1::text IS NULL
           OR name ILIKE '%' || $1 || '%'
           OR sku ILIKE '%' || $1 || '%'
           OR category ILIKE '%' || $1 || '%')
        ORDER BY name ASC
        LIMIT $2`,
      [term || null, input.limit ?? 15]
    );
    return {
      count: rows.length,
      items: rows.map((r) => ({
        itemId: r.id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        uom: r.uom,
        regulatoryTag: r.regulatory_tag,
      })),
    };
  },
});

const getItem = defineTool({
  name: "get_item",
  description: "One catalog item by id or exact SKU. Available to requesters and procurement/admin.",
  kind: "read",
  requiresConfirmation: false,
  allowedRoles: [Role.REQUESTER, Role.PROCUREMENT, Role.ADMIN],
  timeoutMs: 8000,
  parameters: objectSchema(
    { item: { type: "string", description: "Item id or SKU." } },
    ["item"]
  ),
  input: z.object({ item: z.string().min(1).max(64) }),
  execute: async (input) => {
    const key = input.item.trim();
    const { rows } = await query<{
      id: string;
      sku: string;
      name: string;
      category: string;
      uom: string;
      spec_notes: string | null;
      regulatory_tag: string | null;
    }>(
      `SELECT id, sku, name, category, uom, spec_notes, regulatory_tag
         FROM items
        WHERE id = $1 OR lower(sku) = lower($1)
        LIMIT 1`,
      [key]
    );
    const item = rows[0];
    if (!item) throw new NotFoundError("Item not found");
    return {
      item: {
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        category: item.category,
        uom: item.uom,
        specNotes: item.spec_notes
          ? wrapUntrusted(`item:${item.sku}:spec`, String(item.spec_notes), 800)
          : null,
        regulatoryTag: item.regulatory_tag ?? null,
      },
    };
  },
});

const listPayments = defineTool({
  name: "list_payments",
  description:
    "List payment records the caller can see, optionally filtered by vendor company name or indent. Does not return bank account numbers.",
  kind: "read",
  requiresConfirmation: false,
  allowedRoles: ALL_ROLES,
  timeoutMs: 10_000,
  parameters: objectSchema({
    vendor: { type: "string", description: "Optional vendor company name fragment." },
    indent: { type: "string", description: "Optional indent id or reference." },
    limit: { type: "integer", minimum: 1, maximum: 25 },
  }),
  input: z.object({
    vendor: z.string().max(120).optional(),
    indent: indentKey.optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  execute: async (input, ctx) => {
    let indentId: string | null = null;
    if (input.indent) {
      const indent = await loadAuthorizedIndent(ctx, input.indent);
      indentId = indent.id;
    }
    const requesterOnly = ctx.actor.role === Role.REQUESTER ? ctx.actor.id : null;
    const { rows } = await query<{
      payment_id: string;
      status: string;
      paid_at: Date | null;
      indent_id: string;
      reference: string;
      company_name: string | null;
      current_status: string;
    }>(
      `SELECT p.id AS payment_id, p.status, p.paid_at, i.id AS indent_id, i.reference,
              v.company_name, i.current_status
         FROM payments p
         INNER JOIN indents i ON i.id = p.indent_id
         LEFT JOIN vendor_selection vs ON vs.indent_id = i.id
         LEFT JOIN vendors v ON v.id = vs.selected_vendor_id
        WHERE ($1::text IS NULL OR i.requester_id = $1)
          AND ($2::text IS NULL OR i.id = $2)
          AND ($3::text IS NULL OR v.company_name ILIKE '%' || $3 || '%')
        ORDER BY p.created_at DESC
        LIMIT $4`,
      [requesterOnly, indentId, input.vendor?.trim() || null, input.limit ?? 15]
    );
    return {
      count: rows.length,
      payments: rows.map((r) => ({
        paymentId: r.payment_id,
        status: r.status,
        paidAt: iso(r.paid_at),
        indentId: r.indent_id,
        indentReference: r.reference,
        indentStatus: r.current_status,
        vendorName: r.company_name,
      })),
    };
  },
});

const getDocumentText = defineTool({
  name: "get_document_text",
  description:
    "Return extracted text from one authorized attachment (quotation PDF, etc.) as untrusted data. Use for 'what does this PDF say' after get_documents.",
  kind: "read",
  requiresConfirmation: false,
  allowedRoles: ALL_ROLES,
  timeoutMs: 10_000,
  parameters: objectSchema(
    {
      documentId: { type: "string" },
      maxChars: { type: "integer", minimum: 200, maximum: 4000 },
    },
    ["documentId"]
  ),
  input: z.object({
    documentId: z.string().min(1).max(64),
    maxChars: z.number().int().min(200).max(4000).optional(),
  }),
  target: (input) => ({ type: "document", id: input.documentId }),
  execute: async (input, ctx) => {
    const { document, indent } = await loadAuthorizedDocument(ctx, input.documentId);
    const extracted = (document as any).extractedText as string | null | undefined;
    if (!extracted) {
      return {
        available: false,
        documentId: document.id,
        filename: document.filename,
        indentReference: indent.reference,
        reason: "No extracted text is available for this document yet.",
      };
    }
    return {
      available: true,
      documentId: document.id,
      filename: document.filename,
      indentReference: indent.reference,
      content: wrapUntrusted(
        `document:${document.filename}`,
        extracted,
        input.maxChars ?? 3000
      ),
    };
  },
});

const compareDocumentWithIndent = defineTool({
  name: "compare_document_with_indent",
  description:
    "Compare authorized document extracted text with the indent's quantity, item and procurement requirements. Returns only facts present in both sources; does not invent differences.",
  kind: "read",
  requiresConfirmation: false,
  allowedRoles: ALL_ROLES,
  timeoutMs: 12_000,
  parameters: objectSchema(
    {
      ...indentKeyProperty,
      documentId: { type: "string", description: "Document id attached to this indent." },
    },
    ["indent", "documentId"]
  ),
  input: z.object({ indent: indentKey, documentId: z.string().min(1).max(64) }),
  target: (input) => ({ type: "indent", id: input.indent }),
  execute: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent, { item: true });
    const { document } = await loadAuthorizedDocument(ctx, input.documentId);
    if (document.indentId !== indent.id) {
      throw new NotFoundError("Document not found");
    }
    const text = String((document as any).extractedText ?? "");
    if (!text) {
      return {
        available: false,
        reason: "I couldn't find extracted text in the authorized document.",
      };
    }
    const lower = text.toLowerCase();
    const itemName = String(indent.item?.name ?? "");
    const sku = String(indent.item?.sku ?? "");
    const qty = numberOrNull(indent.quantity);
    const findings: { field: string; indentValue: string; inDocument: boolean; note: string }[] =
      [];
    if (itemName) {
      findings.push({
        field: "itemName",
        indentValue: itemName,
        inDocument: lower.includes(itemName.toLowerCase()),
        note: lower.includes(itemName.toLowerCase())
          ? "Item name appears in the document text."
          : "Item name was not found in the document text.",
      });
    }
    if (sku) {
      findings.push({
        field: "sku",
        indentValue: sku,
        inDocument: lower.includes(sku.toLowerCase()),
        note: lower.includes(sku.toLowerCase())
          ? "SKU appears in the document text."
          : "SKU was not found in the document text.",
      });
    }
    if (qty != null) {
      const qtyStr = String(qty);
      findings.push({
        field: "quantity",
        indentValue: qtyStr,
        inDocument: lower.includes(qtyStr),
        note: lower.includes(qtyStr)
          ? "Quantity digits appear in the document text."
          : "Exact quantity digits were not found in the document text.",
      });
    }
    return {
      available: true,
      reference: indent.reference,
      documentId: document.id,
      filename: document.filename,
      findings,
      documentExcerpt: wrapUntrusted(`document:${document.filename}`, text, 1200),
    };
  },
});

const createIndent = defineTool({
  name: "create_indent",
  description:
    "Create a new draft indent for the caller. Requires a real item id from list_items. Confirmation required.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.REQUESTER, Role.ADMIN],
  timeoutMs: 15_000,
  parameters: objectSchema(
    {
      itemId: { type: "string", description: "Catalog item id from list_items." },
      quantity: { type: "number", exclusiveMinimum: 0 },
      justification: { type: "string" },
      priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
      estimatedAmount: { type: "number" },
    },
    ["itemId", "quantity", "justification"]
  ),
  input: z.object({
    itemId: z.string().min(1).max(64),
    quantity: z.number().positive().max(1_000_000_000),
    justification: z.string().trim().min(1).max(4000),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    estimatedAmount: z.number().nonnegative().max(1_000_000_000_000).optional(),
  }),
  target: (input) => ({ type: "item", id: input.itemId }),
  preview: async (input, ctx) => {
    if (!canCreateIndent(ctx.actor.role)) throw new AuthorizationError();
    const item = await loadItemRow(input.itemId);
    if (!item) throw new ValidationError("Unknown item id. Use list_items first.");
    return {
      title: "Create draft indent",
      target: item.name,
      details: [
        { label: "Item", value: `${item.name} (${item.sku})` },
        { label: "Quantity", value: `${input.quantity} ${item.uom}` },
        { label: "Priority", value: input.priority ?? "NORMAL" },
        { label: "Justification", value: input.justification.slice(0, 200) },
      ],
      externalEffect: null,
    };
  },
  execute: async (input, ctx) => {
    if (!canCreateIndent(ctx.actor.role)) throw new AuthorizationError();
    const item = await loadItemRow(input.itemId);
    if (!item) throw new ValidationError("Unknown item id.");
    const created = await createDraftIndent(ctx.actor.id, input);
    return {
      status: "SUCCEEDED",
      indentId: created.id,
      reference: created.reference,
      newStatus: created.currentStatus,
    };
  },
});

const updateDraftIndentTool = defineTool({
  name: "update_draft_indent",
  description:
    "Update allowlisted fields on the caller's own DRAFT indent: quantity, priority, justification, estimatedAmount, itemId. Confirmation required. Cannot change status, requester, or workflow fields.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.REQUESTER, Role.ADMIN],
  timeoutMs: 15_000,
  parameters: objectSchema(
    {
      ...indentKeyProperty,
      quantity: { type: "number", exclusiveMinimum: 0 },
      priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
      justification: { type: "string" },
      estimatedAmount: { type: "number" },
      itemId: { type: "string" },
    },
    ["indent"]
  ),
  input: z
    .object({
      indent: indentKey,
      quantity: z.number().positive().max(1_000_000_000).optional(),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
      justification: z.string().trim().min(1).max(4000).optional(),
      estimatedAmount: z.number().nonnegative().max(1_000_000_000_000).optional(),
      itemId: z.string().min(1).max(64).optional(),
    })
    .refine(
      (v) =>
        v.quantity != null ||
        v.priority != null ||
        v.justification != null ||
        v.estimatedAmount != null ||
        v.itemId != null,
      { message: "Provide at least one editable field." }
    ),
  target: (input) => ({ type: "indent", id: input.indent }),
  preview: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent, { item: true });
    if (indent.requesterId !== ctx.actor.id && ctx.actor.role !== Role.ADMIN) {
      throw new AuthorizationError();
    }
    if (indent.currentStatus !== IndentStatus.DRAFT) {
      throw new ValidationError("Only drafts are editable.");
    }
    const details: { label: string; value: string }[] = [];
    if (input.quantity != null) {
      details.push({
        label: "Quantity",
        value: `${indent.quantity} → ${input.quantity}${indent.item?.uom ? ` ${indent.item.uom}` : ""}`,
      });
    }
    if (input.priority != null) {
      details.push({ label: "Priority", value: `${indent.priority} → ${input.priority}` });
    }
    if (input.justification != null) {
      details.push({
        label: "Justification",
        value: `${String(indent.justification).slice(0, 80)} → ${input.justification.slice(0, 80)}`,
      });
    }
    if (input.estimatedAmount != null) {
      details.push({
        label: "Estimated amount",
        value: `${indent.estimatedAmount ?? "unset"} → ${input.estimatedAmount}`,
      });
    }
    if (input.itemId != null) {
      const item = await loadItemRow(input.itemId);
      if (!item) throw new ValidationError("Unknown item id.");
      details.push({
        label: "Item",
        value: `${indent.item?.name ?? "?"} → ${item.name}`,
      });
    }
    return {
      title: "Apply draft indent changes",
      target: indent.reference,
      details,
      externalEffect: null,
    };
  },
  execute: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    if (indent.requesterId !== ctx.actor.id && ctx.actor.role !== Role.ADMIN) {
      throw new AuthorizationError();
    }
    if (indent.currentStatus !== IndentStatus.DRAFT) {
      throw new ValidationError("Only drafts are editable.");
    }
    if (input.itemId) {
      const item = await loadItemRow(input.itemId);
      if (!item) throw new ValidationError("Unknown item id.");
    }
    const updated = await updateDraftIndent(ctx.actor.id, indent.id, Number(indent.version), {
      quantity: input.quantity,
      priority: input.priority,
      justification: input.justification,
      estimatedAmount: input.estimatedAmount,
      itemId: input.itemId,
    });
    if (!updated) {
      throw new ConflictError("This indent changed since you previewed it. Ask again to retry.");
    }
    return {
      status: "SUCCEEDED",
      indentId: updated.id,
      reference: updated.reference,
      quantity: numberOrNull(updated.quantity),
      priority: updated.priority,
      version: updated.version,
    };
  },
});

const createVendor = defineTool({
  name: "create_vendor",
  description:
    "Create a vendor master record. Procurement/Admin only. Confirmation required.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.PROCUREMENT, Role.ADMIN],
  timeoutMs: 15_000,
  parameters: objectSchema(
    {
      companyName: { type: "string" },
      contactPerson: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      city: { type: "string" },
      paymentTerms: { type: "string" },
      itemIds: { type: "array", items: { type: "string" }, maxItems: 50 },
    },
    ["companyName", "contactPerson", "email"]
  ),
  input: z.object({
    companyName: z.string().trim().min(1).max(200),
    contactPerson: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().max(40).optional(),
    city: z.string().trim().max(120).optional(),
    paymentTerms: z.string().trim().max(120).optional(),
    itemIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  }),
  preview: async (input, ctx) => {
    if (!canManageMasters(ctx.actor.role)) throw new AuthorizationError();
    return {
      title: "Create vendor",
      target: input.companyName,
      details: [
        { label: "Contact", value: input.contactPerson },
        { label: "Email", value: input.email },
        { label: "City", value: input.city ?? "—" },
        { label: "Payment terms", value: input.paymentTerms ?? "Net 30" },
      ],
      externalEffect: null,
    };
  },
  execute: async (input, ctx) => {
    if (!canManageMasters(ctx.actor.role)) throw new AuthorizationError();
    const v = await prisma.vendor.create({
      data: {
        companyName: input.companyName,
        contactPerson: input.contactPerson,
        email: input.email,
        phone: input.phone,
        city: input.city,
        paymentTerms: input.paymentTerms ?? "Net 30",
        vendorItems: {
          create: (input.itemIds ?? []).map((itemId) => ({ itemId })),
        },
      },
    });
    await appendAudit({
      entityType: "Vendor",
      entityId: v.id,
      action: "CREATE",
      actorId: ctx.actor.id,
      source: "COPILOT",
      diff: { companyName: v.companyName },
    });
    return { status: "SUCCEEDED", vendorId: v.id, companyName: v.companyName };
  },
});

const updateVendor = defineTool({
  name: "update_vendor",
  description:
    "Update allowlisted vendor contact/commercial fields. Procurement/Admin only. Confirmation required. Cannot change internal ids.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.PROCUREMENT, Role.ADMIN],
  timeoutMs: 15_000,
  parameters: objectSchema(
    {
      vendor: { type: "string", description: "Vendor id or company name." },
      contactPerson: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      city: { type: "string" },
      paymentTerms: { type: "string" },
      status: { type: "string", enum: ["ACTIVE", "INACTIVE", "PENDING"] },
    },
    ["vendor"]
  ),
  input: z
    .object({
      vendor: z.string().min(1).max(120),
      contactPerson: z.string().trim().min(1).max(120).optional(),
      email: z.string().trim().email().max(200).optional(),
      phone: z.string().trim().max(40).nullable().optional(),
      city: z.string().trim().max(120).nullable().optional(),
      paymentTerms: z.string().trim().max(120).optional(),
      status: z.enum(["ACTIVE", "INACTIVE", "PENDING"]).optional(),
    })
    .refine(
      (v) =>
        v.contactPerson != null ||
        v.email != null ||
        v.phone !== undefined ||
        v.city !== undefined ||
        v.paymentTerms != null ||
        v.status != null,
      { message: "Provide at least one editable field." }
    ),
  target: (input) => ({ type: "vendor", id: input.vendor }),
  preview: async (input, ctx) => {
    if (!canManageMasters(ctx.actor.role)) throw new AuthorizationError();
    const vendor = await loadAuthorizedVendor(ctx, input.vendor);
    const details: { label: string; value: string }[] = [];
    if (input.contactPerson != null) {
      details.push({
        label: "Contact",
        value: `${vendor.contactPerson} → ${input.contactPerson}`,
      });
    }
    if (input.email != null) {
      details.push({ label: "Email", value: `${vendor.email} → ${input.email}` });
    }
    if (input.phone !== undefined) {
      details.push({
        label: "Phone",
        value: `${vendor.phone ?? "—"} → ${input.phone ?? "—"}`,
      });
    }
    if (input.city !== undefined) {
      details.push({
        label: "City",
        value: `${vendor.city ?? "—"} → ${input.city ?? "—"}`,
      });
    }
    if (input.paymentTerms != null) {
      details.push({
        label: "Payment terms",
        value: `${vendor.paymentTerms} → ${input.paymentTerms}`,
      });
    }
    if (input.status != null) {
      details.push({ label: "Status", value: `${vendor.status} → ${input.status}` });
    }
    return {
      title: "Update vendor",
      target: vendor.companyName,
      details,
      externalEffect: null,
    };
  },
  execute: async (input, ctx) => {
    if (!canManageMasters(ctx.actor.role)) throw new AuthorizationError();
    const vendor = await loadAuthorizedVendor(ctx, input.vendor);
    const updated = await prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        contactPerson: input.contactPerson,
        email: input.email,
        phone: input.phone === undefined ? undefined : input.phone,
        city: input.city === undefined ? undefined : input.city,
        paymentTerms: input.paymentTerms,
        status: input.status,
      },
    });
    await appendAudit({
      entityType: "Vendor",
      entityId: vendor.id,
      action: "UPDATE",
      actorId: ctx.actor.id,
      source: "COPILOT",
      diff: {
        contactPerson: input.contactPerson,
        email: input.email,
        phone: input.phone,
        city: input.city,
        paymentTerms: input.paymentTerms,
        status: input.status,
      },
    });
    return {
      status: "SUCCEEDED",
      vendorId: updated.id,
      companyName: updated.companyName,
    };
  },
});

const markNotificationsRead = defineTool({
  name: "mark_notifications_read",
  description:
    "Mark the caller's own notifications as read. Optional list of notification ids; omit to mark all unread.",
  kind: "write",
  requiresConfirmation: false,
  allowedRoles: ALL_ROLES,
  timeoutMs: 8000,
  parameters: objectSchema({
    ids: { type: "array", items: { type: "string" }, maxItems: 50 },
  }),
  input: z.object({
    ids: z.array(z.string().min(1).max(64)).max(50).optional(),
  }),
  execute: async (input, ctx) => {
    if (input.ids?.length) {
      const result = await prisma.notification.updateMany({
        where: { userId: ctx.actor.id, id: { in: input.ids } },
        data: { readAt: new Date() },
      });
      return { status: "SUCCEEDED", updated: result.count };
    }
    const result = await prisma.notification.updateMany({
      where: { userId: ctx.actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { status: "SUCCEEDED", updated: result.count };
  },
});

const completePayment = defineTool({
  name: "complete_payment",
  description:
    "Record payment complete for an indent that is with finance, using an existing proof document id. Finance only. Confirmation required.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.FINANCE, Role.ADMIN],
  timeoutMs: 20_000,
  parameters: objectSchema(
    {
      ...indentKeyProperty,
      proofDocumentId: {
        type: "string",
        description: "Payment proof document id already uploaded on the indent.",
      },
    },
    ["indent", "proofDocumentId"]
  ),
  input: z.object({
    indent: indentKey,
    proofDocumentId: z.string().min(1).max(64),
  }),
  target: (input) => ({ type: "indent", id: input.indent }),
  preview: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    const { document } = await loadAuthorizedDocument(ctx, input.proofDocumentId);
    if (document.indentId !== indent.id) {
      throw new ValidationError("Proof document does not belong to this indent.");
    }
    return {
      title: "Complete payment",
      target: indent.reference,
      details: [
        { label: "Current status", value: indent.currentStatus },
        { label: "Proof document", value: document.filename },
      ],
      externalEffect: "Marks payment done on the case using the existing proof document.",
    };
  },
  execute: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    const { document } = await loadAuthorizedDocument(ctx, input.proofDocumentId);
    if (document.indentId !== indent.id) {
      throw new ValidationError("Proof document does not belong to this indent.");
    }
    await indentUseCases.financeComplete(actor(ctx), indent.id, document.id);
    const after = await prisma.indent.findUnique({ where: { id: indent.id } });
    return {
      status: "SUCCEEDED",
      indentId: indent.id,
      reference: indent.reference,
      newStatus: after?.currentStatus ?? null,
    };
  },
});

export const EXTENDED_TOOLS: CopilotTool<any>[] = [
  downloadIndentPdf,
  downloadVendorPdf,
  downloadDocument,
  navigateTo,
  getVendor,
  listItems,
  getItem,
  listPayments,
  getDocumentText,
  compareDocumentWithIndent,
  createIndent,
  updateDraftIndentTool,
  createVendor,
  updateVendor,
  markNotificationsRead,
  completePayment,
];
