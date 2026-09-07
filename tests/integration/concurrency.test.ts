import { beforeEach, expect, it, vi } from "vitest";
import {
  createDocument,
  createIndent,
  createItem,
  createUser,
  describeDb,
  resetData,
  statusOf,
} from "../helpers/db";
import { prisma, query } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import * as notifications from "@/server/notification-service";
import {
  financeCompleteAccounts,
  submitIndent,
  tlDecisionOnIndent,
} from "@/server/workflow/indent-workflow";

/**
 * The failure modes that no amount of sequential testing catches: two actors on
 * one case, and a mid-sequence failure after money has already been written.
 */
describeDb("concurrency and atomicity", () => {
  let requesterId: string;
  let tlId: string;
  let secondTlId: string;
  let financeId: string;
  let itemId: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetData();
    requesterId = await createUser("REQUESTER");
    tlId = await createUser("TEAM_LEADER");
    secondTlId = await createUser("TEAM_LEADER");
    financeId = await createUser("FINANCE");
    itemId = await createItem();
  });

  it("lets exactly one of two simultaneous approvals win", async () => {
    const indentId = await createIndent({ requesterId, itemId });
    await submitIndent(indentId, requesterId);

    const results = await Promise.allSettled([
      tlDecisionOnIndent(indentId, tlId, "TEAM_LEADER", "APPROVED", "first"),
      tlDecisionOnIndent(indentId, secondTlId, "TEAM_LEADER", "REJECTED", "second"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected");
    expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    const events = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM approval_events WHERE indent_id = $1",
      [indentId]
    );
    expect(events.rows[0].count).toBe("1");

    const history = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM indent_state_history WHERE indent_id = $1 AND from_status = 'PENDING_TL_INDENT'",
      [indentId]
    );
    expect(history.rows[0].count).toBe("1");
  });

  it("rejects a second edit made against a stale indent version", async () => {
    const indentId = await createIndent({ requesterId, itemId });

    // Both editors loaded version 0; the first write wins and bumps it.
    const first = await prisma.indent.update({
      where: { id: indentId, version: 0, currentStatus: "DRAFT" },
      data: { justification: "first", version: 1 },
    });
    expect(first).not.toBeNull();

    const second = await prisma.indent.update({
      where: { id: indentId, version: 0, currentStatus: "DRAFT" },
      data: { justification: "second", version: 1 },
    });
    expect(second).toBeNull();

    const row = await query<{ justification: string }>(
      "SELECT justification FROM indents WHERE id = $1",
      [indentId]
    );
    expect(row.rows[0].justification).toBe("first");
  });

  it("rolls the whole finance completion back when a later step fails", async () => {
    const indentId = await createIndent({
      requesterId,
      itemId,
      status: "PENDING_FINANCE",
      approvalBudgetAmount: 40_000,
    });
    await query(
      `INSERT INTO purchase_orders (indent_id, po_number, body_html) VALUES ($1, $2, '<p>po</p>')`,
      [indentId, `PO-${indentId.slice(0, 8)}`]
    );
    await query(
      `INSERT INTO invoices (indent_id, kind, vendor_name, document_id) VALUES ($1, 'PROFORMA', 'V', $2)`,
      [indentId, await createDocument(indentId, "proforma")]
    );

    // Fails after the bank fields, the payment row and the transition are written.
    vi.spyOn(notifications, "notifyUsers").mockRejectedValueOnce(new Error("notify down"));

    await expect(
      financeCompleteAccounts(indentId, financeId, "FINANCE", {
        budgetAllocation: "100000",
        budgetUtilized: "10000",
        availableBalance: "90000",
        fundsAvailable: "Yes",
        accountNo: "123456789",
        ifscCode: "TEST0001234",
        branchName: "Test Branch",
        accountHolderName: "V",
        remarks: "ok",
      })
    ).rejects.toThrow(/notify down/);

    expect(await statusOf(indentId)).toBe("PENDING_FINANCE");
    const payments = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM payments WHERE indent_id = $1",
      [indentId]
    );
    expect(payments.rows[0].count).toBe("0");
    const indent = await query<{ finance_account_no: string | null }>(
      "SELECT finance_account_no FROM indents WHERE id = $1",
      [indentId]
    );
    expect(indent.rows[0].finance_account_no).toBeNull();
  });
});
