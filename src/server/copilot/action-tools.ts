/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { prisma, query, withTransaction } from "@/lib/db";
import { Role } from "@/lib/domain-types";
import { ConflictError, ValidationError } from "@/lib/errors";
import { getCorrelationId } from "@/lib/logger";
import { indentUseCases } from "@/server/application/indent-use-cases";
import { getGmailClient } from "@/server/gmail-service";
import { runGmailSync } from "@/server/gmail-sync";
import { enqueueJob } from "@/server/jobs";
import { processJobById } from "@/server/job-handlers";
import { sendPurchaseOrderEmail } from "@/server/po-delivery";
import { defineTool, objectSchema, type CopilotTool } from "@/server/copilot/tool-registry";
import { loadAuthorizedIndent } from "@/server/copilot/access";
import type { CopilotContext } from "@/server/copilot/context";

const indentKey = z.string().min(1).max(64);
const indentKeyProperty = {
  indent: { type: "string", description: "Indent id or reference such as IND-2025-14." },
};

function actor(ctx: CopilotContext) {
  return { id: ctx.actor.id, role: ctx.actor.role, source: "COPILOT" as const };
}

function jobsInline() {
  return process.env.JOBS_INLINE === "1";
}

const submitIndent = defineTool({
  name: "submit_indent",
  description:
    "Submit the caller's own draft indent for Team Leader review. Only valid while the indent is in DRAFT.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.REQUESTER, Role.ADMIN],
  timeoutMs: 15_000,
  parameters: objectSchema(indentKeyProperty, ["indent"]),
  input: z.object({ indent: indentKey }),
  target: (input) => ({ type: "indent", id: input.indent }),
  preview: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent, { item: true });
    return {
      title: "Submit indent for Team Leader approval",
      target: indent.reference,
      details: [
        { label: "Item", value: String(indent.item?.name ?? "unknown") },
        { label: "Quantity", value: String(indent.quantity) },
        { label: "Current status", value: indent.currentStatus },
      ],
      externalEffect: "Notifies every active Team Leader and moves the case out of draft.",
    };
  },
  execute: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    await indentUseCases.submit(actor(ctx), indent.id);
    const after = await prisma.indent.findUnique({ where: { id: indent.id } });
    return {
      status: "SUCCEEDED",
      indentId: indent.id,
      reference: indent.reference,
      newStatus: after?.currentStatus ?? null,
    };
  },
});

