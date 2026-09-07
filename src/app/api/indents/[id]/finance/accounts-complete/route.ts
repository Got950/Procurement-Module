import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { idParam } from "@/lib/schemas";
import { AuthorizationError, UnauthorizedError } from "@/lib/errors";
import { canFinance } from "@/lib/rbac/policies";
import { financeCompleteAccounts } from "@/server/workflow/indent-workflow";

const accountsBody = z.object({
  budgetAllocation: z.string(),
  budgetUtilized: z.string(),
  availableBalance: z.string(),
  fundsAvailable: z.string(),
  accountNo: z.string(),
  ifscCode: z.string(),
  branchName: z.string(),
  accountHolderName: z.string(),
  remarks: z.string(),
});

export const POST = withApiHandler({
  idempotent: true,
  params: idParam,
  body: accountsBody,
  authorize: (session) => {
    if (!canFinance(session.role)) throw new AuthorizationError();
  },
})(async ({ session, params, body }) => {
  if (!session) throw new UnauthorizedError();
  await financeCompleteAccounts(params.id, session.sub, session.role, body);
  return NextResponse.json({ ok: true });
});
