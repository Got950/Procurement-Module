import { beforeEach, expect, it } from "vitest";
import { createIndent, createItem, createUser, describeDb, resetData } from "../helpers/db";
import { query } from "@/lib/db";
import { persistProcurementRequirements } from "@/server/procurement-requirements";
import { AuthorizationError, ConflictError, ValidationError } from "@/lib/errors";

async function amountOf(indentId: string) {
  const result = await query<{ approval_budget_amount: string | null }>(
    "SELECT approval_budget_amount FROM indents WHERE id = $1",
    [indentId]
  );
  return result.rows[0]?.approval_budget_amount ?? null;
}

describeDb("procurement requirements (approval-routing amount)", () => {
  beforeEach(resetData);

  async function setup(status = "PROCUREMENT_ACTIVE", approvalBudgetAmount: number | null = null) {
    const requesterId = await createUser("REQUESTER");
    const procId = await createUser("PROCUREMENT");
    const itemId = await createItem();
    const indentId = await createIndent({ requesterId, itemId, status, approvalBudgetAmount });
    return { indentId, proc: { id: procId, role: "PROCUREMENT" as const } };
  }

  it("stores the structured amount and returns it", async () => {
    const { indentId, proc } = await setup();
    const amount = await persistProcurementRequirements(indentId, proc, {
      costRequirement: "Net 30",
      approvalBudgetAmount: 450_000,
    });
    expect(amount).toBe(450_000);
    expect(Number(await amountOf(indentId))).toBe(450_000);
  });

  it("leaves the stored amount alone when the field is omitted", async () => {
    const { indentId, proc } = await setup("PROCUREMENT_ACTIVE", 450_000);
    await persistProcurementRequirements(indentId, proc, { costRequirement: "Net 45" });
    expect(Number(await amountOf(indentId))).toBe(450_000);
  });

  it("clears the amount only when explicitly nulled", async () => {
    const { indentId, proc } = await setup("PROCUREMENT_ACTIVE", 450_000);
    await persistProcurementRequirements(indentId, proc, { approvalBudgetAmount: null });
    expect(await amountOf(indentId)).toBeNull();
  });

  it("rejects a negative amount", async () => {
    const { indentId, proc } = await setup();
    await expect(
      persistProcurementRequirements(indentId, proc, { approvalBudgetAmount: -1 })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a non-procurement actor", async () => {
    const { indentId } = await setup();
    const tlId = await createUser("TEAM_LEADER");
    await expect(
      persistProcurementRequirements(indentId, { id: tlId, role: "TEAM_LEADER" }, {
        approvalBudgetAmount: 10,
      })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("freezes the amount once the case has left the procurement stages", async () => {
    const { indentId, proc } = await setup("PENDING_TL_VENDOR", 450_000);
    await expect(
      persistProcurementRequirements(indentId, proc, { approvalBudgetAmount: 10 })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(Number(await amountOf(indentId))).toBe(450_000);
  });

  it("writes a before/after audit entry", async () => {
    const { indentId, proc } = await setup();
    await persistProcurementRequirements(indentId, proc, { approvalBudgetAmount: 450_000 });
    const audit = await query<{ diff_json: { after: { approvalBudgetAmount: number } } }>(
      "SELECT diff_json FROM audit_logs WHERE indent_id = $1 AND action = 'PROCUREMENT_REQUIREMENTS_SAVED'",
      [indentId]
    );
    expect(audit.rows).toHaveLength(1);
    expect(Number(audit.rows[0].diff_json.after.approvalBudgetAmount)).toBe(450_000);
  });
});
