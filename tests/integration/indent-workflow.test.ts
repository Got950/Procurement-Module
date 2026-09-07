import { beforeEach, expect, it } from "vitest";
import {
  createDocument,
  createIndent,
  createItem,
  createUser,
  createVendor,
  describeDb,
  resetData,
  statusOf,
} from "../helpers/db";
import { query } from "@/lib/db";
import { ConflictError, DomainRuleError, NotFoundError } from "@/lib/errors";
import {
  createRfqAndMarkSent,
  directorDecision,
  financeCompleteAccounts,
  financeCompleteFinalReview,
  markQuotesReady,
  mdDecision,
  procurementSendVendorProof,
  recordInvoice,
  savePoDraft,
  sendFinalInvoiceToFinance,
  sendIndentToFinance,
  sendPo,
  setAwaitingQuotes,
  submitIndent,
  submitVendorSelectionToTl,
  tlDecisionOnIndent,
  tlDecisionOnVendor,
} from "@/server/workflow/indent-workflow";

/**
 * Characterisation of the workflow as built, so the Phase 1 rewrite of
 * transitionStatus / db.ts is verifiable against current behaviour.
 */
describeDb("indent workflow", () => {
  let requesterId: string;
  let tlId: string;
  let procurementId: string;
  let financeId: string;
  let itemId: string;
  let vendorId: string;

  beforeEach(async () => {
    await resetData();
    requesterId = await createUser("REQUESTER");
    tlId = await createUser("TEAM_LEADER");
    procurementId = await createUser("PROCUREMENT");
    financeId = await createUser("FINANCE");
    itemId = await createItem();
    vendorId = await createVendor("vendor@example.com");
  });

  async function toQuotesReady(amount: number) {
    const indentId = await createIndent({
      requesterId,
      itemId,
      approvalBudgetAmount: amount,
    });
    await submitIndent(indentId, requesterId);
    await tlDecisionOnIndent(indentId, tlId, "TEAM_LEADER", "APPROVED", "ok");
    await createRfqAndMarkSent(indentId, procurementId, "PROCUREMENT", {
      subject: "RFQ",
      bodyTemplate: "body",
      vendorIds: [vendorId],
    });
    await setAwaitingQuotes(indentId, procurementId, "PROCUREMENT");
    await markQuotesReady(indentId, procurementId, "PROCUREMENT");
    await submitVendorSelectionToTl(indentId, procurementId, "PROCUREMENT", {
      selectedVendorId: vendorId,
      aiRecommendedVendorId: null,
      overrideReason: null,
    });
    return indentId;
  }

  async function toClosed(indentId: string) {
    await savePoDraft(indentId, procurementId, "PROCUREMENT", {
      poNumber: `PO-${indentId.slice(0, 8)}`,
      bodyHtml: "<p>po</p>",
      bodyJson: {},
    });
    const po = await query<{ id: string }>(
      "SELECT id FROM purchase_orders WHERE indent_id = $1",
      [indentId]
    );
    await sendPo(indentId, procurementId, "PROCUREMENT", po.rows[0].id);
    await recordInvoice(indentId, procurementId, "PROCUREMENT", {
      vendorName: "Test Vendor",
      amount: 1000,
      documentId: await createDocument(indentId, "proforma"),
      kind: "PROFORMA",
    });
    expect(await statusOf(indentId)).toBe("AWAITING_INVOICE");
    await sendIndentToFinance(indentId, procurementId, "PROCUREMENT");
    expect(await statusOf(indentId)).toBe("PENDING_FINANCE");
    await financeCompleteAccounts(indentId, financeId, "FINANCE", {
      budgetAllocation: "100000",
      budgetUtilized: "10000",
      availableBalance: "90000",
      fundsAvailable: "Yes",
      accountNo: "123456789",
      ifscCode: "TEST0001234",
      branchName: "Test Branch",
      accountHolderName: "Test Vendor",
      remarks: "ok",
    });
    expect(await statusOf(indentId)).toBe("PAYMENT_DONE");
    await recordInvoice(indentId, procurementId, "PROCUREMENT", {
      vendorName: "Test Vendor",
      amount: 1000,
      documentId: await createDocument(indentId, "final-invoice"),
      kind: "FINAL",
    });
    await sendFinalInvoiceToFinance(indentId, procurementId, "PROCUREMENT");
    expect(await statusOf(indentId)).toBe("PENDING_FINANCE_FINAL");
    await financeCompleteFinalReview(indentId, financeId, "FINANCE");
    expect(await statusOf(indentId)).toBe("CLOSED");
  }

  it("runs the TL-only track end to end", async () => {
    const indentId = await toQuotesReady(40_000);
    expect(await statusOf(indentId)).toBe("PENDING_TL_VENDOR");
    await tlDecisionOnVendor(indentId, tlId, "TEAM_LEADER", "APPROVED", "ok");
    expect(await statusOf(indentId)).toBe("PROCUREMENT_PO");
    await toClosed(indentId);
  });

  it("routes the Director track through PENDING_DIRECTOR", async () => {
    const directorId = await createUser("DIRECTOR");
    const indentId = await toQuotesReady(200_000);
    await tlDecisionOnVendor(indentId, tlId, "TEAM_LEADER", "APPROVED", "ok");
    expect(await statusOf(indentId)).toBe("PENDING_DIRECTOR");
    await directorDecision(indentId, directorId, "DIRECTOR", "APPROVED", "ok");
    expect(await statusOf(indentId)).toBe("PROCUREMENT_PO");
  });

  it("routes the MD track through PENDING_DIRECTOR then PENDING_MD", async () => {
    const directorId = await createUser("DIRECTOR");
    const mdId = await createUser("MD");
    const indentId = await toQuotesReady(600_000);
    await tlDecisionOnVendor(indentId, tlId, "TEAM_LEADER", "APPROVED", "ok");
    expect(await statusOf(indentId)).toBe("PENDING_DIRECTOR");
    await directorDecision(indentId, directorId, "DIRECTOR", "APPROVED", "ok");
    expect(await statusOf(indentId)).toBe("PENDING_MD");
    await mdDecision(indentId, mdId, "MD", "APPROVED", "ok");
    expect(await statusOf(indentId)).toBe("PROCUREMENT_PO");
  });

  it("records state history for every transition", async () => {
    const indentId = await toQuotesReady(40_000);
    const history = await query<{ from_status: string | null; to_status: string }>(
      "SELECT from_status, to_status FROM indent_state_history WHERE indent_id = $1 ORDER BY created_at",
      [indentId]
    );
    expect(history.rows.map((r) => r.to_status)).toEqual([
      "PENDING_TL_INDENT",
      "PROCUREMENT_ACTIVE",
      "RFQ_SENT",
      "AWAITING_QUOTES",
      "QUOTES_READY",
      "PENDING_TL_VENDOR",
    ]);
  });

  it("rejects submission by anyone other than the requester", async () => {
    const indentId = await createIndent({ requesterId, itemId });
    await expect(submitIndent(indentId, tlId)).rejects.toThrow(/Forbidden/);
    expect(await statusOf(indentId)).toBe("DRAFT");
  });

  it("rejects a transition from the wrong state with a conflict, not a bad request", async () => {
    const indentId = await createIndent({ requesterId, itemId, status: "PROCUREMENT_ACTIVE" });
    await expect(submitIndent(indentId, requesterId)).rejects.toBeInstanceOf(ConflictError);
  });

  it("reports a missing indent as not found", async () => {
    await expect(submitIndent("does-not-exist", requesterId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects an approval from a role that does not own the stage", async () => {
    const indentId = await createIndent({ requesterId, itemId });
    await submitIndent(indentId, requesterId);
    await expect(
      tlDecisionOnIndent(indentId, financeId, "FINANCE", "APPROVED", "ok")
    ).rejects.toThrow(/Forbidden/);
  });

  it("requires the structured budget amount before vendor selection leaves procurement", async () => {
    const indentId = await createIndent({
      requesterId,
      itemId,
      status: "QUOTES_READY",
      approvalBudgetAmount: null,
    });
    await expect(
      submitVendorSelectionToTl(indentId, procurementId, "PROCUREMENT", {
        selectedVendorId: vendorId,
        aiRecommendedVendorId: null,
        overrideReason: null,
      })
    ).rejects.toThrow(/Approval value/);
  });

  it("refuses an approval value below the selected vendor's quoted total", async () => {
    // createIndent uses quantity 10, so a 9,000 unit price is a 90,000 total:
    // entering 40,000 would route it as TL_ONLY instead of DIRECTOR.
    const indentId = await createIndent({
      requesterId,
      itemId,
      status: "QUOTES_READY",
      approvalBudgetAmount: 40_000,
    });
    await query(
      `INSERT INTO quotations (indent_id, vendor_id, unit_price) VALUES ($1, $2, 9000)`,
      [indentId, vendorId]
    );
    await expect(
      submitVendorSelectionToTl(indentId, procurementId, "PROCUREMENT", {
        selectedVendorId: vendorId,
        aiRecommendedVendorId: null,
        overrideReason: null,
      })
    ).rejects.toThrow(/below the selected vendor's quoted total/);

    // The honest amount passes.
    await query("UPDATE indents SET approval_budget_amount = 90000 WHERE id = $1", [indentId]);
    await submitVendorSelectionToTl(indentId, procurementId, "PROCUREMENT", {
      selectedVendorId: vendorId,
      aiRecommendedVendorId: null,
      overrideReason: null,
    });
    expect(await statusOf(indentId)).toBe("PENDING_TL_VENDOR");
  });

  it("rejection records the reason and stops the workflow", async () => {
    const indentId = await createIndent({ requesterId, itemId });
    await submitIndent(indentId, requesterId);
    await tlDecisionOnIndent(indentId, tlId, "TEAM_LEADER", "REJECTED", "not justified");
    expect(await statusOf(indentId)).toBe("REJECTED_TL_INDENT");
    const row = await query<{ rejection_reason: string }>(
      "SELECT rejection_reason FROM indents WHERE id = $1",
      [indentId]
    );
    expect(row.rows[0].rejection_reason).toBe("not justified");
  });

  it("writes exactly one COMPLETED payment when finance completes accounts", async () => {
    const indentId = await toQuotesReady(40_000);
    await tlDecisionOnVendor(indentId, tlId, "TEAM_LEADER", "APPROVED", "ok");
    await toClosed(indentId);
    const payments = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM payments WHERE indent_id = $1 AND status = 'COMPLETED'",
      [indentId]
    );
    expect(payments.rows[0].count).toBe("1");
  });

  it("closes through the vendor-proof path as well", async () => {
    const indentId = await createIndent({
      requesterId,
      itemId,
      status: "PAYMENT_DONE",
      approvalBudgetAmount: 40_000,
    });
    await procurementSendVendorProof(indentId, procurementId, "PROCUREMENT");
    expect(await statusOf(indentId)).toBe("CLOSED");
  });

  it("refuses ADMIN on an approval stage", async () => {
    const adminId = await createUser("ADMIN");
    const indentId = await createIndent({ requesterId, itemId });
    await submitIndent(indentId, requesterId);
    await expect(
      tlDecisionOnIndent(indentId, adminId, "ADMIN", "APPROVED", "no")
    ).rejects.toThrow(/Forbidden/);
  });

  it("refuses the same person at two vendor-approval stages", async () => {
    const indentId = await toQuotesReady(80_000);
    await tlDecisionOnVendor(indentId, tlId, "TEAM_LEADER", "APPROVED", "ok");
    expect(await statusOf(indentId)).toBe("PENDING_DIRECTOR");
    await query("UPDATE users SET role = 'DIRECTOR' WHERE id = $1", [tlId]);
    await expect(directorDecision(indentId, tlId, "DIRECTOR", "APPROVED", "ok")).rejects.toThrow(
      DomainRuleError
    );
  });
});
