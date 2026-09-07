import { beforeEach, expect, it } from "vitest";
import {
  createIndent,
  createItem,
  createUser,
  createVendor,
  describeDb,
  resetData,
  statusOf,
} from "../helpers/db";
import { query } from "@/lib/db";
import {
  createRfqAndMarkSent,
  directorDecision,
  financeCompleteAccounts,
  financeCompleteFinalReview,
  markQuotesReady,
  mdDecision,
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
 * Combinatorial negative/positive checks across roles and approval tracks.
 * Not every (role × status × action) cell — that is unbounded — but every
 * security-critical wrong-role attempt and each budget-track / rejection branch.
 */
describeDb("workflow role × action combinations", () => {
  let requesterId: string;
  let tlId: string;
  let procurementId: string;
  let financeId: string;
  let directorId: string;
  let mdId: string;
  let adminId: string;
  let itemId: string;
  let vendorId: string;

  beforeEach(async () => {
    await resetData();
    requesterId = await createUser("REQUESTER");
    tlId = await createUser("TEAM_LEADER");
    procurementId = await createUser("PROCUREMENT");
    financeId = await createUser("FINANCE");
    directorId = await createUser("DIRECTOR");
    mdId = await createUser("MD");
    adminId = await createUser("ADMIN");
    itemId = await createItem();
    vendorId = await createVendor("combo@example.com");
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

  const wrongActors: Array<{
    label: string;
    run: (indentId: string) => Promise<unknown>;
  }> = [
    {
      label: "finance cannot TL-approve indent",
      run: (id) => tlDecisionOnIndent(id, financeId, "FINANCE", "APPROVED", "x"),
    },
    {
      label: "director cannot TL-approve indent",
      run: (id) => tlDecisionOnIndent(id, directorId, "DIRECTOR", "APPROVED", "x"),
    },
    {
      label: "md cannot TL-approve indent",
      run: (id) => tlDecisionOnIndent(id, mdId, "MD", "APPROVED", "x"),
    },
    {
      label: "procurement cannot TL-approve indent",
      run: (id) => tlDecisionOnIndent(id, procurementId, "PROCUREMENT", "APPROVED", "x"),
    },
    {
      label: "requester cannot TL-approve indent",
      run: (id) => tlDecisionOnIndent(id, requesterId, "REQUESTER", "APPROVED", "x"),
    },
    {
      label: "admin cannot TL-approve indent",
      run: (id) => tlDecisionOnIndent(id, adminId, "ADMIN", "APPROVED", "x"),
    },
  ];

  for (const case_ of wrongActors) {
    it(`rejects: ${case_.label}`, async () => {
      const indentId = await createIndent({ requesterId, itemId });
      await submitIndent(indentId, requesterId);
      await expect(case_.run(indentId)).rejects.toThrow(/Forbidden/);
      expect(await statusOf(indentId)).toBe("PENDING_TL_INDENT");
    });
  }

  it("rejects every non-procurement actor creating an RFQ", async () => {
    const indentId = await createIndent({
      requesterId,
      itemId,
      status: "PROCUREMENT_ACTIVE",
      approvalBudgetAmount: 40_000,
    });
    const actors: Array<[string, string]> = [
      [requesterId, "REQUESTER"],
      [tlId, "TEAM_LEADER"],
      [financeId, "FINANCE"],
      [directorId, "DIRECTOR"],
      [mdId, "MD"],
    ];
    for (const [userId, role] of actors) {
      await expect(
        createRfqAndMarkSent(indentId, userId, role as never, {
          subject: "RFQ",
          bodyTemplate: "body",
          vendorIds: [vendorId],
        })
      ).rejects.toThrow(/Forbidden/);
    }
    expect(await statusOf(indentId)).toBe("PROCUREMENT_ACTIVE");
  });

  it("rejects every non-finance actor completing accounts", async () => {
    const indentId = await createIndent({
      requesterId,
      itemId,
      status: "PENDING_FINANCE",
      approvalBudgetAmount: 40_000,
    });
    const payload = {
      budgetAllocation: "1",
      budgetUtilized: "0",
      availableBalance: "1",
      fundsAvailable: "Yes",
      accountNo: "1",
      ifscCode: "TEST0001",
      branchName: "B",
      accountHolderName: "H",
      remarks: "r",
    };
    for (const [userId, role] of [
      [requesterId, "REQUESTER"],
      [tlId, "TEAM_LEADER"],
      [procurementId, "PROCUREMENT"],
      [directorId, "DIRECTOR"],
      [mdId, "MD"],
    ] as const) {
      await expect(financeCompleteAccounts(indentId, userId, role, payload)).rejects.toThrow(
        /Forbidden/
      );
    }
    expect(await statusOf(indentId)).toBe("PENDING_FINANCE");
  });

  it("rejects wrong-role vendor approvals at each stage", async () => {
    const indentId = await toQuotesReady(600_000);
    await expect(
      tlDecisionOnVendor(indentId, directorId, "DIRECTOR", "APPROVED", "x")
    ).rejects.toThrow(/Forbidden/);
    await tlDecisionOnVendor(indentId, tlId, "TEAM_LEADER", "APPROVED", "ok");
    expect(await statusOf(indentId)).toBe("PENDING_DIRECTOR");
    await expect(directorDecision(indentId, mdId, "MD", "APPROVED", "x")).rejects.toThrow(
      /Forbidden/
    );
    await expect(
      directorDecision(indentId, financeId, "FINANCE", "APPROVED", "x")
    ).rejects.toThrow(/Forbidden/);
    await directorDecision(indentId, directorId, "DIRECTOR", "APPROVED", "ok");
    expect(await statusOf(indentId)).toBe("PENDING_MD");
    await expect(
      mdDecision(indentId, directorId, "DIRECTOR", "APPROVED", "x")
    ).rejects.toThrow(/Forbidden/);
    await expect(mdDecision(indentId, adminId, "ADMIN", "APPROVED", "x")).rejects.toThrow(
      /Forbidden/
    );
  });

  it.each([
    ["TL vendor", 40_000, "REJECTED_TL_VENDOR"] as const,
    ["Director", 200_000, "REJECTED_DIRECTOR"] as const,
    ["MD", 600_000, "REJECTED_MD"] as const,
  ])("rejection branch: %s track ends at %s", async (_label, amount, rejectedStatus) => {
    const indentId = await toQuotesReady(amount);
    if (rejectedStatus === "REJECTED_TL_VENDOR") {
      await tlDecisionOnVendor(indentId, tlId, "TEAM_LEADER", "REJECTED", "no");
    } else if (rejectedStatus === "REJECTED_DIRECTOR") {
      await tlDecisionOnVendor(indentId, tlId, "TEAM_LEADER", "APPROVED", "ok");
      await directorDecision(indentId, directorId, "DIRECTOR", "REJECTED", "no");
    } else {
      await tlDecisionOnVendor(indentId, tlId, "TEAM_LEADER", "APPROVED", "ok");
      await directorDecision(indentId, directorId, "DIRECTOR", "APPROVED", "ok");
      await mdDecision(indentId, mdId, "MD", "REJECTED", "no");
    }
    expect(await statusOf(indentId)).toBe(rejectedStatus);
  });

  it("ADMIN may perform procurement RFQ but still cannot approve", async () => {
    const indentId = await createIndent({
      requesterId,
      itemId,
      approvalBudgetAmount: 40_000,
    });
    await submitIndent(indentId, requesterId);
    await expect(
      tlDecisionOnIndent(indentId, adminId, "ADMIN", "APPROVED", "x")
    ).rejects.toThrow(/Forbidden/);
    expect(await statusOf(indentId)).toBe("PENDING_TL_INDENT");
    await tlDecisionOnIndent(indentId, tlId, "TEAM_LEADER", "APPROVED", "ok");
    await createRfqAndMarkSent(indentId, adminId, "ADMIN", {
      subject: "RFQ",
      bodyTemplate: "body",
      vendorIds: [vendorId],
    });
    expect(await statusOf(indentId)).toBe("RFQ_SENT");
  });

  it("wrong-state finance final review is rejected for finance", async () => {
    const indentId = await createIndent({
      requesterId,
      itemId,
      status: "PENDING_FINANCE",
      approvalBudgetAmount: 40_000,
    });
    await expect(
      financeCompleteFinalReview(indentId, financeId, "FINANCE")
    ).rejects.toThrow();
    expect(await statusOf(indentId)).toBe("PENDING_FINANCE");
  });

  it("full MD track closes only after correct sequence", async () => {
    const indentId = await toQuotesReady(600_000);
    await tlDecisionOnVendor(indentId, tlId, "TEAM_LEADER", "APPROVED", "ok");
    await directorDecision(indentId, directorId, "DIRECTOR", "APPROVED", "ok");
    await mdDecision(indentId, mdId, "MD", "APPROVED", "ok");
    expect(await statusOf(indentId)).toBe("PROCUREMENT_PO");
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
    await query(
      `INSERT INTO documents (indent_id, logical_key, version, filename, storage_path, mime_type, type)
       VALUES ($1, 'proforma', 1, 'p.pdf', 't/p.pdf', 'application/pdf', 'OTHER')`,
      [indentId]
    );
    const doc = await query<{ id: string }>(
      "SELECT id FROM documents WHERE indent_id = $1 AND logical_key = 'proforma'",
      [indentId]
    );
    const { recordInvoice } = await import("@/server/workflow/indent-workflow");
    await recordInvoice(indentId, procurementId, "PROCUREMENT", {
      vendorName: "V",
      amount: 1000,
      documentId: doc.rows[0].id,
      kind: "PROFORMA",
    });
    await sendIndentToFinance(indentId, procurementId, "PROCUREMENT");
    await financeCompleteAccounts(indentId, financeId, "FINANCE", {
      budgetAllocation: "100000",
      budgetUtilized: "10000",
      availableBalance: "90000",
      fundsAvailable: "Yes",
      accountNo: "123",
      ifscCode: "TEST0001",
      branchName: "B",
      accountHolderName: "H",
      remarks: "ok",
    });
    await query(
      `INSERT INTO documents (indent_id, logical_key, version, filename, storage_path, mime_type, type)
       VALUES ($1, 'final', 1, 'f.pdf', 't/f.pdf', 'application/pdf', 'OTHER')`,
      [indentId]
    );
    const finalDoc = await query<{ id: string }>(
      "SELECT id FROM documents WHERE indent_id = $1 AND logical_key = 'final'",
      [indentId]
    );
    await recordInvoice(indentId, procurementId, "PROCUREMENT", {
      vendorName: "V",
      amount: 1000,
      documentId: finalDoc.rows[0].id,
      kind: "FINAL",
    });
    await sendFinalInvoiceToFinance(indentId, procurementId, "PROCUREMENT");
    await financeCompleteFinalReview(indentId, financeId, "FINANCE");
    expect(await statusOf(indentId)).toBe("CLOSED");
  });
});