const markQuotesReady = defineTool({
  name: "mark_quotations_ready",
  description:
    "Mark quotation collection complete for an indent so a vendor can be selected. Procurement only.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.PROCUREMENT, Role.ADMIN],
  timeoutMs: 15_000,
  parameters: objectSchema(indentKeyProperty, ["indent"]),
  input: z.object({ indent: indentKey }),
  target: (input) => ({ type: "indent", id: input.indent }),
  preview: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    const count = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM quotations WHERE indent_id = $1`,
      [indent.id]
    );
    return {
      title: "Mark quotations ready",
      target: indent.reference,
      details: [
        { label: "Current status", value: indent.currentStatus },
        { label: "Quotations recorded", value: count.rows[0]?.count ?? "0" },
      ],
      externalEffect: null,
    };
  },
  execute: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    await indentUseCases.quotesReady(actor(ctx), indent.id);
    return { status: "SUCCEEDED", indentId: indent.id, reference: indent.reference, newStatus: "QUOTES_READY" };
  },
});

function defaultRfqSubject(reference: string, itemName: string) {
  return `${reference} - Request for quotation: ${itemName}`;
}

function defaultRfqBody(indent: any) {
  return [
    `Dear {{company_name}},`,
    ``,
    `We would like to request your quotation for the following requirement.`,
    ``,
    `Reference: ${indent.reference}`,
    `Item: ${indent.item?.name ?? ""} (SKU ${indent.item?.sku ?? ""})`,
    `Quantity: ${String(indent.quantity)} ${indent.item?.uom ?? ""}`,
    indent.procurementSpecifications ? `Specifications: ${indent.procurementSpecifications}` : null,
    indent.procurementDeliveryExpectations
      ? `Delivery expectations: ${indent.procurementDeliveryExpectations}`
      : null,
    indent.procurementCostCommercial ? `Commercial notes: ${indent.procurementCostCommercial}` : null,
    ``,
    `Please include unit price, currency, minimum order quantity, lead time, payment terms and applicable certifications.`,
    ``,
    `Kind regards,`,
    `Procurement`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

async function resolveRfqVendors(vendorIds: string[]) {
  const rows = await query<{ id: string; company_name: string; email: string; status: string }>(
    `SELECT id, company_name, email, status FROM vendors WHERE id = ANY($1::text[])`,
    [vendorIds]
  );
  const found = new Map(rows.rows.map((v) => [v.id, v]));
  const missing = vendorIds.filter((id) => !found.has(id));
  if (missing.length) {
    throw new ValidationError(
      `Unknown vendor id(s): ${missing.join(", ")}. Look vendors up with list_vendors first.`
    );
  }
  const inactive = rows.rows.filter((v) => v.status !== "ACTIVE");
  if (inactive.length) {
    throw new ValidationError(
      `Vendor(s) not active: ${inactive.map((v) => v.company_name).join(", ")}.`
    );
  }
  return vendorIds.map((id) => found.get(id)!);
}

const sendRfq = defineTool({
  name: "send_rfq",
    description:
      "Send a request for quotation by e-mail to named vendors for one indent. Procurement only. Sends external e-mail, so it always needs confirmation.",
    kind: "write",
    requiresConfirmation: true,
    allowedRoles: [Role.PROCUREMENT, Role.ADMIN],
    timeoutMs: 25_000,
    parameters: objectSchema(
      {
        ...indentKeyProperty,
        vendorIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 20,
          description: "Vendor ids from list_vendors. Never invent these.",
        },
        subject: { type: "string", description: "Optional subject override." },
        bodyTemplate: {
          type: "string",
          description: "Optional body override. {{company_name}} is replaced per vendor.",
        },
      },
      ["indent", "vendorIds"]
    ),
    input: z.object({
      indent: indentKey,
      vendorIds: z.array(z.string().min(1).max(64)).min(1).max(20),
      subject: z.string().min(1).max(500).optional(),
      bodyTemplate: z.string().min(1).max(20_000).optional(),
    }),
    target: (input) => ({ type: "indent", id: input.indent }),
    preview: async (input, ctx) => {
      const indent = await loadAuthorizedIndent(ctx, input.indent, { item: true });
      const vendors = await resolveRfqVendors(input.vendorIds);
      return {
        title: `Send RFQ to ${vendors.length} vendor(s)`,
        target: indent.reference,
        details: [
          { label: "Item", value: String(indent.item?.name ?? "unknown") },
          { label: "Quantity", value: String(indent.quantity) },
          {
            label: "Recipients",
            value: vendors.map((v) => `${v.company_name} <${v.email}>`).join(", "),
          },
          {
            label: "Subject",
            value:
              input.subject ??
              defaultRfqSubject(indent.reference, String(indent.item?.name ?? "requirement")),
          },
        ],
        externalEffect: `This sends ${vendors.length} external e-mail(s) from the connected Gmail mailbox.`,
      };
    },
    execute: async (input, ctx) => {
      const indent = await loadAuthorizedIndent(ctx, input.indent, { item: true });
      const vendors = await resolveRfqVendors(input.vendorIds);
      const gmail = await getGmailClient();
      if (!gmail) {
        throw new ValidationError(
          "Gmail is not connected, so the RFQ cannot be sent. Connect Gmail in Integrations and retry."
        );
      }
      const subject =
        input.subject ?? defaultRfqSubject(indent.reference, String(indent.item?.name ?? "requirement"));
      const bodyTemplate = input.bodyTemplate ?? defaultRfqBody(indent);
      const jobIds: string[] = [];
      const rfq = await withTransaction(async () => {
        const created = await indentUseCases.createRfq(actor(ctx), indent.id, {
          subject,
          bodyTemplate,
          vendorIds: input.vendorIds,
        });
        for (const vendor of vendors) {
          const jobId = await enqueueJob({
            jobType: "email.send",
            payload: {
              kind: "rfq",
              indentId: indent.id,
              rfqId: created.id,
              vendorId: vendor.id,
              subject,
              bodyTemplate,
              reference: indent.reference,
              itemName: indent.item?.name ?? "",
            },
            // Same key the RFQ route uses, so one vendor cannot be mailed twice
            // for one RFQ regardless of which interface triggered it.
            idempotencyKey: `email.send:rfq:${created.id}:${vendor.id}`,
            correlationId: getCorrelationId(),
          });
          if (jobId) jobIds.push(jobId);
        }
        return created;
      });
      if (jobsInline()) {
        for (const jobId of jobIds) await processJobById(jobId);
      }
      const states = jobIds.length
        ? await query<{ status: string; last_error: string | null }>(
            `SELECT status, last_error FROM jobs WHERE id = ANY($1::text[])`,
            [jobIds]
          )
        : { rows: [] as { status: string; last_error: string | null }[] };
      const succeeded = states.rows.filter((j) => j.status === "SUCCEEDED").length;
      const failed = states.rows.filter((j) => j.status !== "SUCCEEDED");
      if (jobsInline() && (succeeded !== jobIds.length || jobIds.length === 0)) {
        const gmailDisconnected = failed.some((j) =>
          String(j.last_error ?? "").toLowerCase().includes("gmail not connected")
        );
        throw new ValidationError(
          gmailDisconnected
            ? "Gmail is not connected, so the RFQ cannot be sent. Connect Gmail and retry. The RFQ record may have been saved without email delivery."
            : `RFQ email delivery failed: ${failed
                .map((j) => j.last_error)
                .filter(Boolean)
                .slice(0, 2)
                .join("; ") || "unknown error"}`
        );
      }
      return {
        // Queued is not sent: the worker performs delivery and the status below
        // is read back from the job rows rather than assumed.
        status: succeeded === jobIds.length && jobIds.length > 0 ? "SUCCEEDED" : "QUEUED",
        indentId: indent.id,
        reference: indent.reference,
        rfqId: rfq.id,
        recipients: vendors.map((v) => v.company_name),
        emailJobsQueued: jobIds.length,
        emailJobsSucceeded: succeeded,
        emailJobsFailed: jobsInline() ? failed.length : states.rows.filter((j) => j.status === "DEAD").length,
        failureReasons: states.rows
          .filter((j) => j.status === "DEAD" || (jobsInline() && j.status !== "SUCCEEDED"))
          .map((j) => j.last_error)
          .filter(Boolean),
        newStatus: "RFQ_SENT",
      };
  },
});

const selectVendor = defineTool({
  name: "select_vendor",
  description:
    "Submit a vendor selection for Team Leader approval on an indent that is at QUOTES_READY. Procurement only. Requires the approval value to be set on the case already.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.PROCUREMENT, Role.ADMIN],
  timeoutMs: 20_000,
  parameters: objectSchema(
    {
      ...indentKeyProperty,
      vendorId: { type: "string", description: "Vendor id to select." },
      overrideReason: {
        type: "string",
        description: "Required when the choice differs from the AI recommendation.",
      },
    },
    ["indent", "vendorId"]
  ),
  input: z.object({
    indent: indentKey,
    vendorId: z.string().min(1).max(64),
    overrideReason: z.string().max(4000).optional(),
  }),
  target: (input) => ({ type: "indent", id: input.indent }),
  preview: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    const vendor = await prisma.vendor.findUnique({ where: { id: input.vendorId } });
    if (!vendor) throw new ValidationError("Unknown vendor id.");
    return {
      title: "Submit vendor selection for Team Leader approval",
      target: indent.reference,
      details: [
        { label: "Vendor", value: vendor.companyName },
        { label: "Approval value (INR)", value: String(indent.approvalBudgetAmount ?? "not set") },
        { label: "Current status", value: indent.currentStatus },
      ],
      externalEffect:
        "Moves the case into the approval chain and notifies Team Leaders. The approval tier follows the approval value already recorded on the case.",
    };
  },
  execute: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    const latestAi = await query<{ results_json: any }>(
      `SELECT results_json FROM ai_comparison_runs WHERE indent_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [indent.id]
    );
    const rec = latestAi.rows[0]?.results_json;
    const aiRecommendedVendorId =
      rec?.winnerVendorIdByRequirementMatch || rec?.winnerVendorId || null;
    await indentUseCases.vendorSelection(actor(ctx), indent.id, {
      selectedVendorId: input.vendorId,
      aiRecommendedVendorId,
      overrideReason: input.overrideReason?.trim() || null,
    });
    return {
      status: "SUCCEEDED",
      indentId: indent.id,
      reference: indent.reference,
      selectedVendorId: input.vendorId,
      aiRecommendedVendorId,
      newStatus: "PENDING_TL_VENDOR",
    };
  },
});

