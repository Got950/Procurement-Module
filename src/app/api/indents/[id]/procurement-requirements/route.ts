import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { UnauthorizedError } from "@/lib/errors";
import { persistProcurementRequirements } from "@/server/procurement-requirements";

const requirementsBody = z.object({
  costRequirement: z.string().optional(),
  deliveryRequirement: z.string().optional(),
  specificationsRequirement: z.string().optional(),
  approvalBudgetAmount: z.number().nullable().optional(),
});

export const POST = withApiHandler({
  params: idParam,
  body: requirementsBody,
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  const approvalBudgetAmount = await persistProcurementRequirements(
    params.id,
    { id: session.sub, role: session.role },
    body
  );
  return NextResponse.json({ ok: true, approvalBudgetAmount });
});
