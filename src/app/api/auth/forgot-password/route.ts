import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { requestPasswordReset } from "@/server/password-reset";

const bodySchema = z.object({
  email: z.string().trim().email().max(200),
});

export const POST = withApiHandler({
  auth: false,
  body: bodySchema,
  rateLimit: { limit: 5, windowMs: 15 * 60 * 1000 },
})(async ({ body }) => {
  const result = await requestPasswordReset(body.email);
  return NextResponse.json(result);
});