const APPROVAL_STAGE_BY_STATUS: Record<string, { useCase: "tlIndent" | "tlVendor" | "director" | "md"; label: string }> =
  {
    PENDING_TL_INDENT: { useCase: "tlIndent", label: "Team Leader review of the indent" },
    PENDING_TL_VENDOR: { useCase: "tlVendor", label: "Team Leader review of the vendor selection" },
    PENDING_DIRECTOR: { useCase: "director", label: "Director approval of the vendor selection" },
    PENDING_MD: { useCase: "md", label: "MD approval of the vendor selection" },
  };

const recordApprovalDecision = defineTool({
  name: "record_approval_decision",
  description:
    "Record an approve or reject decision on the indent's current approval stage. The stage is derived from the indent's current status, never from the request. Remarks are mandatory.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.TEAM_LEADER, Role.DIRECTOR, Role.MD],
  timeoutMs: 20_000,
  parameters: objectSchema(
    {
      ...indentKeyProperty,
      decision: { type: "string", enum: ["APPROVED", "REJECTED"] },
      remarks: { type: "string", description: "Mandatory justification recorded with the decision." },
    },
    ["indent", "decision", "remarks"]
  ),
  input: z.object({
    indent: indentKey,
    decision: z.enum(["APPROVED", "REJECTED"]),
    remarks: z.string().trim().min(1).max(4000),
  }),
  target: (input) => ({ type: "indent", id: input.indent }),
  preview: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    const stage = APPROVAL_STAGE_BY_STATUS[indent.currentStatus];
    if (!stage) {
      throw new ConflictError(
        `${indent.reference} is at ${indent.currentStatus}, which has no approval decision to record.`
      );
    }
    return {
      title: `${input.decision === "APPROVED" ? "Approve" : "Reject"}: ${stage.label}`,
      target: indent.reference,
      details: [
        { label: "Decision", value: input.decision },
        { label: "Remarks", value: input.remarks },
        { label: "Current status", value: indent.currentStatus },
      ],
      externalEffect:
        "Records an approval event in your name, moves the case forward or closes it as rejected, and notifies the affected users.",
    };
  },
  execute: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    const stage = APPROVAL_STAGE_BY_STATUS[indent.currentStatus];
    if (!stage) {
      throw new ConflictError(
        `${indent.reference} is at ${indent.currentStatus}, which has no approval decision to record.`
      );
    }
    await indentUseCases[stage.useCase](actor(ctx), indent.id, input.decision, input.remarks);
    const after = await prisma.indent.findUnique({ where: { id: indent.id } });
    return {
      status: "SUCCEEDED",
      indentId: indent.id,
      reference: indent.reference,
      stage: stage.useCase,
      decision: input.decision,
      newStatus: after?.currentStatus ?? null,
    };
  },
});

