import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { query, withTransaction } from "@/lib/db";
import { UnauthorizedError } from "@/lib/errors";
import { persistProcurementRequirements } from "@/server/procurement-requirements";
import { submitVendorSelectionToTl } from "@/server/workflow/indent-workflow";

const selectionBody = z.object({
  selectedVendorId: z.string().min(1),
  aiRecommendedVendorId: z.string().nullable().optional(),
  overrideReason: z.string().nullable().optional(),
  costRequirement: z.string().optional(),
  deliveryRequirement: z.string().optional(),
  specificationsRequirement: z.string().optional(),
  approvalBudgetAmount: z.number().nullable().optional(),
});

export const POST = withApiHandler({
  params: idParam,
  body: selectionBody,
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  const latestAi = await query<{
    results_json: { winnerVendorId?: string; winnerVendorIdByRequirementMatch?: string | null };
  }>(`SELECT results_json FROM ai_comparison_runs WHERE indent_id = $1 ORDER BY created_at DESC LIMIT 1`, [
    params.id,
  ]);
  const rec = latestAi.rows[0]?.results_json;
  const aiRecommendedVendorId = rec?.winnerVendorIdByRequirementMatch || rec?.winnerVendorId || null;

  await withTransaction(async () => {
    if (
      body.costRequirement !== undefined ||
      body.deliveryRequirement !== undefined ||
      body.specificationsRequirement !== undefined ||
      body.approvalBudgetAmount !== undefined
    ) {
      await persistProcurementRequirements(
        params.id,
        { id: session.sub, role: session.role },
        {
          costRequirement: body.costRequirement,
          deliveryRequirement: body.deliveryRequirement,
          specificationsRequirement: body.specificationsRequirement,
          approvalBudgetAmount: body.approvalBudgetAmount,
        }
      );
    }
    await submitVendorSelectionToTl(params.id, session.sub, session.role, {
      selectedVendorId: body.selectedVendorId,
      aiRecommendedVendorId,
      overrideReason: body.overrideReason ?? null,
    });
  });
  return NextResponse.json({ ok: true });
});
