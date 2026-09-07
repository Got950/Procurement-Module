import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api-handler";
import { resetPasswordWithToken } from "@/server/password-reset";

const bodySchema = z.object({
  token: z.string().min(32).max(128),
  password: z.string().min(1).max(200),
});

export const POST = withApiHandler({
  auth: false,
  body: bodySchema,
  rateLimit: { limit: 10, windowMs: 15 * 60 * 1000 },
})(async ({ body }) => {
  await resetPasswordWithToken(body.token, body.password);
  return NextResponse.json({ ok: true, message: "Password updated. You can sign in now." });
});