const sendToFinance = defineTool({
  name: "send_to_finance",
  description:
    "Send an indent to finance for the accounts review. Procurement only; requires a purchase order and a recorded proforma invoice.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.PROCUREMENT, Role.ADMIN],
  timeoutMs: 20_000,
  parameters: objectSchema(indentKeyProperty, ["indent"]),
  input: z.object({ indent: indentKey }),
  target: (input) => ({ type: "indent", id: input.indent }),
  preview: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    return {
      title: "Send case to finance",
      target: indent.reference,
      details: [{ label: "Current status", value: indent.currentStatus }],
      externalEffect: "Notifies the finance team and hands the case over for payment.",
    };
  },
  execute: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    await indentUseCases.sendToFinance(actor(ctx), indent.id);
    return {
      status: "SUCCEEDED",
      indentId: indent.id,
      reference: indent.reference,
      newStatus: "PENDING_FINANCE",
    };
  },
});

const sendFinalInvoiceToFinance = defineTool({
  name: "send_final_invoice_to_finance",
  description:
    "Send the recorded final vendor invoice to finance for the closing review. Procurement only.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.PROCUREMENT, Role.ADMIN],
  timeoutMs: 20_000,
  parameters: objectSchema(indentKeyProperty, ["indent"]),
  input: z.object({ indent: indentKey }),
  target: (input) => ({ type: "indent", id: input.indent }),
  preview: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    return {
      title: "Send final invoice to finance",
      target: indent.reference,
      details: [{ label: "Current status", value: indent.currentStatus }],
      externalEffect: "Notifies the finance team for the final invoice review.",
    };
  },
  execute: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    await indentUseCases.sendFinalInvoice(actor(ctx), indent.id);
    return {
      status: "SUCCEEDED",
      indentId: indent.id,
      reference: indent.reference,
      newStatus: "PENDING_FINANCE_FINAL",
    };
  },
});

const completeFinanceFinalReview = defineTool({
  name: "complete_finance_final_review",
  description: "Complete the finance review of the final invoice and close the case. Finance only.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.FINANCE, Role.ADMIN],
  timeoutMs: 20_000,
  parameters: objectSchema(indentKeyProperty, ["indent"]),
  input: z.object({ indent: indentKey }),
  target: (input) => ({ type: "indent", id: input.indent }),
  preview: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    return {
      title: "Close case after final invoice review",
      target: indent.reference,
      details: [{ label: "Current status", value: indent.currentStatus }],
      externalEffect: "Closes the case. This is the end of the workflow.",
    };
  },
  execute: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    await indentUseCases.financeFinal(actor(ctx), indent.id);
    return { status: "SUCCEEDED", indentId: indent.id, reference: indent.reference, newStatus: "CLOSED" };
  },
});

