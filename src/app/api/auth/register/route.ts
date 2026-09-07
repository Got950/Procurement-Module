import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { registerPublicUser, registerPublicUserBody } from "@/server/public-registration";

export const POST = withApiHandler({
  auth: false,
  body: registerPublicUserBody,
  rateLimit: { limit: 10, windowMs: 15 * 60 * 1000 },
})(async ({ body }) => {
  const user = await registerPublicUser(body);
  return NextResponse.json({
    ok: true,
    message: "Account created. You can sign in now.",
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role,
    },
  });
});