const sendPurchaseOrder = defineTool({
  name: "send_purchase_order",
  description:
    "E-mail a drafted purchase order to the selected vendor. Procurement only. Sends external e-mail with the PO attached.",
  kind: "write",
  requiresConfirmation: true,
  allowedRoles: [Role.PROCUREMENT, Role.ADMIN],
  timeoutMs: 30_000,
  parameters: objectSchema(
    {
      ...indentKeyProperty,
      poId: { type: "string", description: "Purchase order id. Omit to use the latest draft." },
    },
    ["indent"]
  ),
  input: z.object({ indent: indentKey, poId: z.string().min(1).max(64).optional() }),
  target: (input) => ({ type: "indent", id: input.indent }),
  preview: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    const po = await resolvePurchaseOrder(indent.id, input.poId);
    const selection = await query<{ company_name: string; email: string }>(
      `SELECT v.company_name, v.email FROM vendor_selection vs
         INNER JOIN vendors v ON v.id = vs.selected_vendor_id
        WHERE vs.indent_id = $1`,
      [indent.id]
    );
    const vendor = selection.rows[0];
    if (!vendor) throw new ValidationError("No vendor has been selected on this case yet.");
    return {
      title: "Send purchase order to vendor",
      target: `${indent.reference} / PO ${po.po_number}`,
      details: [
        { label: "Vendor", value: `${vendor.company_name} <${vendor.email}>` },
        { label: "PO number", value: po.po_number },
        { label: "Current status", value: indent.currentStatus },
      ],
      externalEffect: "This sends an external e-mail with the purchase order attached.",
    };
  },
  execute: async (input, ctx) => {
    const indent = await loadAuthorizedIndent(ctx, input.indent);
    const po = await resolvePurchaseOrder(indent.id, input.poId);
    const result = await sendPurchaseOrderEmail(indent.id, actor(ctx), po.id);
    return {
      status: "SUCCEEDED",
      indentId: indent.id,
      reference: indent.reference,
      poNumber: result.poNumber,
      sentToEmail: result.sentToEmail,
      attachedPdf: result.attachedPdf,
      newStatus: "PO_SENT",
    };
  },
});

async function resolvePurchaseOrder(indentId: string, poId?: string) {
  const rows = await query<{ id: string; po_number: string; sent_at: Date | null }>(
    `SELECT id, po_number, sent_at FROM purchase_orders
      WHERE indent_id = $1 AND ($2::text IS NULL OR id = $2)
      ORDER BY created_at DESC LIMIT 1`,
    [indentId, poId ?? null]
  );
  const po = rows.rows[0];
  if (!po) throw new ValidationError("No purchase order exists for this case yet.");
  if (po.sent_at) {
    throw new ConflictError(`Purchase order ${po.po_number} was already sent.`);
  }
  return po;
}

const syncGmail = defineTool({
  name: "sync_gmail",
  description:
    "Refresh vendor e-mail and quotation attachments from the connected Gmail mailbox. Procurement only. Reads mail; sends nothing.",
  kind: "write",
  requiresConfirmation: false,
  allowedRoles: [Role.PROCUREMENT, Role.ADMIN],
  timeoutMs: 25_000,
  parameters: objectSchema({}),
  input: z.object({}),
  execute: async (_input, ctx) => {
    const gmail = await getGmailClient();
    if (!gmail) {
      throw new ValidationError("Gmail is not connected, so no sync can run.");
    }
    if (jobsInline()) {
      const result = await runGmailSync(ctx.actor.id);
      return { status: "SUCCEEDED", ...result };
    }
    const jobId = await enqueueJob({
      jobType: "gmail.sync",
      payload: { actorId: ctx.actor.id },
      idempotencyKey: `gmail.sync:${ctx.actor.id}:${Math.floor(Date.now() / 60_000)}`,
      correlationId: getCorrelationId(),
    });
    return {
      status: "QUEUED",
      jobId,
      note: jobId
        ? "A Gmail sync job is queued; results appear once the worker finishes."
        : "A Gmail sync for this minute is already queued.",
    };
  },
});

export const ACTION_TOOLS: CopilotTool<any>[] = [
  submitIndent,
  markQuotesReady,
  sendRfq,
  selectVendor,
  recordApprovalDecision,
  sendToFinance,
  sendFinalInvoiceToFinance,
  completeFinanceFinalReview,
  sendPurchaseOrder,
  syncGmail,
];
